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

// ---------- Generación del PDF con QR (mismo diseño que whatsapp-credenciales, + membrete oficial) ----------
async function generarPdfCredencial(registro, codigoVerificacion) {
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
    pagina.drawText(texto, {
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

  escribir("DIRECTOR (A): ");
  escribir(`CÓDIGO DEA: ${registro.codigo_plantel || "—"}`);
  escribir(`MUNICIPIO: ${registro.municipio || "—"}`);
  escribir(`PARROQUIA: ${registro.parroquia || "—"}`, { salto: 30 });

  const TIPOS_PERSONAL = { D: "DOCENTE", O: "OBRERO", A: "ADMINISTRATIVO" };
  const tipoPersonalTexto = TIPOS_PERSONAL[(registro.tipo_personal || "").toUpperCase()] || registro.tipo_personal || "—";
  const esDocente = (registro.tipo_personal || "").toUpperCase() === "D";
  const horas = esDocente ? registro.horas_academicas : registro.horas_adm;
  const fechaHoy = new Date().toLocaleDateString("es-VE");

  const parrafo =
    `Quien suscribe, ${DIRECTOR_NOMBRE}, Titular de la Cédula de Identidad N° ${DIRECTOR_CEDULA}, ` +
    `${DIRECTOR_CARGO}, ha propuesto a él (la) ciudadano (a): ${nombreCompleto}, Titular de la Cédula ` +
    `de Identidad N° V-${registro.cedula}, cargo nominal: ${registro.cargo || "—"}, Código: ${registro.codigo_cargo || "—"}, ` +
    `para ejercer las funciones de: ${tipoPersonalTexto}. Con una carga horaria de ` +
    `${horas || "—"} horas a partir del día ${fechaHoy}.`;

  const anchoMaximo = width - 112;
  const palabras = parrafo.split(" ");
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

  return pdfDoc.save();
}

// ---------- Google Sheets: registrar / buscar / aprobar credenciales ----------
async function registrarCredencialEnSheet(registro, codigoVerificacion) {
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
  ];
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEETS_CREDENCIALES_ID,
    range: `${NOMBRE_HOJA_CREDENCIALES}!A:I`,
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
router.post("/generar/:cedula", requireAuth, requireRol(...ROLES_CREDENCIALES), async (req, res) => {
  try {
    const registros = await buscarEmpleadoPorCedula(req.params.cedula);
    const registro =
      registros.find((r) => (r.situacion || "").toUpperCase() === "ACTIVO") || registros[0];
    if (!registro) {
      return res.status(404).json({ error: "No se encontró un registro en el RAC para esa cédula." });
    }

    const codigoVerificacion = crypto.randomBytes(5).toString("hex").toUpperCase();
    const pdfBytes = await generarPdfCredencial(registro, codigoVerificacion);
    await registrarCredencialEnSheet(registro, codigoVerificacion);

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
