const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const QRCode = require("qrcode");
const { pool } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");

const router = express.Router(); // rutas protegidas, montadas en /api/credenciales
const publico = express.Router(); // ruta pública /verificar/:codigo, sin auth

const ROLES_CREDENCIALES = ["admin", "operador", "operador_credenciales"];

// ---------- Configuración (mismas variables que ya usa whatsapp-credenciales) ----------
const URL_PUBLICA = process.env.URL_PUBLICA || "https://rac-sistema.onrender.com";
const DIRECTOR_NOMBRE = process.env.DIRECTOR_NOMBRE || "PROFA. MARY ANGELICA JOSE SALAZAR DE MONTEVERDE";
const DIRECTOR_CEDULA = process.env.DIRECTOR_CEDULA || "V-16.396.148";
const DIRECTOR_CARGO = process.env.DIRECTOR_CARGO || "Directora de Zona Educativa del Estado Monagas";
const RESOLUCION_TEXTO =
  process.env.RESOLUCION_TEXTO ||
  "Resolución N° 006 de fecha 07/02/2025. Publicada en Gaceta Oficial N° 43.072 DEL 19/02/2025";
const SHEETS_CREDENCIALES_ID = process.env.SHEETS_CREDENCIALES_ID; // mismo spreadsheet que ya usa whatsapp-credenciales
const NOMBRE_HOJA_CREDENCIALES = "CredencialesEmitidas";

// Membrete oficial (logo del Ministerio del Poder Popular para la Educación),
// insertado en la cabecera del PDF de la credencial.
const RUTA_LOGO_MEMBRETE = path.join(__dirname, "../assets/membrete-logo.png");

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// ---------- Consulta: cédula -> registros del RAC con datos de plantel/geografía ----------
// Mismo JOIN que ya usa /api/rac/exportar-general, para no reinventar la
// resolución de municipio/parroquia por segunda vez.
async function buscarEmpleadoPorCedula(cedula) {
  const cedulaLimpia = cedula.trim().replace(/^0+/, "");
  const { rows } = await pool.query(
    `SELECT r.id, r.cedula, r.nombres, r.apellidos, r.cargo, r.codigo_cargo,
            r.tipo_personal, r.horas_adm, r.horas_academicas, r.fecha_ingreso, r.situacion,
            p.nombre AS nombre_plantel, p.codigo_plantel,
            mu.nombre AS municipio, pa.nombre AS parroquia
     FROM rac r
     JOIN planteles p ON p.id = r.plantel_id
     LEFT JOIN municipios mu ON mu.id = p.municipio_id
     LEFT JOIN parroquias pa ON pa.id = p.parroquia_id
     WHERE r.cedula = $1
     ORDER BY r.actualizado_en DESC`,
    [cedulaLimpia]
  );
  return rows;
}

router.get("/buscar/:cedula", requireAuth, requireRol(...ROLES_CREDENCIALES), async (req, res) => {
  try {
    const registros = await buscarEmpleadoPorCedula(req.params.cedula);
    res.json({ encontrado: registros.length > 0, registros });
  } catch (err) {
    console.error("Error buscando empleado para credencial:", err);
    res.status(500).json({ error: "No se pudo consultar el RAC." });
  }
});

