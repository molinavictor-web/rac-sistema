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
 * Edición completa de un registro existente -- cubre traslados (cambio de
 * plantel), correcciones de cargo/turno/horas/situación, y ajustes a los
 * códigos que trae la carga completa del RAC (codigo_dependencia,
 * codigo_cargo, tipo_personal). La cédula NO es editable aquí a propósito
 * (identifica al trabajador, no al registro de asignación).
 *
 * Para cambiar de plantel, el body debe traer `codigo_plantel` (el código
 * real del plantel, ej. "OD14231608"), NO el id interno -- se busca en la
 * tabla planteles y, si no existe, se rechaza el guardado con 400 (no se
 * guarda con alerta, para no dejar el registro apuntando a nada).
 *
 * El trigger de auditoría deja registrado el antes/después automáticamente
 * (ver schema.sql). Solo operador/admin.
 */
router.patch("/:id", requireAuth, requireRol("operador", "admin"), async (req, res) => {
  const { id } = req.params;
  const camposDirectos = [
    "cargo",
    "turno",
    "horas_academicas",
    "horas_adm",
    "situacion",
    "codigo_dependencia",
    "codigo_cargo",
    "tipo_personal",
  ];
  const sets = [];
  const valores = [];

  // Si viene codigo_plantel, se resuelve primero contra el catálogo maestro
  if (req.body.codigo_plantel !== undefined) {
    const codigoPlantel = String(req.body.codigo_plantel).trim();
    const plantelRes = await pool.query(
      "SELECT id FROM planteles WHERE codigo_plantel = $1",
      [codigoPlantel]
    );
    if (plantelRes.rows.length === 0) {
      return res.status(400).json({
        error: `El código de plantel "${codigoPlantel}" no existe en el catálogo maestro. Verifica el código antes de guardar.`,
      });
    }
    valores.push(plantelRes.rows[0].id);
    sets.push(`plantel_id = $${valores.length}`);
  }

  for (const campo of camposDirectos) {
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
      const actualizado = rows[0];
      if (!actualizado) return actualizado;

      // Incongruencia de tipo de personal: la única razón válida para que una
      // cédula tenga más de un registro en el RAC es que sea docente
      // (distintos horarios/planteles). Se revisa tras cada edición porque
      // un cambio manual de tipo_personal o de cédula-plantel puede crearla.
      const repetidosRes = await client.query(
        `SELECT tipo_personal, COUNT(*) OVER () AS total
         FROM rac WHERE cedula = $1`,
        [actualizado.cedula]
      );
      if (repetidosRes.rows.length > 1) {
        const tiposDistintos = [...new Set(repetidosRes.rows.map((r) => r.tipo_personal))];
        const soloDocente = tiposDistintos.length === 1 && tiposDistintos[0] === "D";
        if (!soloDocente) {
          await client.query(
            `INSERT INTO alertas (tipo, cedula, detalle, estado, creado_en)
             VALUES ($1, $2, $3, 'pendiente', now())`,
            [
              "incongruencia_tipo_personal",
              actualizado.cedula,
              `La cédula tiene ${repetidosRes.rows.length} registros en el RAC con tipo(s) de personal [${tiposDistintos.join(", ")}]. Solo un docente puede tener varios registros (distintos horarios/planteles) — revisar.`,
            ]
          );
        }
      }

      return actualizado;
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
