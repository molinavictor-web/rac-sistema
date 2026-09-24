const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const { Readable } = require("stream");
const { google } = require("googleapis");
const { requireAuth, requireRol } = require("../middleware/auth");
const { pool } = require("../db/pool");

const router = express.Router(); // rutas montadas en /api/planteles-consulta

const ROLES_CONSULTA_PLANTELES = ["admin", "operador_plantel"];
const LIMITE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB || 20);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITE_MB * 1024 * 1024 },
});

const SHEETS_GESCOLAR_ID = process.env.SHEETS_GESCOLAR_ID;
const NOMBRE_HOJA_GESCOLAR = "GESCOLAR";
const RANGO_HOJA_GESCOLAR = `${NOMBRE_HOJA_GESCOLAR}!A:BC`; // 55 columnas (A..BC)
const DURACION_CACHE_MS = 15 * 60 * 1000; // 15 minutos

// Hoja "Coordenadas Planteles" -- la misma que ya usa whatsapp-credenciales
// para guardar lat/long capturada en campo (comando "foto <código DEA>").
// Columnas: codigo_dea, codigo_infraestructura, latitud, longitud,
// fecha_captura, ingeniero.
const SHEETS_COORDENADAS_ID = process.env.SHEETS_COORDENADAS_ID;
const RANGO_HOJA_COORDENADAS = "A:F";
let cacheCoordenadas = { datos: [], cargadoEn: 0 };

// Carpeta raíz "Planteles" en Drive (contiene una subcarpeta por código DEA).
const DRIVE_FOLDER_PLANTELES_ID = process.env.DRIVE_FOLDER_PLANTELES_ID;
const DURACION_CACHE_CARPETAS_MS = 15 * 60 * 1000; // 15 minutos

// Lectura de Sheets (GESCOLAR) + lectura de Drive (archivos por código DEA)
// con la cuenta de servicio -- funciona perfecto para LEER, sin permisos
// especiales.
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ],
});
const sheets = google.sheets({ version: "v4", auth });
const drive = google.drive({ version: "v3", auth });

// Para ESCRIBIR (crear carpeta / subir archivo) NO se puede usar la cuenta
// de servicio: las cuentas de servicio tienen 0 bytes de cuota propia de
// Drive, así que pueden crear carpetas (no ocupan espacio) pero fallan al
// subir contenido de archivo a un Drive personal (Gmail normal, sin Google
// Workspace/Unidad compartida). Por eso la escritura se hace con OAuth,
// autenticado como la cuenta Gmail real dueña de "Planteles".
//
// El refresh token NO vive en una variable de entorno fija -- se guarda en
// la tabla `configuracion` de Postgres, para poder renovarlo desde el botón
// "Reconectar Google Drive" (ver rutas /drive-oauth/* más abajo) sin tener
// que tocar Render cada vez que expire (cada 7 días, mientras la app de
// Google Cloud siga en modo "Prueba").
const CLAVE_REFRESH_TOKEN = "drive_refresh_token";
let oauth2Client = null;
let driveEscritura = null;
let credencialesCargadas = false;

if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
  oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    `${process.env.URL_PUBLICA || ""}/api/planteles-consulta/drive-oauth/callback`
  );
  driveEscritura = google.drive({ version: "v3", auth: oauth2Client });
}

// Antes de cualquier operación de escritura, asegura que oauth2Client tenga
// el refresh token más reciente (lo carga de Postgres una sola vez por
// arranque del servidor; después de un /drive-oauth/callback exitoso se
// actualiza también en memoria, sin esperar a un reinicio).
async function asegurarCredencialesEscritura() {
  if (!oauth2Client) return false;
  if (credencialesCargadas) return true;

  let refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  try {
    const { rows } = await pool.query("SELECT valor FROM configuracion WHERE clave = $1", [CLAVE_REFRESH_TOKEN]);
    if (rows[0] && rows[0].valor) refreshToken = rows[0].valor;
  } catch (err) {
    // Falta crear la tabla `configuracion` todavía -- no es motivo para
    // romper la subida, se sigue usando el token de la variable de entorno.
    console.error("No se pudo leer la tabla 'configuracion' (¿falta crearla?):", err.message);
  }
  if (!refreshToken) return false;

  oauth2Client.setCredentials({ refresh_token: refreshToken });
  credencialesCargadas = true;
  return true;
}

