const express = require("express");
const { pool, conTransaccionAuditada } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/rac?cedula=...&plantel_id=...&municipio_id=...
 * Consulta general con filtros opcionales. Todos los roles autenticados
 * pueden consultar (el encargado de municipio solo ve resultados que
 * incluyan su municipio, filtrado en el frontend/consulta según convenga).
 * Devuelve { rac, total } -- total es el conteo real (los resultados
 * vienen limitados a 200 filas), para que el frontend pueda mostrar
 * la cifra completa (ej. en el dashboard) sin traer todas las filas.
 */
router.get("/", requireAuth, async (req, res) => {
  const { cedula, plantel_id, periodo_escolar } = req.query;
  const condiciones = [];
  const valores = [];

  if (cedula) {
    valores.push(cedula.trim().replace(/^0+/, ""));
    condiciones.push(`r.cedula = $${valores.length}`);
  }
  if (plantel_id) {
    valores.push(plantel_id);
    condiciones.push(`r.plantel_id = $${valores.length}`);
  }
  if (periodo_escolar) {
    valores.push(periodo_escolar);
    condiciones.push(`r.periodo_escolar = $${valores.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT r.*, p.nombre AS plantel_nombre, p.codigo_plantel
     FROM rac r
     JOIN planteles p ON p.id = r.plantel_id
     ${where}
     ORDER BY r.actualizado_en DESC
     LIMIT 200`,
    valores
  );
  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*) FROM rac r ${where}`,
    valores
  );
  res.json({ rac: rows, total: parseInt(totalRows[0].count, 10) });
});

/**
 * PATCH /api/rac/:id
 * Edición de un registro existente -- cubre el caso de TRASLADOS:
 * cambiar el plantel_id (y/o turno, cargo, horas) de una asignación
 * que ya existe. El trigger de auditoría deja registrado el antes/
 * después automáticamente (ver schema.sql).
 * Solo operador/admin.
 */
router.patch("/:id", requireAuth, requireRol("operador", "admin"), async (req, res) => {
  const { id } = req.params;
  const camposPermitidos = ["plantel_id", "cargo", "turno", "horas_academicas", "horas_adm", "situacion"];
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
  valores.push(id);

  try {
    const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
      const { rows } = await client.query(
        `UPDATE rac SET ${sets.join(", ")}, actualizado_en = now()
         WHERE id = $${valores.length} RETURNING *`,
        valores
      );
      return rows[0];
    });

    if (!resultado) {
      return res.status(404).json({ error: "Registro no encontrado." });
    }
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: "No se pudo actualizar el registro.", detalle: err.message });
  }
});

/**
 * DELETE /api/rac/:id
 * Solo admin. Queda registrado en auditoria (fila completa antes de borrar).
 */
router.delete("/:id", requireAuth, requireRol("admin"), async (req, res) => {
  const { id } = req.params;
  await conTransaccionAuditada(req.usuario.id, async (client) => {
    await client.query("DELETE FROM rac WHERE id = $1", [id]);
  });
  res.status(204).send();
});

/**
 * POST /api/rac
 * Alta manual de un registro (fuera del flujo de carga masiva de Excel).
 * Útil para correcciones puntuales de un operador.
 */
router.post("/", requireAuth, requireRol("operador", "admin"), async (req, res) => {
  const { cedula, plantel_id, cargo, turno, horas_academicas, horas_adm, periodo_escolar } = req.body;
  if (!cedula || !plantel_id || !periodo_escolar) {
    return res.status(400).json({ error: "Faltan campos obligatorios: cedula, plantel_id, periodo_escolar." });
  }

  try {
    const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO rac (cedula, plantel_id, cargo, turno, horas_academicas, horas_adm, periodo_escolar)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          cedula.trim().replace(/^0+/, ""),
          plantel_id,
          cargo || null,
          turno || null,
          horas_academicas || 0,
          horas_adm || 0,
          periodo_escolar,
        ]
      );
      return rows[0];
    });
    res.status(201).json(resultado);
  } catch (err) {
    res.status(500).json({ error: "No se pudo crear el registro.", detalle: err.message });
  }
});

module.exports = router;
