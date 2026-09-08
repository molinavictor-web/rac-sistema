const express = require("express");
const { pool, conTransaccionAuditada } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");
const router = express.Router();
/**
 * GET /api/alertas?estado=pendiente&tipo=no_existe_ministerio
 * Bandeja de alertas para el operador.
 *
 * MEJORA 7 (2026-09-07):
 *  - Se quitó el LIMIT 200 fijo -- con 8.000+ alertas, ese límite hacía que
 *    tanto la tabla como cualquier resumen/conteo del frontend solo vieran
 *    una fracción arbitraria (las 200 más recientes), sin ninguna forma de
 *    saber que había más. La cantidad de alertas es manejable para traer
 *    completa en una sola consulta (mismo orden de magnitud que otras
 *    tablas del sistema que ya se cargan enteras, ej. planteles/exportar).
 *  - Sin parámetro "estado": se sigue devolviendo solo pendientes (mismo
 *    comportamiento histórico -- otras pantallas dependen de esto, ej. un
 *    badge de conteo de pendientes).
 *  - estado=todas: ahora SÍ quita el filtro de estado (antes cualquier
 *    valor que no fuera uno de los 4 estados reales terminaba cayendo en
 *    el default "pendiente" porque el frontend mandaba la petición SIN el
 *    parámetro -- "Todas" nunca había mostrado nada distinto de pendientes).
 *  - Respuesta ahora es { alertas, total } en vez del arreglo plano -- el
 *    frontend ya soporta ambas formas (RAC.lista busca la clave "alertas"
 *    si no es un arreglo directo), así que esto no rompe nada existente.
 */
router.get("/", requireAuth, async (req, res) => {
  const estadoParam = req.query.estado;
  const condiciones = [];
  const valores = [];

  if (estadoParam === undefined) {
    valores.push("pendiente");
    condiciones.push(`a.estado = $${valores.length}`);
  } else if (estadoParam !== "todas") {
    valores.push(estadoParam);
    condiciones.push(`a.estado = $${valores.length}`);
  }
  // estadoParam === "todas" -> sin condición de estado, trae todas.

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
     ORDER BY a.creado_en DESC`,
    valores
  );
  res.json({ alertas: rows, total: rows.length });
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