// Estados temporales del flujo OAuth (protege /drive-oauth/callback contra
// que alguien active la reconexión sin haber pasado por /drive-oauth/iniciar
// primero, ya que un redirect de Google no puede llevar el token JWT normal
// del sistema). Se limpian solos a los 10 minutos.
const estadosOAuthPendientes = new Map();
function limpiarEstadosVencidos() {
  const ahora = Date.now();
  for (const [estado, creado] of estadosOAuthPendientes) {
    if (ahora - creado > 10 * 60 * 1000) estadosOAuthPendientes.delete(estado);
  }
}

// Campos por los que se puede buscar un plantel. Deben coincidir EXACTO
// (mayúsculas/minúsculas incluidas) con los encabezados reales de la hoja.
const CAMPOS_BUSQUEDA = [
  "nombre_plantel",
  "cod_plantel",
  "municipio",
  "parroquia",
  "NOMB_CIRCUITO",
  "NOM_CONSEJO_COM",
  "director_nombre",
];

let cache = { datos: [], cargadoEn: 0 };
// Caché de subcarpetas ya ubicadas por código DEA -> { id, cargadoEn }, para
// no repetir la búsqueda de carpeta en cada clic sobre la misma ficha.
const cacheCarpetasPorDea = new Map();

// Convierte las filas crudas de Sheets (arreglo de arreglos) en un arreglo
// de objetos, usando la fila de encabezado como llaves. Así, si algún día
// cambia el ORDEN de las columnas en GESCOLAR, esto no se rompe (solo se
// rompería si cambia el NOMBRE de una columna que esté en CAMPOS_BUSQUEDA).
function filasAObjetos(filas) {
  if (!filas.length) return [];
  const [encabezado, ...resto] = filas;
  return resto
    .filter((fila) => fila.some((valor) => valor !== undefined && valor !== ""))
    .map((fila) => {
      const obj = {};
      encabezado.forEach((col, i) => {
        obj[col] = fila[i] !== undefined ? fila[i] : "";
      });
      return obj;
    });
}

async function cargarGescolar(forzar = false) {
  const vencido = Date.now() - cache.cargadoEn > DURACION_CACHE_MS;
  if (!forzar && !vencido && cache.datos.length) return cache.datos;

  const respuesta = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEETS_GESCOLAR_ID,
    range: RANGO_HOJA_GESCOLAR,
  });
  const filas = respuesta.data.values || [];
  cache = { datos: filasAObjetos(filas), cargadoEn: Date.now() };
  return cache.datos;
}

async function cargarCoordenadas() {
  const vencido = Date.now() - cacheCoordenadas.cargadoEn > DURACION_CACHE_MS;
  if (!vencido && cacheCoordenadas.datos.length) return cacheCoordenadas.datos;

  const respuesta = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEETS_COORDENADAS_ID,
    range: RANGO_HOJA_COORDENADAS,
  });
  const filas = respuesta.data.values || [];
  cacheCoordenadas = { datos: filasAObjetos(filas), cargadoEn: Date.now() };
  return cacheCoordenadas.datos;
}

// Coordenadas GPS capturadas en campo para un código DEA (o para el código
// de infraestructura que agrupa varios planteles en un mismo edificio).
router.get("/:codigoDea/coordenadas", requireAuth, requireRol(...ROLES_CONSULTA_PLANTELES), async (req, res) => {
  const codigoDea = (req.params.codigoDea || "").trim();
  if (!SHEETS_COORDENADAS_ID) {
    return res.json({ encontrado: false });
  }
  try {
    const filas = await cargarCoordenadas();
    const fila = filas.find((f) => f.codigo_dea === codigoDea || f.codigo_infraestructura === codigoDea);
    if (!fila || !fila.latitud || !fila.longitud) {
      return res.json({ encontrado: false });
    }
    res.json({
      encontrado: true,
      latitud: fila.latitud,
      longitud: fila.longitud,
      fecha_captura: fila.fecha_captura || null,
      ingeniero: fila.ingeniero || null,
    });
  } catch (err) {
    console.error("Error consultando coordenadas:", err);
    res.json({ encontrado: false });
  }
});

