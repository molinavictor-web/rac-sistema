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

/**
 * GET /api/mantenimiento/estado-datos
 * Solo consulta: cuántos registros tiene cada tabla operativa
 * (rac, planteles, personal_ministerio, alertas), sin borrar nada.
 * Útil para mostrar antes del reinicio cuánto se va a perder.
 */
router.get(
  "/estado-datos",
  requireAuth,
  requireRol("admin"),
  async (req, res) => {
    try {
      const [rac, planteles, nomina, alertas] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total FROM rac`),
        pool.query(`SELECT COUNT(*)::int AS total FROM planteles`),
        pool.query(`SELECT COUNT(*)::int AS total FROM personal_ministerio`),
        pool.query(`SELECT COUNT(*)::int AS total FROM alertas`),
      ]);
      res.json({
        rac: rac.rows[0].total,
        planteles: planteles.rows[0].total,
        personal_ministerio: nomina.rows[0].total,
        alertas: alertas.rows[0].total,
      });
    } catch (err) {
      console.error("Error consultando estado de datos:", err);
      res.status(500).json({ error: "No se pudo consultar el estado de las tablas." });
    }
  }
);

/**
 * POST /api/mantenimiento/reiniciar-datos
 * Vacía por completo las tablas alertas, rac, planteles y
 * personal_ministerio (TRUNCATE + reinicio de contadores de ID),
 * para dejar el sistema listo y recibir datos nuevos desde cero.
 *
 * Accion IRREVERSIBLE y sin respaldo -- por eso exige que el cliente
 * mande exactamente la palabra "REINICIAR" en el body, ademas de la
 * doble confirmacion que ya hace el frontend. No basta con estar
 * autenticado como admin: hace falta esta confirmacion explicita.
 *
 * Body requerido: { "confirmacion": "REINICIAR" }
 *
 * Se truncan las 4 tablas en un solo TRUNCATE (mismo statement) para
 * que Postgres resuelva correctamente las llaves foraneas entre ellas
 * (rac -> planteles, alertas -> rac/planteles) sin importar el orden.
 * CASCADE cubre cualquier otra tabla que tenga FK hacia estas cuatro.
 *
 * Protegido: solo usuarios con rol admin.
 */
router.post(
  "/reiniciar-datos",
  requireAuth,
  requireRol("admin"),
  async (req, res) => {
    if (req.body?.confirmacion !== "REINICIAR") {
      return res.status(400).json({
        error: 'Falta la confirmacion. Envia { "confirmacion": "REINICIAR" } para ejecutar esta accion.',
      });
    }
    const client = await pool.connect();
    try {
      await client.query(
        `TRUNCATE TABLE alertas, rac, planteles, personal_ministerio RESTART IDENTITY CASCADE`
      );
      res.json({
        ok: true,
        mensaje: "Las tablas alertas, rac, planteles y personal_ministerio fueron vaciadas. El sistema esta listo para cargar datos nuevos.",
      });
    } catch (err) {
      console.error("Error reiniciando datos:", err);
      res.status(500).json({ error: "No se pudo reiniciar las tablas." });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
