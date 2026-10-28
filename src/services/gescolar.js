// gescolar.js — lectura de la hoja GESCOLAR (Google Sheets) para el módulo
// de Inspecciones. Es una copia independiente de la lectura que ya hace
// "Consultar planteles": usa la misma hoja (SHEETS_GESCOLAR_ID) y la misma
// cuenta de servicio, pero NO toca ni depende de ese módulo.
//
// Lee la hoja y, además, escribe UNA sola columna: RESPONSABLE (el ingeniero que
// inspecciona cada plantel). Los datos del plantel se copian al crear cada
// inspección (membrete), así la planilla queda como estaba ese día aunque
// GESCOLAR cambie después.

const { google } = require("googleapis");

const SHEETS_GESCOLAR_ID = process.env.SHEETS_GESCOLAR_ID;
const RANGO_HOJA_GESCOLAR = "GESCOLAR!A:BC"; // 55 columnas (A..BC)
const DURACION_CACHE_MS = 15 * 60 * 1000; // 15 minutos

// Encabezados reales de la hoja (confirmados en los otros módulos).
const CAMPO_CODIGO = "cod_plantel";
const CAMPO_NOMBRE = "nombre_plantel";
const CAMPOS_BUSQUEDA = [CAMPO_NOMBRE, CAMPO_CODIGO, "municipio", "parroquia"];

let cliente = null;
function obtenerCliente() {
  if (!cliente) {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
      // Lectura y escritura: la hoja ya está compartida como Editor con esta cuenta (igual que el Directorio).
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    cliente = google.sheets({ version: "v4", auth });
  }
  return cliente;
}

let cache = { datos: [], cargadoEn: 0 };

// Convierte filas crudas de Sheets en objetos usando la fila de encabezado.
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

  if (!SHEETS_GESCOLAR_ID) {
    throw new Error("Falta configurar SHEETS_GESCOLAR_ID en el servidor.");
  }
  const respuesta = await obtenerCliente().spreadsheets.values.get({
    spreadsheetId: SHEETS_GESCOLAR_ID,
    range: RANGO_HOJA_GESCOLAR,
  });
  cache = { datos: filasAObjetos(respuesta.data.values || []), cargadoEn: Date.now() };
  return cache.datos;
}

function minusculas(valor) {
  return String(valor || "").toLowerCase();
}

// Búsqueda parcial, sin distinguir mayúsculas, por nombre, código, municipio o parroquia.
async function buscarPlanteles(texto, limite = 30) {
  const q = minusculas(texto).trim();
  const datos = await cargarGescolar();
  const encontrados = datos.filter((p) => CAMPOS_BUSQUEDA.some((c) => minusculas(p[c]).includes(q)));
  return {
    total: encontrados.length,
    planteles: encontrados.slice(0, limite),
    limitado: encontrados.length > limite,
  };
}

// Devuelve la fila COMPLETA del plantel (todas las columnas) o null si el
// código no existe en GESCOLAR.
async function obtenerPlantel(codigoDea) {
  const codigo = minusculas(codigoDea).trim();
  const datos = await cargarGescolar();
  return datos.find((p) => minusculas(p[CAMPO_CODIGO]).trim() === codigo) || null;
}

const CAMPO_RESPONSABLE = "RESPONSABLE";

// Convierte un índice de columna 0-based en letra de columna de Sheets (0→A, 12→M, 26→AA).
function indiceALetra(indice) {
  let n = indice + 1;
  let letra = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    n = Math.floor((n - 1) / 26);
  }
  return letra;
}

// Escribe el nombre del ingeniero en la columna RESPONSABLE de la fila de ese plantel
// (nombre vacío = sin responsable). Relee la hoja justo antes para ubicar la fila real,
// escribe SOLO esa celda y como texto plano (RAW: nada se interpreta como fórmula).
// Devuelve el valor anterior de la celda.
async function asignarResponsable(codigoDea, nombre) {
  if (!SHEETS_GESCOLAR_ID) throw new Error("Falta configurar SHEETS_GESCOLAR_ID en el servidor.");
  const resp = await obtenerCliente().spreadsheets.values.get({
    spreadsheetId: SHEETS_GESCOLAR_ID,
    range: RANGO_HOJA_GESCOLAR,
  });
  const [encabezado, ...filas] = resp.data.values || [];
  if (!encabezado) throw new Error("La hoja GESCOLAR está vacía.");
  const idxCodigo = encabezado.findIndex((c) => String(c).trim() === CAMPO_CODIGO);
  const idxResp = encabezado.findIndex((c) => String(c).trim() === CAMPO_RESPONSABLE);
  if (idxCodigo === -1) throw new Error(`No se encontró la columna ${CAMPO_CODIGO} en GESCOLAR.`);
  if (idxResp === -1) throw new Error(`No se encontró la columna ${CAMPO_RESPONSABLE} en GESCOLAR.`);
  const buscado = minusculas(codigoDea).trim();
  const indiceFila = filas.findIndex((f) => minusculas(f[idxCodigo]).trim() === buscado);
  if (indiceFila === -1) {
    const err = new Error(`El plantel ${codigoDea} no está en GESCOLAR.`);
    err.noEncontrado = true;
    throw err;
  }
  const anterior = filas[indiceFila][idxResp] !== undefined ? String(filas[indiceFila][idxResp]) : "";
  await obtenerCliente().spreadsheets.values.update({
    spreadsheetId: SHEETS_GESCOLAR_ID,
    range: `GESCOLAR!${indiceALetra(idxResp)}${indiceFila + 2}`, // +1 encabezado, +1 porque Sheets cuenta desde 1
    valueInputOption: "RAW",
    requestBody: { values: [[nombre == null ? "" : String(nombre)]] },
  });
  cache.cargadoEn = 0; // la próxima lectura trae la hoja actualizada
  return { anterior, fila: indiceFila + 2 };
}

module.exports = { cargarGescolar, buscarPlanteles, obtenerPlantel, asignarResponsable, CAMPO_CODIGO, CAMPO_NOMBRE, CAMPO_RESPONSABLE };
