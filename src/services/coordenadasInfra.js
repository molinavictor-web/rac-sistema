// coordenadasInfra.js — lee y completa la columna codigo_infraestructura de la hoja "Coordenadas Planteles"
// (la misma que usa el bot de WhatsApp y "Consultar planteles"). Columnas: codigo_dea, codigo_infraestructura,
// latitud, longitud, fecha_captura, ingeniero.
//
// Convención de la hoja: el código de infraestructura es el código DEA del plantel principal del edificio
// (p. ej. S0536N1608 comparte edificio con S0346D1608 y ambos llevan S0346D1608).
// Este servicio SOLO toca la columna B (y agrega filas sin coordenadas si el plantel aún no tiene fila);
// nunca modifica latitud ni longitud.

const { google } = require("googleapis");

const SHEETS_COORDENADAS_ID = process.env.SHEETS_COORDENADAS_ID;
const RANGO = "A:F";

let cliente = null;
function obtenerCliente() {
  if (!cliente) {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    cliente = google.sheets({ version: "v4", auth });
  }
  return cliente;
}

function configurada() {
  return Boolean(SHEETS_COORDENADAS_ID);
}

const texto = (v) => (v === undefined || v === null ? "" : String(v).trim());

// Filas de la hoja (sin el encabezado), con su número de fila real en Sheets.
async function leerFilas() {
  const resp = await obtenerCliente().spreadsheets.values.get({
    spreadsheetId: SHEETS_COORDENADAS_ID,
    range: RANGO,
  });
  const valores = resp.data.values || [];
  const filas = [];
  for (let i = 1; i < valores.length; i++) {
    const f = valores[i] || [];
    if (!texto(f[0])) continue;
    filas.push({ fila: i + 1, codigo_dea: texto(f[0]), codigo_infraestructura: texto(f[1]) });
  }
  return filas;
}

// Deja a todos los códigos DEA de `codigos` con el código de infraestructura `infra`.
// - Plantel con fila y columna B vacía → se escribe solo esa celda.
// - Plantel con fila y B igual → no se toca.
// - Plantel con fila y B DISTINTO → no se toca y se informa en `conflictos`.
// - Plantel sin fila → se agrega una fila [codigo, infra, "", "", fecha, ingeniero] (sin coordenadas).
async function registrarEdificio(infra, codigos, ingeniero) {
  const filas = await leerFilas();
  const porCodigo = new Map(filas.map((f) => [f.codigo_dea.toLowerCase(), f]));
  const actualizar = [];
  const agregar = [];
  const conflictos = [];
  const fecha = new Date().toISOString().slice(0, 10);
  for (const codigo of codigos) {
    const f = porCodigo.get(String(codigo).toLowerCase());
    if (!f) { agregar.push([codigo, infra, "", "", fecha, ingeniero || ""]); continue; }
    if (!f.codigo_infraestructura) actualizar.push({ range: `B${f.fila}`, values: [[infra]] });
    else if (f.codigo_infraestructura !== infra) conflictos.push({ codigo_dea: codigo, codigo_infraestructura: f.codigo_infraestructura });
  }
  const cli = obtenerCliente();
  if (actualizar.length) {
    await cli.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEETS_COORDENADAS_ID,
      requestBody: { valueInputOption: "RAW", data: actualizar },
    });
  }
  if (agregar.length) {
    await cli.spreadsheets.values.append({
      spreadsheetId: SHEETS_COORDENADAS_ID,
      range: RANGO,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: agregar },
    });
  }
  return { actualizadas: actualizar.length, agregadas: agregar.length, conflictos };
}

module.exports = { configurada, leerFilas, registrarEdificio };
