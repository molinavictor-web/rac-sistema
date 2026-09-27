const express = require("express");
const { google } = require("googleapis");
const { requireAuth, requireRol } = require("../middleware/auth");

const router = express.Router(); // rutas montadas en /api/directorio-directores

const ROLES_DIRECTORIO = ["admin", "operador_plantel", "operador"];

const SHEETS_GESCOLAR_ID = process.env.SHEETS_GESCOLAR_ID;
const NOMBRE_HOJA_GESCOLAR = "GESCOLAR";
const RANGO_HOJA_GESCOLAR = `${NOMBRE_HOJA_GESCOLAR}!A:BC`; // 55 columnas (A..BC)
const DURACION_CACHE_MS = 15 * 60 * 1000; // 15 minutos

// Mismo patrón de autenticación que plantelesConsulta.js -- lectura y
// ESCRITURA de Sheets con la cuenta de servicio. La hoja GESCOLAR debe estar
// compartida como Editor con esa cuenta de servicio para que el guardado
// funcione (la lectura funciona igual aunque solo esté compartida como
// Lector).
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// Campos del director que este módulo puede leer/editar, con la llave EXACTA
// del encabezado real de la hoja GESCOLAR (confirmada por el usuario).
const CAMPOS_DIRECTOR = [
  "director_nombre",
  "tipo_documento",
  "documento_identidad",
  "telefono_director",
  "telefono_movil_director",
  "correo",
];

// Caché simple del contenido crudo de la hoja (encabezado + filas como
// arreglos, SIN convertir a objetos) -- se necesita el arreglo crudo para
// poder ubicar el número de fila real y escribir celda por celda.
let cache = { encabezado: [], filas: [], cargadoEn: 0 };

// Convierte un índice de columna 0-based a letra(s) de columna estilo Sheets
// (0->A, 25->Z, 26->AA, ...) -- para armar los rangos de escritura A1.
function indiceALetraColumna(indice) {
  let n = indice + 1;
  let letra = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    n = Math.floor((n - 1) / 26);
  }
  return letra;
}

async function cargarGescolarCrudo(forzar = false) {
  const vencido = Date.now() - cache.cargadoEn > DURACION_CACHE_MS;
  if (!forzar && !vencido && cache.filas.length) return cache;

  const respuesta = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEETS_GESCOLAR_ID,
    range: RANGO_HOJA_GESCOLAR,
  });
  const valores = respuesta.data.values || [];
  const [encabezado, ...filas] = valores;
  cache = { encabezado: encabezado || [], filas, cargadoEn: Date.now() };
  return cache;
}

function filaAObjeto(encabezado, fila) {
  const obj = {};
  encabezado.forEach((col, i) => {
    obj[col] = fila[i] !== undefined ? fila[i] : "";
  });
  return obj;
}

// GET /buscar?q=... -- coincidencia parcial (sin distinguir mayúsculas)
// sobre nombre del plantel, código DEA o nombre del director.
router.get("/buscar", requireAuth, requireRol(...ROLES_DIRECTORIO), async (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  if (q.length < 2) {
    return res.status(400).json({ error: "Escribe al menos 2 caracteres para buscar." });
  }

  try {
    const { encabezado, filas } = await cargarGescolarCrudo();
    const resultados = [];

    for (const fila of filas) {
      if (!fila.some((v) => v !== undefined && v !== "")) continue; // fila vacía
      const obj = filaAObjeto(encabezado, fila);
      const coincide = ["nombre_plantel", "cod_plantel", "director_nombre"].some((campo) =>
        String(obj[campo] || "").toLowerCase().includes(q)
      );
      if (coincide) {
        resultados.push({
          cod_plantel: obj.cod_plantel,
          nombre_plantel: obj.nombre_plantel,
          municipio: obj.municipio,
          parroquia: obj.parroquia,
          director_nombre: obj.director_nombre,
          telefono_director: obj.telefono_director,
          telefono_movil_director: obj.telefono_movil_director,
          correo: obj.correo,
        });
      }
    }

    res.json({
      total: resultados.length,
      directores: resultados.slice(0, 200),
      limitado: resultados.length > 200,
    });
  } catch (err) {
    console.error("Error consultando directorio de directores:", err);
    res.status(500).json({ error: "No se pudo consultar la hoja de GESCOLAR. Verifica que esté compartida con la cuenta de servicio." });
  }
});

