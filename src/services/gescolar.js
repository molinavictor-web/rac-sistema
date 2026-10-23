// gescolar.js — lectura de la hoja GESCOLAR (Google Sheets) para el módulo
// de Inspecciones. Es una copia independiente de la lectura que ya hace
// "Consultar planteles": usa la misma hoja (SHEETS_GESCOLAR_ID) y la misma
// cuenta de servicio, pero NO toca ni depende de ese módulo.
//
// Solo LEE. Los datos del plantel se copian al crear cada inspección
// (membrete), así la planilla queda como estaba ese día aunque GESCOLAR
// cambie después.

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
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
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

module.exports = { cargarGescolar, buscarPlanteles, obtenerPlantel, CAMPO_CODIGO, CAMPO_NOMBRE };
