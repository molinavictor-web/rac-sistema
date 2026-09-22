const express = require("express");
const { google } = require("googleapis");
const { requireAuth, requireRol } = require("../middleware/auth");

const router = express.Router(); // rutas montadas en /api/planteles-consulta

const ROLES_CONSULTA_PLANTELES = ["admin", "operador_plantel"];

const SHEETS_GESCOLAR_ID = process.env.SHEETS_GESCOLAR_ID;
const NOMBRE_HOJA_GESCOLAR = "GESCOLAR";
const RANGO_HOJA_GESCOLAR = `${NOMBRE_HOJA_GESCOLAR}!A:BC`; // 55 columnas (A..BC)
const DURACION_CACHE_MS = 15 * 60 * 1000; // 15 minutos

// Carpeta raíz "Planteles" en Drive (contiene una subcarpeta por código DEA).
const DRIVE_FOLDER_PLANTELES_ID = process.env.DRIVE_FOLDER_PLANTELES_ID;
const DURACION_CACHE_CARPETAS_MS = 15 * 60 * 1000; // 15 minutos

// Lectura de Sheets (GESCOLAR) + lectura de Drive (archivos por código DEA).
// Solo lectura -- esta pantalla es de consulta/descarga únicamente.
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
  ],
});
const sheets = google.sheets({ version: "v4", auth });
const drive = google.drive({ version: "v3", auth });

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

module.exports = router;