// GET /:codigoDea -- datos completos del director de un plantel puntual
// (incluye los campos editables completos, para precargar el formulario).
router.get("/:codigoDea", requireAuth, requireRol(...ROLES_DIRECTORIO), async (req, res) => {
  const codigoDea = (req.params.codigoDea || "").trim();
  if (!codigoDea) return res.status(400).json({ error: "Falta el código DEA." });

  try {
    const { encabezado, filas } = await cargarGescolarCrudo();
    const idxCodigo = encabezado.indexOf("cod_plantel");
    const fila = filas.find((f) => (f[idxCodigo] || "").trim() === codigoDea);
    if (!fila) {
      return res.status(404).json({ error: "No se encontró ese código DEA en GESCOLAR." });
    }
    const obj = filaAObjeto(encabezado, fila);
    res.json({
      cod_plantel: obj.cod_plantel,
      nombre_plantel: obj.nombre_plantel,
      municipio: obj.municipio,
      parroquia: obj.parroquia,
      director_nombre: obj.director_nombre,
      tipo_documento: obj.tipo_documento,
      documento_identidad: obj.documento_identidad,
      telefono_director: obj.telefono_director,
      telefono_movil_director: obj.telefono_movil_director,
      correo: obj.correo,
    });
  } catch (err) {
    console.error("Error consultando director:", err);
    res.status(500).json({ error: "No se pudo consultar la hoja de GESCOLAR." });
  }
});

// POST /:codigoDea -- guarda los datos del director para ese plantel.
// Escribe SOLO las celdas de CAMPOS_DIRECTOR que vengan en el body, una por
// una (batchUpdate de varios rangos puntuales), sin tocar el resto de las
// 55 columnas de la fila.
router.post("/:codigoDea", requireAuth, requireRol(...ROLES_DIRECTORIO), async (req, res) => {
  const codigoDea = (req.params.codigoDea || "").trim();
  if (!codigoDea) return res.status(400).json({ error: "Falta el código DEA." });
  if (!SHEETS_GESCOLAR_ID) {
    return res.status(500).json({ error: "Falta configurar SHEETS_GESCOLAR_ID en el servidor." });
  }

  try {
    // Fresco (forzar=true): si dos personas editan casi al mismo tiempo, no
    // queremos calcular el número de fila sobre un caché de hasta 15 min.
    const { encabezado, filas } = await cargarGescolarCrudo(true);
    const idxCodigo = encabezado.indexOf("cod_plantel");
    const indiceFila = filas.findIndex((f) => (f[idxCodigo] || "").trim() === codigoDea);
    if (indiceFila === -1) {
      return res.status(404).json({ error: "No se encontró ese código DEA en GESCOLAR." });
    }
    const numeroFilaSheet = indiceFila + 2; // +1 por el encabezado, +1 por ser 1-indexado

    const data = [];
    for (const campo of CAMPOS_DIRECTOR) {
      if (req.body[campo] === undefined) continue;
      const idxCampo = encabezado.indexOf(campo);
      if (idxCampo === -1) continue; // por si algún día cambia el encabezado real
      const letra = indiceALetraColumna(idxCampo);
      data.push({
        range: `${NOMBRE_HOJA_GESCOLAR}!${letra}${numeroFilaSheet}`,
        values: [[req.body[campo] === null ? "" : String(req.body[campo])]],
      });
    }
    if (!data.length) {
      return res.status(400).json({ error: "No se envió ningún campo para actualizar." });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEETS_GESCOLAR_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });

    cache.cargadoEn = 0; // fuerza a releer en la próxima consulta
    res.json({ ok: true });
  } catch (err) {
    console.error("Error guardando datos del director:", err);
    res.status(500).json({
      error: "No se pudo guardar. Verifica que la hoja GESCOLAR esté compartida como Editor con la cuenta de servicio.",
    });
  }
});

module.exports = router;