// Un solo registro del RAC por su id (el que el operador eligió en pantalla).
// Antes "Generar" solo recibía la cédula y tomaba el primer registro ACTIVO,
// así que con dos nombramientos (ej. obrero + docente) los dos botones
// generaban la misma credencial.
async function buscarRegistroPorId(id) {
  const { rows } = await pool.query(
    `SELECT r.id, r.cedula, r.nombres, r.apellidos, r.cargo, r.codigo_cargo,
            r.tipo_personal, r.horas_adm, r.horas_academicas, r.fecha_ingreso, r.situacion,
            p.nombre AS nombre_plantel, p.codigo_plantel,
            mu.nombre AS municipio, pa.nombre AS parroquia
     FROM rac r
     JOIN planteles p ON p.id = r.plantel_id
     LEFT JOIN municipios mu ON mu.id = p.municipio_id
     LEFT JOIN parroquias pa ON pa.id = p.parroquia_id
     WHERE r.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// ---------- Datos editables antes de generar (OPCIÓN A, 2026-11-10) ----------
// Lo que el operador corrige SOLO vale para el documento y queda anotado en la
// hoja CredencialesEmitidas. La tabla rac NO se toca (se revertiría en la
// próxima carga masiva). La cédula no se puede editar.
const CAMPOS_EDITABLES = {
  nombres: "Nombres",
  apellidos: "Apellidos",
  director_plantel: "Director(a)",
  cargo: "Cargo",
  codigo_cargo: "Código de cargo",
  tipo_personal: "Tipo de personal",
  horas_academicas: "Horas académicas",
  horas_adm: "Horas administrativas",
  fecha_ingreso: "Fecha de ingreso",
  nombre_plantel: "Plantel",
  codigo_plantel: "Código DEA",
  municipio: "Municipio",
  parroquia: "Parroquia",
};
const MAX_HORAS_ACADEMICAS = 54;
const MAX_HORAS_ADM = 168;

function normalizarValor(valor) {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

// Devuelve { registro, cambios, error }. "cambios" es la lista de lo que el
// operador modificó respecto al RAC, para dejarlo anotado en la hoja.
function aplicarCambios(base, datos) {
  const registro = { ...base };
  const cambios = [];
  if (!datos || typeof datos !== "object") return { registro, cambios, error: null };

  for (const campo of Object.keys(CAMPOS_EDITABLES)) {
    if (!(campo in datos)) continue;
    let nuevo = normalizarValor(datos[campo]).slice(0, 250);
    const anterior = normalizarValor(base[campo]);

    if (campo === "tipo_personal") {
      nuevo = nuevo.toUpperCase();
      if (nuevo && !["D", "O", "A"].includes(nuevo)) {
        return { registro, cambios, error: "Tipo de personal debe ser D, O o A." };
      }
    }
    if (campo === "horas_academicas" || campo === "horas_adm") {
      nuevo = nuevo.replace(",", ".");
      if (nuevo !== "") {
        const n = Number(nuevo);
        const max = campo === "horas_academicas" ? MAX_HORAS_ACADEMICAS : MAX_HORAS_ADM;
        if (!Number.isFinite(n) || n < 0 || n > max) {
          return { registro, cambios, error: `${CAMPOS_EDITABLES[campo]}: debe ser un número entre 0 y ${max}.` };
        }
      }
      const iguales = nuevo === anterior || (nuevo !== "" && anterior !== "" && Number(nuevo) === Number(anterior));
      if (iguales) continue;
    }
    if (campo === "fecha_ingreso" && nuevo !== "" && !leerFecha(nuevo)) {
      return { registro, cambios, error: "Fecha de ingreso: usa el formato DD/MM/AAAA." };
    }

    if (nuevo !== anterior) {
      registro[campo] = nuevo;
      cambios.push(`${CAMPOS_EDITABLES[campo]}: "${anterior || "vacío"}" → "${nuevo || "vacío"}"`);
    }
  }
  return { registro, cambios, error: null };
}

// Las fechas del RAC vienen como DÍA/MES/AÑO ("16/9/2007"). Antes se pasaban
// a new Date(), que las lee como MES/DÍA: "1/9/2014" salía 9 de enero y
// "16/9/2007" salía "Invalid Date". Ahora se leen a mano.
function leerFecha(texto) {
  const t = normalizarValor(texto);
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  let dia, mes, anio;
  if (m) { dia = +m[1]; mes = +m[2]; anio = +m[3]; }
  else {
    m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); // por si llega en formato ISO
    if (!m) return null;
    anio = +m[1]; mes = +m[2]; dia = +m[3];
  }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || anio < 1900 || anio > 2100) return null;
  return { dia, mes, anio };
}

function formatearFecha(texto) {
  const f = leerFecha(texto);
  if (!f) return normalizarValor(texto) || "—";
  return `${String(f.dia).padStart(2, "0")}/${String(f.mes).padStart(2, "0")}/${f.anio}`;
}

// Las fuentes estándar del PDF (Helvetica) solo aceptan caracteres latinos.
// Un emoji o una comilla rara escrita por el operador tumbaría la generación,
// así que se reemplazan o se quitan.
function textoPdf(valor) {
  return String(valor === null || valor === undefined ? "" : valor)
    .normalize("NFC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF→]/g, "")
    .replace(/→/g, "->");
}

// ---------- Generación del PDF con QR (mismo diseño que whatsapp-credenciales, + membrete oficial) ----------
async function generarPdfCredencial(registro, codigoVerificacion, opciones = {}) {
  const { vistaPrevia = false } = opciones;
  const pdfDoc = await PDFDocument.create();
  const pagina = pdfDoc.addPage([612, 792]); // carta
  const fuente = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fuenteNegrita = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fuenteTituloItalica = await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic);
  const { width, height } = pagina.getSize();

  // ---- Membrete oficial (logo del Ministerio) ----
  const logoBytes = fs.readFileSync(RUTA_LOGO_MEMBRETE);
  const logoImagen = await pdfDoc.embedPng(logoBytes);
  const anchoLogo = 230;
  const escalaLogo = anchoLogo / logoImagen.width;
  const altoLogo = logoImagen.height * escalaLogo;
  const margenSuperior = 50;
  pagina.drawImage(logoImagen, {
    x: 56,
    y: height - margenSuperior - altoLogo,
    width: anchoLogo,
    height: altoLogo,
  });

  let y = height - margenSuperior - altoLogo - 28;

  const escribir = (texto, opciones = {}) => {
    const { x = 56, tamano = 11, negrita = false, salto = 18 } = opciones;
    pagina.drawText(textoPdf(texto), {
      x, y, size: tamano,
      font: negrita ? fuenteNegrita : fuente,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= salto;
  };

  const escribirCentrado = (texto, opciones = {}) => {
    const { tamano = 15, negrita = true, salto = 30 } = opciones;
    const f = negrita ? fuenteNegrita : fuente;
    const anchoTexto = f.widthOfTextAtSize(texto, tamano);
    pagina.drawText(texto, {
      x: (width - anchoTexto) / 2,
      y, size: tamano, font: f,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= salto;
  };

  const escribirTituloSubrayado = (texto, opciones = {}) => {
    const { tamano = 17, salto = 30 } = opciones;
    const anchoTexto = fuenteTituloItalica.widthOfTextAtSize(texto, tamano);
    const x = (width - anchoTexto) / 2;
    pagina.drawText(texto, {
      x, y, size: tamano, font: fuenteTituloItalica,
      color: rgb(0.1, 0.1, 0.1),
    });
    pagina.drawLine({
      start: { x, y: y - 3 },
      end: { x: x + anchoTexto, y: y - 3 },
      thickness: 1,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= salto;
  };

  const nombreCompleto = [registro.nombres, registro.apellidos].filter(Boolean).join(" ");

  escribirTituloSubrayado("NOTIFICACIÓN", { tamano: 17, salto: 34 });

  escribir(`DIRECTOR (A): ${registro.director_plantel || ""}`);
  escribir(`CÓDIGO DEA: ${registro.codigo_plantel || "—"}`);
  escribir(`MUNICIPIO: ${registro.municipio || "—"}`);
  escribir(`PARROQUIA: ${registro.parroquia || "—"}`, { salto: 30 });

  const TIPOS_PERSONAL = { D: "DOCENTE", O: "OBRERO", A: "ADMINISTRATIVO" };
  const tipoPersonalTexto = TIPOS_PERSONAL[(registro.tipo_personal || "").toUpperCase()] || registro.tipo_personal || "—";
  const esDocente = (registro.tipo_personal || "").toUpperCase() === "D";
  const horas = esDocente ? registro.horas_academicas : registro.horas_adm;
  const fechaHoy = new Date().toLocaleDateString("es-VE");
  // "A partir del día" usa la fecha de INGRESO real (r.fecha_ingreso del RAC),
  // no la fecha de emisión del documento -- CAMBIO 2026-09-27, revierte la
  // decisión anterior del 2026-09-15 que usaba fechaHoy aquí.
  // CAMBIO 2026-11-10: se lee como DÍA/MES/AÑO (ver leerFecha).
  const fechaIngresoTexto = registro.fecha_ingreso ? formatearFecha(registro.fecha_ingreso) : "—";

  const parrafo =
    `Quien suscribe, ${DIRECTOR_NOMBRE}, Titular de la Cédula de Identidad N° ${DIRECTOR_CEDULA}, ` +
    `${DIRECTOR_CARGO}, ha propuesto a él (la) ciudadano (a): ${nombreCompleto}, Titular de la Cédula ` +
    `de Identidad N° V-${registro.cedula}, cargo nominal: ${registro.cargo || "—"}, Código: ${registro.codigo_cargo || "—"}, ` +
    `para ejercer las funciones de: ${tipoPersonalTexto}. Con una carga horaria de ` +
    `${horas || "—"} horas a partir del día ${fechaIngresoTexto}.`;

  const anchoMaximo = width - 112;
  const palabras = textoPdf(parrafo).split(" ");
  let linea = "";
  for (const palabra of palabras) {
    const pruebaLinea = linea ? `${linea} ${palabra}` : palabra;
    if (fuente.widthOfTextAtSize(pruebaLinea, 11) > anchoMaximo) {
      escribir(linea, { salto: 16 });
      linea = palabra;
    } else {
      linea = pruebaLinea;
    }
  }
  if (linea) escribir(linea, { salto: 16 });

  y -= 20;
  escribir("Sin otro particular que hacer referencia, se despide de Usted.", { salto: 30 });
  escribir("Atentamente,", { salto: 70 });

  escribir("_________________________________", { salto: 14 });
  escribir(DIRECTOR_NOMBRE, { tamano: 9, negrita: true, salto: 12 });
  escribir(DIRECTOR_CARGO, { tamano: 9, salto: 12 });
  escribir(RESOLUCION_TEXTO, { tamano: 8, salto: 20 });

  escribir(`Fecha: ${fechaHoy}`, { salto: 16 });
  escribir(`Código de verificación: ${codigoVerificacion}`, { tamano: 9 });

  const urlVerificacion = `${URL_PUBLICA}/verificar/${codigoVerificacion}`;
  const qrDataUrl = await QRCode.toDataURL(urlVerificacion, { margin: 1, width: 300 });
  const qrImagenBytes = Buffer.from(qrDataUrl.split(",")[1], "base64");
  const qrImagen = await pdfDoc.embedPng(qrImagenBytes);
  const qrTamano = 90;
  pagina.drawImage(qrImagen, {
    x: width - 56 - qrTamano,
    y: 60,
    width: qrTamano,
    height: qrTamano,
  });
  pagina.drawText("Verificar autenticidad", {
    x: width - 56 - qrTamano,
    y: 50,
    size: 7,
    font: fuente,
    color: rgb(0.3, 0.3, 0.3),
  });

  // Vista previa: marca de agua grande y sin registro en la hoja.
  if (vistaPrevia) {
    const marca = "VISTA PREVIA - NO VALIDO";
    const tam = 44;
    const anchoMarca = fuenteNegrita.widthOfTextAtSize(marca, tam);
    const angulo = Math.PI / 5;
    pagina.drawText(marca, {
      x: width / 2 - (anchoMarca / 2) * Math.cos(angulo),
      y: height / 2 - (anchoMarca / 2) * Math.sin(angulo),
      size: tam,
      font: fuenteNegrita,
      color: rgb(0.8, 0.1, 0.1),
      opacity: 0.25,
      rotate: { type: "degrees", angle: 36 },
    });
  }

  return pdfDoc.save();
}

// ---------- Google Sheets: registrar / buscar / aprobar credenciales ----------
async function registrarCredencialEnSheet(registro, codigoVerificacion, cambios = [], generadoPor = "") {
  const nombreCompleto = [registro.nombres, registro.apellidos].filter(Boolean).join(" ");
  const fechaGeneracion = new Date().toISOString();
  const fila = [
    codigoVerificacion,
    registro.cedula,
    nombreCompleto,
    registro.cargo,
    registro.codigo_cargo,
    registro.nombre_plantel,
    registro.codigo_plantel,
    fechaGeneracion,
    "pendiente",
    // Columnas nuevas (2026-11-10). Las lecturas existentes usan A:I y no se afectan.
    cambios.length ? cambios.join(" | ") : "sin cambios",   // J: datos corregidos a mano
    generadoPor,                                            // K: quién la generó
  ];
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEETS_CREDENCIALES_ID,
    range: `${NOMBRE_HOJA_CREDENCIALES}!A:K`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [fila] },
  });
}

async function buscarCredencialPorCodigo(codigo) {
  const respuesta = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEETS_CREDENCIALES_ID,
    range: `${NOMBRE_HOJA_CREDENCIALES}!A:I`,
  });
  const filas = respuesta.data.values || [];
  const encabezado = ["codigo_verificacion", "cedula", "nombre", "cargo", "codigo_rac", "plantel", "codigo_dea", "fecha_generacion", "estado"];
  const indice = filas.findIndex((f, i) => i > 0 && (f[0] || "").trim().toUpperCase() === codigo.toUpperCase());
  if (indice === -1) return null;
  const fila = filas[indice];
  const registro = {};
  encabezado.forEach((col, i) => { registro[col] = fila[i] || ""; });
  return { registro, numeroFila: indice + 1 };
}

// ---------- Endpoints protegidos (panel dentro de rac-sistema) ----------
// Busca el registro que eligió el operador (rac_id) y le aplica sus correcciones.
// Si no llega rac_id (versión vieja de la pantalla), se usa el comportamiento
// anterior: primer registro ACTIVO de esa cédula.
async function prepararRegistro(req) {
  const cedula = normalizarValor(req.params.cedula || req.body.cedula).replace(/^0+/, "");
  const racId = parseInt(req.body && req.body.rac_id, 10);
  let base = null;
  if (Number.isInteger(racId)) {
    base = await buscarRegistroPorId(racId);
    if (base && cedula && base.cedula !== cedula) base = null;
  } else if (cedula) {
    const registros = await buscarEmpleadoPorCedula(cedula);
    base = registros.find((r) => (r.situacion || "").toUpperCase() === "ACTIVO") || registros[0] || null;
  }
  if (!base) return { error: "No se encontró ese registro en el RAC.", status: 404 };
  const { registro, cambios, error } = aplicarCambios(base, req.body && req.body.datos);
  if (error) return { error, status: 400 };
  return { registro, cambios };
}

// Vista previa: mismo PDF con marca de agua, NO se registra en la hoja.
router.post("/vista-previa", requireAuth, requireRol(...ROLES_CREDENCIALES), async (req, res) => {
  try {
    const r = await prepararRegistro(req);
    if (r.error) return res.status(r.status).json({ error: r.error });
    const pdfBytes = await generarPdfCredencial(r.registro, "VISTA-PREVIA", { vistaPrevia: true });
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `inline; filename="vista_previa_${r.registro.cedula}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Error generando vista previa:", err);
    res.status(500).json({ error: "Ocurrió un error generando la vista previa." });
  }
});

