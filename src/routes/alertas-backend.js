const express = require("express");
const { pool, conTransaccionAuditada } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");
const router = express.Router();
/**
 * GET /api/alertas?estado=pendiente&tipo=no_existe_ministerio
 * Bandeja de alertas para el operador.
 *
 * CORRECCIÓN: antes, si no se enviaba "estado" en la URL, se asumía
 * "pendiente" por defecto -- pero el frontend siempre llama a esta ruta
 * SIN query params y filtra en el navegador sobre ese único resultado, así
 * que el combo "Revisadas/Resueltas/Descartadas/Todas" nunca mostraba nada
 * (el arreglo que llegaba del servidor jamás tuvo esos estados). Ahora, si
 * no se manda "estado" (o se manda "todas"), no se filtra por estado y se
 * devuelven todas -- el frontend es quien decide qué pedir en cada caso.
 */
router.get("/", requireAuth, async (req, res) => {
  const estado = req.query.estado;
  const condiciones = [];
  const valores = [];
  if (estado && estado !== "todas") {
    valores.push(estado);
    condiciones.push(`a.estado = $${valores.length}`);
  }
  if (req.query.tipo) {
    valores.push(req.query.tipo);
    condiciones.push(`a.tipo = $${valores.length}`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT a.*, u.nombre AS revisado_por_nombre
     FROM alertas a
     LEFT JOIN usuarios u ON u.id = a.revisado_por
     ${where}
     ORDER BY a.creado_en DESC
     LIMIT 200`,
    valores
  );
  res.json(rows);
});
/**
 * PATCH /api/alertas/:id
 * Marca una alerta como revisada/resuelta/descartada.
 * Solo operador/admin.
 */
router.patch("/:id", requireAuth, requireRol("operador", "admin"), async (req, res) => {
  const { estado } = req.body; // revisado / resuelto / descartado
  if (!["revisado", "resuelto", "descartado"].includes(estado)) {
    return res.status(400).json({ error: "Estado inválido." });
  }
  const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
    const { rows } = await client.query(
      `UPDATE alertas
       SET estado = $1, revisado_por = $2, fecha_revision = now()
       WHERE id = $3 RETURNING *`,
      [estado, req.usuario.id, req.params.id]
    );
    return rows[0];
  });
  if (!resultado) {
    return res.status(404).json({ error: "Alerta no encontrada." });
  }
  res.json(resultado);
});
module.exports = router;