// Búsqueda: coincidencia parcial, sin distinguir mayúsculas, sobre
// cualquiera de los CAMPOS_BUSQUEDA.
router.get("/buscar", requireAuth, requireRol(...ROLES_CONSULTA_PLANTELES), async (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  if (q.length < 2) {
    return res.status(400).json({ error: "Escribe al menos 2 caracteres para buscar." });
  }

  try {
    const datos = await cargarGescolar();
    const resultados = datos.filter((plantel) =>
      CAMPOS_BUSQUEDA.some((campo) => String(plantel[campo] || "").toLowerCase().includes(q))
    );
    res.json({
      total: resultados.length,
      planteles: resultados.slice(0, 200),
      limitado: resultados.length > 200,
    });
  } catch (err) {
    console.error("Error consultando GESCOLAR:", err);
    res.status(500).json({ error: "No se pudo consultar la hoja de GESCOLAR. Verifica que esté compartida con la cuenta de servicio." });
  }
});

// Fuerza a releer la hoja completa, ignorando el caché de 15 minutos --
// útil justo después de que alguien actualice datos en Sheets a mano.
router.post("/refrescar", requireAuth, requireRol(...ROLES_CONSULTA_PLANTELES), async (req, res) => {
  try {
    const datos = await cargarGescolar(true);
    res.json({ ok: true, total: datos.length });
  } catch (err) {
    console.error("Error refrescando GESCOLAR:", err);
    res.status(500).json({ error: "No se pudo refrescar la hoja de GESCOLAR." });
  }
});

// Ubica la subcarpeta de Drive cuyo nombre coincide EXACTO con el código DEA,
// dentro de la carpeta raíz "Planteles". Cachea el id por 15 min.
async function ubicarCarpetaDea(codigoDea) {
  const enCache = cacheCarpetasPorDea.get(codigoDea);
  if (enCache && Date.now() - enCache.cargadoEn < DURACION_CACHE_CARPETAS_MS) {
    return enCache.id;
  }

  const nombreEscapado = codigoDea.replace(/'/g, "\\'");
  const resp = await drive.files.list({
    q: `'${DRIVE_FOLDER_PLANTELES_ID}' in parents and name = '${nombreEscapado}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
  });
  const carpeta = (resp.data.files || [])[0] || null;
  cacheCarpetasPorDea.set(codigoDea, { id: carpeta ? carpeta.id : null, cargadoEn: Date.now() });
  return carpeta ? carpeta.id : null;
}

// Igual que ubicarCarpetaDea, pero si no existe la CREA (para poder subir
// archivos de un plantel que todavía no tiene carpeta en Drive). La
// creación usa driveEscritura (OAuth) -- ver nota arriba sobre por qué la
// cuenta de servicio no sirve para esto.
async function ubicarOCrearCarpetaDea(codigoDea) {
  const existente = await ubicarCarpetaDea(codigoDea);
  if (existente) return existente;
  const listo = await asegurarCredencialesEscritura();
  if (!listo) {
    const err = new Error("Falta conectar Google Drive (usa el botón 'Reconectar Google Drive') para poder crear carpetas o subir archivos.");
    err.sinCredencialesEscritura = true;
    throw err;
  }

  const creada = await driveEscritura.files.create({
    requestBody: {
      name: codigoDea,
      mimeType: "application/vnd.google-apps.folder",
      parents: [DRIVE_FOLDER_PLANTELES_ID],
    },
    fields: "id",
  });
  cacheCarpetasPorDea.set(codigoDea, { id: creada.data.id, cargadoEn: Date.now() });
  return creada.data.id;
}

// Lista los archivos disponibles en Drive para un código DEA.
router.get("/:codigoDea/archivos", requireAuth, requireRol(...ROLES_CONSULTA_PLANTELES), async (req, res) => {
  const codigoDea = (req.params.codigoDea || "").trim();
  if (!codigoDea) return res.status(400).json({ error: "Falta el código DEA." });
  if (!DRIVE_FOLDER_PLANTELES_ID) {
    return res.status(500).json({ error: "Falta configurar DRIVE_FOLDER_PLANTELES_ID en el servidor." });
  }

  try {
    const carpetaId = await ubicarCarpetaDea(codigoDea);
    if (!carpetaId) {
      return res.json({ carpetaEncontrada: false, archivos: [] });
    }

    const resp = await drive.files.list({
      q: `'${carpetaId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: "files(id, name, mimeType, size, modifiedTime)",
      orderBy: "name",
      pageSize: 100,
    });

    const archivos = (resp.data.files || []).map((f) => ({
      id: f.id,
      nombre: f.name,
      mimeType: f.mimeType,
      tamano: f.size ? Number(f.size) : null,
      modificado: f.modifiedTime || null,
    }));

    res.json({ carpetaEncontrada: true, archivos });
  } catch (err) {
    console.error("Error listando archivos de Drive:", err);
    res.status(500).json({ error: "No se pudo consultar Drive. Verifica que la carpeta 'Planteles' esté compartida con la cuenta de servicio." });
  }
});