router.post("/generar/:cedula", requireAuth, requireRol(...ROLES_CREDENCIALES), async (req, res) => {
  try {
    const r = await prepararRegistro(req);
    if (r.error) return res.status(r.status).json({ error: r.error });
    const registro = r.registro;

    const codigoVerificacion = crypto.randomBytes(5).toString("hex").toUpperCase();
    const pdfBytes = await generarPdfCredencial(registro, codigoVerificacion);
    const u = req.usuario || {};
    const generadoPor = u.nombre || u.email || (u.id ? `usuario ${u.id}` : "");
    await registrarCredencialEnSheet(registro, codigoVerificacion, r.cambios, generadoPor);

    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `attachment; filename="credencial_${registro.cedula}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Error generando credencial:", err);
    res.status(500).json({ error: "Ocurrió un error generando la credencial." });
  }
});

router.get("/pendientes", requireAuth, requireRol(...ROLES_CREDENCIALES), async (req, res) => {
  try {
    const respuesta = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEETS_CREDENCIALES_ID,
      range: `${NOMBRE_HOJA_CREDENCIALES}!A:I`,
    });
    const filas = (respuesta.data.values || []).slice(1);
    const pendientes = filas
      .filter((f) => (f[8] || "").trim().toLowerCase() === "pendiente")
      .map((f) => ({
        codigo_verificacion: f[0], cedula: f[1], nombre: f[2], cargo: f[3],
        codigo_rac: f[4], plantel: f[5], codigo_dea: f[6], fecha_generacion: f[7],
      }));
    res.json({ pendientes });
  } catch (err) {
    console.error("Error listando credenciales pendientes:", err);
    res.status(500).json({ error: "No se pudo consultar las credenciales pendientes." });
  }
});

router.post("/aprobar/:codigo", requireAuth, requireRol(...ROLES_CREDENCIALES), async (req, res) => {
  try {
    const encontrado = await buscarCredencialPorCodigo(req.params.codigo);
    if (!encontrado) {
      return res.status(404).json({ error: "No se encontró esa credencial." });
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEETS_CREDENCIALES_ID,
      range: `${NOMBRE_HOJA_CREDENCIALES}!I${encontrado.numeroFila}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["aprobada"]] },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Error aprobando credencial:", err);
    res.status(500).json({ error: "Ocurrió un error aprobando la credencial." });
  }
});

