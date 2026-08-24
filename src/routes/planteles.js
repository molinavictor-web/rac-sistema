const express = require("express");
const { pool, conTransaccionAuditada } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");

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

module.exports = router;