// Sube uno o varios archivos a la carpeta del código DEA (la crea si no
// existe todavía), estilo "Upload files" de GitHub.
router.post("/:codigoDea/archivos", requireAuth, requireRol(...ROLES_CONSULTA_PLANTELES), upload.array("archivos", 20), async (req, res) => {
  const codigoDea = (req.params.codigoDea || "").trim();
  if (!codigoDea) return res.status(400).json({ error: "Falta el código DEA." });
  if (!DRIVE_FOLDER_PLANTELES_ID) {
    return res.status(500).json({ error: "Falta configurar DRIVE_FOLDER_PLANTELES_ID en el servidor." });
  }
  if (!req.files || !req.files.length) {
    return res.status(400).json({ error: "No llegó ningún archivo." });
  }
  if (!driveEscritura) {
    return res.status(500).json({ error: "Faltan configurar GOOGLE_OAUTH_CLIENT_ID/SECRET en Render." });
  }
  const listo = await asegurarCredencialesEscritura();
  if (!listo) {
    return res.status(409).json({ error: "Falta conectar Google Drive. Usa el botón 'Reconectar Google Drive' y vuelve a intentar." });
  }

  try {
    const carpetaId = await ubicarOCrearCarpetaDea(codigoDea);
    const subidos = [];
    for (const archivo of req.files) {
      const creado = await driveEscritura.files.create({
        requestBody: { name: archivo.originalname, parents: [carpetaId] },
        media: { mimeType: archivo.mimetype || "application/octet-stream", body: Readable.from(archivo.buffer) },
        fields: "id, name",
      });
      subidos.push(creado.data.name);
    }
    res.json({ ok: true, subidos, total: subidos.length });
  } catch (err) {
    console.error("Error subiendo archivos a Drive:", err);
    let mensaje = "No se pudo subir el archivo a Drive.";
    if (err && err.sinCredencialesEscritura) {
      mensaje = err.message;
    } else if (err && err.code === 403) {
      mensaje = "Sin permiso de escritura en Drive. Reconecta con la cuenta correcta (botón 'Reconectar Google Drive').";
    } else if (err && (err.code === 401 || (err.response && err.response.status === 401))) {
      mensaje = "La conexión con Google Drive expiró. Usa el botón 'Reconectar Google Drive' y vuelve a intentar.";
      credencialesCargadas = false; // fuerza a releer/renovar en el próximo intento
    }
    res.status(500).json({ error: mensaje });
  }
});

// Tipos de imagen válidos para la foto de fachada.
const MIME_IMAGENES_FACHADA = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