// Lista TODAS las credenciales (pendientes, aprobadas y eliminadas) — solo admin,
// para el panel de gestión donde también se pueden eliminar credenciales ya aprobadas.
router.get("/todas", requireAuth, requireRol("admin"), async (req, res) => {
  try {
    const respuesta = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEETS_CREDENCIALES_ID,
      range: `${NOMBRE_HOJA_CREDENCIALES}!A:I`,
    });
    const filas = (respuesta.data.values || []).slice(1);
    const credenciales = filas.map((f) => ({
      codigo_verificacion: f[0], cedula: f[1], nombre: f[2], cargo: f[3],
      codigo_rac: f[4], plantel: f[5], codigo_dea: f[6], fecha_generacion: f[7],
      estado: (f[8] || "").trim().toLowerCase(),
    }));
    res.json({ credenciales });
  } catch (err) {
    console.error("Error listando todas las credenciales:", err);
    res.status(500).json({ error: "No se pudo consultar las credenciales." });
  }
});

// Elimina (soft delete) una credencial: se marca estado = "eliminada" en la hoja,
// nunca se borra la fila — mantiene rastro para auditoría. Solo admin.
// Si la credencial ya estaba APROBADA, exige confirmarAprobada:true en el body
// para evitar que se revoque una credencial ya entregada por accidente.
router.delete("/:codigo", requireAuth, requireRol("admin"), async (req, res) => {
  try {
    const encontrado = await buscarCredencialPorCodigo(req.params.codigo);
    if (!encontrado) {
      return res.status(404).json({ error: "No se encontró esa credencial." });
    }

    const estadoActual = (encontrado.registro.estado || "").trim().toLowerCase();

    if (estadoActual === "eliminada") {
      return res.status(409).json({ error: "Esa credencial ya estaba eliminada." });
    }

    if (estadoActual === "aprobada" && req.body?.confirmarAprobada !== true) {
      return res.status(409).json({
        error: "Esta credencial ya fue APROBADA y probablemente ya fue entregada. Confirme la eliminación para continuar.",
        requiereConfirmacion: true,
      });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEETS_CREDENCIALES_ID,
      range: `${NOMBRE_HOJA_CREDENCIALES}!I${encontrado.numeroFila}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["eliminada"]] },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Error eliminando credencial:", err);
    res.status(500).json({ error: "Ocurrió un error eliminando la credencial." });
  }
});

// ---------- Página pública de verificación (a donde apunta el QR, sin auth) ----------
publico.get("/verificar/:codigo", async (req, res) => {
  let resultado;
  try {
    resultado = await buscarCredencialPorCodigo(req.params.codigo);
  } catch (err) {
    console.error("Error verificando credencial:", err);
  }

  const valida = resultado && (resultado.registro.estado || "").toLowerCase() === "aprobada";
  const r = resultado ? resultado.registro : null;

  res.type("html").send(`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Verificación de credencial</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #f2f1ee; color: #1f1f1f; }
  .banner { display: flex; align-items: center; gap: 12px; border-bottom: 3px solid #7a1e1e; padding-bottom: 14px; margin-bottom: 24px; }
  .banner .escudo { width: 42px; height: 42px; border-radius: 50%; background: #7a1e1e; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.7rem; text-align: center; }
  .banner .texto { font-size: 0.78rem; line-height: 1.3; }
  .banner .texto b { display: block; font-size: 0.9rem; }
  .estado { text-align: center; padding: 20px 16px; border-radius: 10px; margin-bottom: 20px; }
  .estado.valida { background: #e4f6e9; border: 1px solid #0a7a2e; }
  .estado.invalida { background: #fbe9e7; border: 1px solid #b3261e; }
  .estado .sello { font-size: 1.3rem; font-weight: 800; }
  .estado.valida .sello { color: #0a7a2e; }
  .estado.invalida .sello { color: #b3261e; }
  .datos { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px 20px; }
  .campo { margin: 6px 0; font-size: 0.9rem; }
  .campo b { display: inline-block; min-width: 110px; color: #555; }
  .pie { text-align: center; font-size: 0.75rem; color: #777; margin-top: 24px; }
</style>
</head>
<body>
  <div class="banner">
    <div class="escudo">MPPE</div>
    <div class="texto">
      <b>República Bolivariana de Venezuela</b>
      Ministerio del Poder Popular para la Educación
    </div>
  </div>

  ${valida ? `
    <div class="estado valida">
      <div class="sello">✓ CREDENCIAL VÁLIDA</div>
      <div>Documento verificado y auténtico</div>
    </div>
    <div class="datos">
      <div class="campo"><b>Nombre:</b> ${r.nombre}</div>
      <div class="campo"><b>Cédula:</b> ${r.cedula}</div>
      <div class="campo"><b>Cargo:</b> ${r.cargo}</div>
      <div class="campo"><b>Plantel:</b> ${r.plantel}</div>
      <div class="campo"><b>Código:</b> ${r.codigo_verificacion}</div>
    </div>
  ` : `
    <div class="estado invalida">
      <div class="sello">✕ NO VÁLIDA</div>
      <div>${
        !resultado
          ? "No se encontró ninguna credencial con este código."
          : ((r.estado || "").toLowerCase() === "eliminada"
            ? "Esta credencial fue eliminada y ya no es válida."
            : "Esta credencial aún no ha sido aprobada.")
      }</div>
    </div>
  `}

  <div class="pie">Expedido por el Centro de la Calidad Educativa del Estado Monagas</div>
</body>
</html>`);
});

module.exports = { router, publico };
