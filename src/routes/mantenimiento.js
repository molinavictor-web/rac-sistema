const express = require("express");
const router = express.Router();
const { pool } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");

/**
 * POST /api/mantenimiento/purgar-auditoria
 * Borra de forma DEFINITIVA los registros de la tabla `auditoria`
 * con más de N días de antigüedad (por defecto 3) y libera el
 * espacio en disco con VACUUM FULL.
 *
 * Solo borrar filas (DELETE) NO reduce el tamaño físico de la tabla
 * en Postgres/Supabase -- el espacio queda "reservado" hasta que se
 * corre VACUUM. Por eso este endpoint hace las dos cosas en el mismo
 * paso: DELETE + VACUUM FULL.
 *
 * Body opcional: { "dias": 3 }  -- por si algún día se quiere purgar
 * con otra ventana sin tener que tocar el código.
 *
 * Protegido: solo usuarios con rol admin.
 */
router.post(
  "/purgar-auditoria",
  requireAuth,
  requireRol("admin"),
  async (req, res) => {
    const dias = Number.isInteger(req.body?.dias) && req.body.dias > 0
      ? req.body.dias
      : 3;

    const client = await pool.connect();
    try {
      // 1) Contar cuánto se va a borrar, para informarlo en la respuesta
      const conteo = await client.query(
        `SELECT COUNT(*)::int AS total
         FROM auditoria
         WHERE fecha < NOW() - ($1 || ' days')::interval`,
        [dias]
      );
      const registrosABorrar = conteo.rows[0].total;

      // 2) Borrado directo (sin respaldo, según decisión del usuario)
      await client.query(
        `DELETE FROM auditoria
         WHERE fecha < NOW() - ($1 || ' days')::interval`,
        [dias]
      );

      // 3) VACUUM FULL no puede correr dentro de una transacción normal
      //    ni con el mismo client si hay una transacción abierta -- se
      //    ejecuta aparte, directo.
      await client.query("VACUUM FULL auditoria");

      // 4) Tamaño actual de la tabla ya liberado, para confirmarlo
      const tamano = await client.query(
        `SELECT pg_size_pretty(pg_total_relation_size('auditoria')) AS tamano`
      );

      res.json({
        ok: true,
        dias_retenidos: dias,
        registros_borrados: registrosABorrar,
        tamano_actual: tamano.rows[0].tamano,
      });
    } catch (err) {
      console.error("Error purgando auditoria:", err);
      res.status(500).json({ error: "No se pudo purgar la tabla auditoria." });
    } finally {
      client.release();
    }
  }
);

/**
 * GET /api/mantenimiento/estado-auditoria
 * Solo consulta: cuántos registros hay y cuánto pesa la tabla,
 * sin borrar nada. Útil para decidir cuándo correr la purga.
 */
router.get(
  "/estado-auditoria",
  requireAuth,
  requireRol("admin"),
  async (req, res) => {
    try {
      const total = await pool.query(`SELECT COUNT(*)::int AS total FROM auditoria`);
      const tamano = await pool.query(
        `SELECT pg_size_pretty(pg_total_relation_size('auditoria')) AS tamano`
      );
      const masAntiguo = await pool.query(
        `SELECT MIN(fecha) AS fecha_mas_antigua FROM auditoria`
      );
      res.json({
        total_registros: total.rows[0].total,
        tamano_actual: tamano.rows[0].tamano,
        fecha_mas_antigua: masAntiguo.rows[0].fecha_mas_antigua,
      });
    } catch (err) {
      console.error("Error consultando estado de auditoria:", err);
      res.status(500).json({ error: "No se pudo consultar el estado de auditoria." });
    }
  }
);

module.exports = router;
