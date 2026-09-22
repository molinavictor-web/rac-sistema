const express = require("express");
const { google } = require("googleapis");
const { requireAuth, requireRol } = require("../middleware/auth");

const router = express.Router(); // rutas montadas en /api/planteles-consulta

const ROLES_CONSULTA_PLANTELES = ["admin", "operador_plantel"];

const SHEETS_GESCOLAR_ID = process.env.SHEETS_GESCOLAR_ID;
const NOMBRE_HOJA_GESCOLAR = "GESCOLAR";
const RANGO_HOJA_GESCOLAR = `${NOMBRE_HOJA_GESCOLAR}!A:BC`; // 55 columnas (A..BC)
const DURACION_CACHE_MS = 15 * 60 * 1000; // 15 minutos

// Alcance de solo lectura -- esta pantalla es de consulta únicamente.
// Cuando se construya la edición de filas (fase futura), esto deberá
// ampliarse a "https://www.googleapis.com/auth/spreadsheets".
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

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

module.exports = router;