// Sube (o reemplaza) la foto de fachada con nombre fijo FACHADA_<código>.ext,
// para que siempre se pueda identificar sin depender de qué otros archivos
// haya en la carpeta.
router.post("/:codigoDea/foto-fachada", requireAuth, requireRol(...ROLES_CONSULTA_PLANTELES), upload.single("foto"), async (req, res) => {
  const codigoDea = (req.params.codigoDea || "").trim();
  if (!codigoDea) return res.status(400).json({ error: "Falta el código DEA." });
  if (!req.file) return res.status(400).json({ error: "No llegó ninguna foto." });
  const extension = MIME_IMAGENES_FACHADA[req.file.mimetype];
  if (!extension) {
    return res.status(400).json({ error: "La foto debe ser JPG, PNG, WEBP o HEIC." });
  }
  if (!driveEscritura) {
    return res.status(500).json({ error: "Faltan configurar GOOGLE_OAUTH_CLIENT_ID/SECRET en Render." });
  }
  const listo = await asegurarCredencialesEscritura();
  if (!listo) {
    return res.status(409).json({ error: "Falta conectar Google Drive. Usa el botón 'Reconectar Google Drive' y vuelve a intentar." });
  }

  try {
    const carpetaId = await ubicarOCrearCarpetaDea(codigoDea);

    // Borra cualquier FACHADA_* anterior (pudo quedar con otra extensión).
    const anteriores = await drive.files.list({
      q: `'${carpetaId}' in parents and name contains 'FACHADA_' and trashed = false`,
      fields: "files(id)",
    });
    for (const f of anteriores.data.files || []) {
      await driveEscritura.files.delete({ fileId: f.id }).catch(() => {});
    }

    const nombre = `FACHADA_${codigoDea}.${extension}`;
    await driveEscritura.files.create({
      requestBody: { name: nombre, parents: [carpetaId] },
      media: { mimeType: req.file.mimetype, body: Readable.from(req.file.buffer) },
      fields: "id, name",
    });
    res.json({ ok: true, nombre });
  } catch (err) {
    console.error("Error subiendo foto de fachada:", err);
    res.status(500).json({ error: "No se pudo subir la foto." });
  }
});


// Tipos nativos de Google (Docs/Sheets/Slides/Dibujos) no se pueden
// descargar tal cual -- hay que exportarlos a un formato de archivo real.
const EXPORTACION_GOOGLE_APPS = {
  "application/vnd.google-apps.document": {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: ".docx",
  },
  "application/vnd.google-apps.spreadsheet": {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: ".xlsx",
  },
  "application/vnd.google-apps.presentation": {
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: ".pptx",
  },
};
const EXPORTACION_GENERICA = { mimeType: "application/pdf", extension: ".pdf" };

