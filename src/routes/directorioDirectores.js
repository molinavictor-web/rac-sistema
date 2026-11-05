const express = require("express");
const { google } = require("googleapis");
const { requireAuth, requireRol } = require("../middleware/auth");
const { pool } = require("../db/pool");
const directoresSupervision = require("../services/directoresSupervision");

const router = express.Router(); // rutas montadas en /api/directorio-directores

const ROLES_DIRECTORIO = ["admin", "operador_plantel", "operador"];
// Los perfiles del módulo Inspecciones solo pueden CONSULTAR el directorio (nunca editarlo).
const ROLES_LECTURA_DIRECTORIO = [...ROLES_DIRECTORIO, "insp_coordinador", "insp_ingeniero", "insp_consulta"];

const SHEETS_GESCOLAR_ID = process.env.SHEETS_GESCOLAR_ID;
const NOMBRE_HOJA_GESCOLAR = "GESCOLAR";
const RANGO_HOJA_GESCOLAR = NOMBRE_HOJA_GESCOLAR; // hoja completa: incluye las columnas que se agreguen al final
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

// ---------------------------------------------------------------------------------------------
// Actualizar la hoja GESCOLAR con los datos de directores de Supervisión (solo admin).
// Vista previa → aplicar → (si hace falta) restaurar. Reglas en services/directoresSupervision.js.
//   GET  /sincronizar-supervision/vista-previa     lo que se cambiaría (no escribe nada)
//   POST /sincronizar-supervision/aplicar          {confirmar:true}: recalcula, escribe y guarda el registro
//   GET  /sincronizar-supervision/historial        actualizaciones hechas
//   POST /sincronizar-supervision/:id/revertir     devuelve cada celda a su valor anterior (si nadie la cambió después)
// ---------------------------------------------------------------------------------------------
async function planDeSupervision() {
  const { encabezado, filas } = await cargarGescolarCrudo(true); // siempre fresco
  const sup = (await pool.query("SELECT codigo_plantel, cedula, nombre, telefono, correo FROM directores_supervision")).rows;
  return { encabezado, filas, plan: directoresSupervision.planear(encabezado, filas, sup) };
}

async function escribirCeldas(encabezado, celdas) {
  // celdas: [{fila, campo, valor}] — por tandas, para no pasarse del límite de Google
  for (let i = 0; i < celdas.length; i += 400) {
    const data = celdas.slice(i, i + 400).map((c) => ({
      range: `${NOMBRE_HOJA_GESCOLAR}!${indiceALetraColumna(encabezado.indexOf(c.campo))}${c.fila}`,
      values: [[c.valor]],
    }));
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEETS_GESCOLAR_ID,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
  }
}

router.get("/sincronizar-supervision/vista-previa", requireAuth, requireRol("admin"), async (req, res) => {
  try {
    const { plan } = await planDeSupervision();
    res.json(plan);
  } catch (err) {
    console.error("Sincronizar con Supervisión (vista previa):", err);
    res.status(500).json({ error: "No se pudo preparar la vista previa. Verifica la hoja GESCOLAR y la base de datos." });
  }
});

router.post("/sincronizar-supervision/aplicar", requireAuth, requireRol("admin"), async (req, res) => {
  if (!req.body || req.body.confirmar !== true) return res.status(400).json({ error: "Falta confirmar la actualización." });
  if (!SHEETS_GESCOLAR_ID) return res.status(500).json({ error: "Falta configurar SHEETS_GESCOLAR_ID en el servidor." });
  try {
    const { encabezado, plan } = await planDeSupervision(); // se recalcula aquí: no se confía en lo que vio la pantalla
    if (!plan.cambios.length) return res.json({ ok: true, aplicados: 0, resumen: plan.resumen });
    // 1) se guarda el registro (con los valores anteriores) ANTES de escribir en la hoja
    const log = await pool.query(
      "INSERT INTO directorio_sincronizaciones (usuario_id, resumen, cambios) VALUES ($1, $2::jsonb, $3::jsonb) RETURNING id",
      [req.usuario.id, JSON.stringify(plan.resumen), JSON.stringify(plan.cambios)]);
    // 2) se escribe en la hoja
    const celdas = [];
    plan.cambios.forEach((c) => c.campos.forEach((x) => celdas.push({ fila: c.fila, campo: x.campo, valor: x.despues })));
    await escribirCeldas(encabezado, celdas);
    cache.cargadoEn = 0;
    res.json({ ok: true, id: log.rows[0].id, aplicados: plan.cambios.length, celdas: celdas.length, resumen: plan.resumen });
  } catch (err) {
    console.error("Sincronizar con Supervisión (aplicar):", err);
    res.status(500).json({ error: "No se pudo actualizar la hoja. Puede haber quedado a medias: revisa el historial y usa «Restaurar» si hace falta." });
  }
});

router.get("/sincronizar-supervision/historial", requireAuth, requireRol("admin"), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.creado_en, s.resumen, s.revertido_en, u.nombre AS usuario,
            jsonb_array_length(s.cambios) AS planteles
     FROM directorio_sincronizaciones s LEFT JOIN usuarios u ON u.id = s.usuario_id ORDER BY s.id DESC LIMIT 20`);
  res.json({ historial: rows });
});

router.post("/sincronizar-supervision/:id/revertir", requireAuth, requireRol("admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Registro no válido." });
  try {
    const s = (await pool.query("SELECT * FROM directorio_sincronizaciones WHERE id = $1", [id])).rows[0];
    if (!s) return res.status(404).json({ error: "No existe esa actualización." });
    if (s.revertido_en) return res.status(409).json({ error: "Esta actualización ya se restauró." });
    const { encabezado, filas } = await cargarGescolarCrudo(true);
    const idxCodigo = encabezado.indexOf("cod_plantel");
    const celdas = []; let omitidas = 0;
    s.cambios.forEach((c) => {
      const i = filas.findIndex((f) => String(f[idxCodigo] || "").trim().toUpperCase() === c.codigo);
      if (i === -1) { omitidas += c.campos.length; return; }
      c.campos.forEach((x) => {
        const actual = String(filas[i][encabezado.indexOf(x.campo)] || "").trim();
        // solo se restaura si la celda sigue como la dejó la actualización (si alguien la editó después, se respeta)
        if (actual === String(x.despues)) celdas.push({ fila: i + 2, campo: x.campo, valor: x.antes }); else omitidas += 1;
      });
    });
    if (celdas.length) await escribirCeldas(encabezado, celdas);
    await pool.query("UPDATE directorio_sincronizaciones SET revertido_en = NOW(), revertido_por = $2 WHERE id = $1", [id, req.usuario.id]);
    cache.cargadoEn = 0;
    res.json({ ok: true, restauradas: celdas.length, omitidas });
  } catch (err) {
    console.error("Sincronizar con Supervisión (restaurar):", err);
    res.status(500).json({ error: "No se pudo restaurar la hoja." });
  }
});

// GET /buscar?q=... -- coincidencia parcial (sin distinguir mayúsculas)
// sobre nombre del plantel, código DEA o nombre del director.
router.get("/buscar", requireAuth, requireRol(...ROLES_LECTURA_DIRECTORIO), async (req, res) => {
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
router.get("/:codigoDea", requireAuth, requireRol(...ROLES_LECTURA_DIRECTORIO), async (req, res) => {
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
