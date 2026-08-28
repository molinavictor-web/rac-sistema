const express = require("express");
const { pool, conTransaccionAuditada } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");
const multer = require('multer');

const router = express.Router();

/**
 * GET /api/planteles?municipio_id=...&q=...
 * Búsqueda del catálogo maestro (para autocompletar en el frontend
 * al momento de registrar o trasladar a alguien).
 * Devuelve { planteles, total } -- total es el conteo real, ya que
 * los resultados vienen limitados a 100 filas por consulta.
 * Incluye municipio_nombre (join con municipios) para mostrarlo
 * directamente en listas/selects del frontend sin una llamada aparte.
 */
router.get("/", requireAuth, async (req, res) => {
  const condiciones = [];
  const valores = [];

  if (req.query.municipio_id) {
    valores.push(req.query.municipio_id);
    condiciones.push(`p.municipio_id = $${valores.length}`);
  }
  if (req.query.q) {
    valores.push(`%${req.query.q}%`);
    condiciones.push(`(p.nombre ILIKE $${valores.length} OR p.codigo_plantel ILIKE $${valores.length})`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `SELECT p.*, m.nombre AS municipio_nombre
     FROM planteles p
     LEFT JOIN municipios m ON m.id = p.municipio_id
     ${where}
     ORDER BY p.nombre LIMIT 100`,
    valores
  );
  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*) FROM planteles p ${where}`,
    valores
  );
  res.json({ planteles: rows, total: parseInt(totalRows[0].count, 10) });
});

/**
 * PATCH /api/planteles/:id
 * Solo admin -- para reflejar cambios reales (cierre, cambio de
 * dependencia, etc.), ya que los planteles también cambian con
 * el tiempo. Auditado igual que el resto.
 */
router.patch("/:id", requireAuth, requireRol("admin"), async (req, res) => {
  const camposPermitidos = ["nombre", "dependencia", "estado", "fecha_cierre", "municipio_id"];
  const sets = [];
  const valores = [];

  for (const campo of camposPermitidos) {
    if (req.body[campo] !== undefined) {
      valores.push(req.body[campo]);
      sets.push(`${campo} = $${valores.length}`);
    }
  }
  if (sets.length === 0) {
    return res.status(400).json({ error: "No se envió ningún campo para actualizar." });
  }
  valores.push(req.params.id);

  const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
    const { rows } = await client.query(
      `UPDATE planteles SET ${sets.join(", ")}, actualizado_en = now()
       WHERE id = $${valores.length} RETURNING *`,
      valores
    );
    return rows[0];
  });

  if (!resultado) {
    return res.status(404).json({ error: "Plantel no encontrado." });
  }
  res.json(resultado);
});

// ============================================================
// Carga masiva de planteles (upsert por codigo_plantel)
// ============================================================

const MAX_UPLOAD_PLANTELES_MB = parseInt(process.env.MAX_UPLOAD_PLANTELES_MB || '20', 10);

const uploadPlanteles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_PLANTELES_MB * 1024 * 1024 }
});

const BATCH_SIZE = 1000;

// Parser simple de una línea CSV delimitada por coma.
// Si en el futuro aparecen campos con comas internas entre comillas,
// hay que cambiar esto por una librería (ej. csv-parse). Por ahora
// el archivo real de planteles no trae comillas ni comas dentro de campos.
function parsearLineaCSV(linea) {
  return linea.split(',').map(campo => campo.trim());
}

function normalizarTexto(valor) {
  if (valor === undefined || valor === null) return null;
  const limpio = valor.trim();
  return limpio.length === 0 ? null : limpio;
}

// POST /api/planteles/cargar-masiva
// Solo admin. Carga el CSV completo de planteles (delimitado por coma,
// codificación latin1/ANSI, tal como lo exporta Excel con
// "CSV (delimitado por comas) (*.csv)").
// Columnas esperadas en el archivo, en este orden:
// estado, municipio, parroquia, cod_plantel, nombre_plantel,
// tipo_dependencia, denominacion, direccion
//
// Comportamiento: UPSERT por codigo_plantel (no TRUNCATE), porque
// planteles.id es referenciado por rac.plantel_id.
router.post('/cargar-masiva', requireAuth, requireRol('admin'), uploadPlanteles.single('archivo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo' });
  }

  const client = await pool.connect();

  try {
    // Decodificar el buffer como latin1 (ANSI), igual que personalMinisterio.js
    const contenido = req.file.buffer.toString('latin1');
    const lineas = contenido.split(/\r?\n/);

    if (lineas.length < 2) {
      return res.status(400).json({ error: 'El archivo no tiene datos' });
    }

    // Descartar encabezado
    const filasDatos = lineas.slice(1);

    // Precargar municipios: nombre normalizado (mayúsculas, sin espacios extra) -> id
    const { rows: municipiosRows } = await client.query('SELECT id, nombre FROM municipios');
    const mapaMunicipios = new Map();
    for (const m of municipiosRows) {
      mapaMunicipios.set(m.nombre.trim().toUpperCase(), m.id);
    }

    let insertados = 0;
    let actualizados = 0;
    let filasConError = 0;
    let lineasVaciasIgnoradas = 0;
    const errores = [];

    // Desactivar auditoría alrededor de la carga masiva (mismo patrón que personalMinisterio.js)
    await client.query('BEGIN');
    await client.query(`ALTER TABLE planteles DISABLE TRIGGER trg_auditoria_planteles`);

    let lote = [];

    async function procesarLote(lote) {
      if (lote.length === 0) return;

      const columnas = [
        'codigo_plantel', 'nombre', 'municipio_id', 'dependencia',
        'parroquia', 'denominacion', 'direccion', 'actualizado_en'
      ];

      const valores = [];
      const placeholders = lote.map((fila, i) => {
        const base = i * columnas.length;
        valores.push(
          fila.codigo_plantel, fila.nombre, fila.municipio_id, fila.dependencia,
          fila.parroquia, fila.denominacion, fila.direccion, new Date()
        );
        const nums = columnas.map((_, j) => `$${base + j + 1}`);
        return `(${nums.join(', ')})`;
      }).join(', ');

      const sql = `
        INSERT INTO planteles (${columnas.join(', ')})
        VALUES ${placeholders}
        ON CONFLICT (codigo_plantel) DO UPDATE SET
          nombre = EXCLUDED.nombre,
          municipio_id = EXCLUDED.municipio_id,
          dependencia = EXCLUDED.dependencia,
          parroquia = EXCLUDED.parroquia,
          denominacion = EXCLUDED.denominacion,
          direccion = EXCLUDED.direccion,
          actualizado_en = EXCLUDED.actualizado_en
        RETURNING (xmax = 0) AS es_insert
      `;

      const { rows } = await client.query(sql, valores);
      for (const r of rows) {
        if (r.es_insert) insertados++;
        else actualizados++;
      }
    }

    for (let i = 0; i < filasDatos.length; i++) {
      const linea = filasDatos[i];

      // Línea vacía o solo separadores (mismo problema que ya se vio en rac completo)
      if (!linea || linea.replace(/,/g, '').trim().length === 0) {
        lineasVaciasIgnoradas++;
        continue;
      }

      const campos = parsearLineaCSV(linea);
      const [, municipioTexto, parroquia, codPlantel, nombrePlantel, tipoDependencia, denominacion, direccion] = campos;

      const codigoPlantelLimpio = normalizarTexto(codPlantel);
      if (!codigoPlantelLimpio) {
        filasConError++;
        errores.push({ linea: i + 2, motivo: 'cod_plantel vacío' });
        continue;
      }

      const municipioId = mapaMunicipios.get((municipioTexto || '').trim().toUpperCase());
      if (!municipioId) {
        filasConError++;
        errores.push({ linea: i + 2, codigo_plantel: codigoPlantelLimpio, motivo: `municipio no encontrado: "${municipioTexto}"` });
        continue;
      }

      lote.push({
        codigo_plantel: codigoPlantelLimpio,
        nombre: normalizarTexto(nombrePlantel),
        municipio_id: municipioId,
        dependencia: normalizarTexto(tipoDependencia),
        parroquia: normalizarTexto(parroquia),
        denominacion: normalizarTexto(denominacion),
        direccion: normalizarTexto(direccion)
      });

      if (lote.length >= BATCH_SIZE) {
        await procesarLote(lote);
        lote = [];
      }
    }

    // Procesar el último lote incompleto
    await procesarLote(lote);

    await client.query(`ALTER TABLE planteles ENABLE TRIGGER trg_auditoria_planteles`);
    await client.query('COMMIT');

    res.json({
      mensaje: 'Carga de planteles completada',
      insertados,
      actualizados,
      filasConError,
      lineasVaciasIgnoradas,
      errores: errores.slice(0, 50) // no devolver miles de errores si algo sale mal
    });

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error en carga masiva de planteles:', error);
    res.status(500).json({ error: 'Error al procesar el archivo', detalle: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