// Descarga (streaming) de un archivo puntual. El código DEA en la ruta es
// solo para contexto/logs -- la autorización real es el rol (admin u
// operador_plantel), igual que en /buscar y /archivos.
router.get("/:codigoDea/archivos/:fileId/descargar", requireAuth, requireRol(...ROLES_CONSULTA_PLANTELES), async (req, res) => {
  const { fileId } = req.params;
  try {
    const meta = await drive.files.get({ fileId, fields: "name, mimeType" });
    const { name, mimeType } = meta.data;

    if (mimeType && mimeType.startsWith("application/vnd.google-apps.")) {
      const destino = EXPORTACION_GOOGLE_APPS[mimeType] || EXPORTACION_GENERICA;
      const nombreFinal = /\.[^.]+$/.test(name) ? name : name + destino.extension;
      const salida = await drive.files.export(
        { fileId, mimeType: destino.mimeType },
        { responseType: "stream" }
      );
      res.setHeader("Content-Type", destino.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${nombreFinal.replace(/"/g, "")}"`);
      salida.data.pipe(res);
      return;
    }

    const salida = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );
    res.setHeader("Content-Type", mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/"/g, "")}"`);
    salida.data.pipe(res);
  } catch (err) {
    console.error("Error descargando archivo de Drive:", err);
    res.status(500).json({ error: "No se pudo descargar el archivo." });
  }
});

// ---- Reconectar Google Drive (renovar el refresh token sin tocar Render) ----

// Estado actual: si hay credenciales OAuth configuradas y si ya hay un
// refresh token guardado (en BD o en la variable de entorno original).
router.get("/drive-oauth/estado", requireAuth, requireRol("admin"), async (req, res) => {
  if (!oauth2Client) {
    return res.json({ configurado: false, conectado: false });
  }
  let guardado = null;
  try {
    const { rows } = await pool.query("SELECT valor FROM configuracion WHERE clave = $1", [CLAVE_REFRESH_TOKEN]);
    guardado = rows[0] ? rows[0].valor : null;
  } catch (err) {
    console.error("No se pudo leer la tabla 'configuracion' (¿falta crearla?):", err.message);
  }
  const conectado = Boolean(guardado || process.env.GOOGLE_OAUTH_REFRESH_TOKEN);
  res.json({ configurado: true, conectado });
});

// Genera la URL de Google para iniciar sesión y dar permiso de Drive. El
// frontend abre esta URL en una pestaña nueva (no es un fetch normal,
// porque el login pasa por la pantalla de Google, fuera del sistema).
router.get("/drive-oauth/iniciar", requireAuth, requireRol("admin"), (req, res) => {
  if (!oauth2Client) {
    return res.status(500).json({ error: "Faltan configurar GOOGLE_OAUTH_CLIENT_ID/SECRET en Render." });
  }
  limpiarEstadosVencidos();
  const estado = crypto.randomBytes(16).toString("hex");
  estadosOAuthPendientes.set(estado, Date.now());

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // fuerza a que Google mande SIEMPRE un refresh_token nuevo
    scope: ["https://www.googleapis.com/auth/drive"],
    state: estado,
  });
  res.json({ url });
});

// Google redirige aquí (navegación normal del navegador, no puede llevar el
// token del sistema) después de que el usuario acepta el permiso.
router.get("/drive-oauth/callback", async (req, res) => {
  const { code, state } = req.query;
  const paginaHtml = (titulo, mensaje) => `
    <html><body style="font-family:sans-serif; padding:40px; text-align:center;">
      <h2>${titulo}</h2><p>${mensaje}</p>
      <p style="color:#888; font-size:.85rem;">Puedes cerrar esta pestaña.</p>
    </body></html>`;

  if (!state || !estadosOAuthPendientes.has(state)) {
    return res.status(400).send(paginaHtml("Enlace vencido o inválido", "Vuelve a la pantalla de Consultar planteles y presiona 'Reconectar Google Drive' de nuevo."));
  }
  estadosOAuthPendientes.delete(state); // un solo uso

  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      return res.status(400).send(paginaHtml("No se recibió permiso permanente", "Google no devolvió un refresh token. Intenta de nuevo -- si vuelve a pasar, revisa que la pantalla de consentimiento esté en modo Prueba o Producción (no debería afectar, pero por si acaso)."));
    }

    try {
      await pool.query(
        `INSERT INTO configuracion (clave, valor) VALUES ($1, $2)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
        [CLAVE_REFRESH_TOKEN, tokens.refresh_token]
      );
    } catch (err) {
      console.error("No se pudo guardar en 'configuracion' (¿falta crearla?):", err.message);
      oauth2Client.setCredentials(tokens);
      credencialesCargadas = true;
      return res.send(paginaHtml("Conectado, pero sin guardar de forma permanente", "Falta crear la tabla 'configuracion' en la base de datos -- por ahora funciona hasta que el servidor reinicie. Pídele a tu desarrollador que corra el SQL pendiente."));
    }
    oauth2Client.setCredentials(tokens);
    credencialesCargadas = true;

    res.send(paginaHtml("Google Drive reconectado ✔", "Ya puedes volver a subir archivos desde la ficha del plantel."));
  } catch (err) {
    console.error("Error en drive-oauth/callback:", err);
    res.status(500).send(paginaHtml("Error al reconectar", "No se pudo completar la conexión con Google. Intenta de nuevo."));
  }
});

module.exports = router;
