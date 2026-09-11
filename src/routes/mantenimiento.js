const express = require("express");
const router = express.Router();
const { pool } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");

/**
 * GET /api/mantenimiento/exportar-auditoria
 * Descarga un CSV con TODO el contenido actual de la tabla `auditoria`,
 * sin borrar nada. Pensado para usarse justo antes de una purga completa,
 * como respaldo manual (el usuario decide dónde guardar el archivo).
 *
 * Mismo formato que el resto del proyecto: separado por ";", codificado
 * en latin1 (igual que las cargas/exportaciones del RAC), para que Excel
 * en configuración regional en español lo abra bien.
 *
 * Protegido: solo usuarios con rol admin.
 */
router.get(
  "/exportar-auditoria",
  requireAuth,
  requireRol("admin"),
  async (req, res) => {
    try {
      const resultado = await pool.query(`SELECT * FROM auditoria ORDER BY fecha ASC`);
      const filas = resultado.rows;

      const escapar = (valor) => {
        if (valor === null || valor === undefined) return "";
        const texto = valor instanceof Date ? valor.toISOString() : String(valor);
        // Si el valor trae el delimitador, comillas o saltos de línea,
        // se envuelve entre comillas dobles (formato CSV estándar).
        if (/[;"\n\r]/.test(texto)) {
          return `"${texto.replace(/"/g, '""')}"`;
        }
        return texto;
      };

      let csv;
      if (filas.length === 0) {
        csv = "";
      } else {
        const columnas = Object.keys(filas[0]);
        const encabezado = columnas.join(";");
        const lineas = filas.map((fila) => columnas.map((c) => escapar(fila[c])).join(";"));
        csv = [encabezado, ...lineas].join("\r\n");
      }

      const fechaArchivo = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "text/csv; charset=latin1");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="auditoria_backup_${fechaArchivo}.csv"`
      );
      res.send(Buffer.from(csv, "latin1"));
    } catch (err) {
      console.error("Error exportando auditoria:", err);
      res.status(500).json({ error: "No se pudo exportar la tabla auditoria." });
    }
  }
);

/**
 * POST /api/mantenimiento/purgar-auditoria
 * Borra de forma DEFINITIVA los registros de la tabla `auditoria`.
 *
 * Body opcional: { "dias": 3 }  -- purga solo lo más antiguo que N días
 *                                  (comportamiento original, por defecto 3).
 * Body opcional: { "dias": 0 }  -- MEJORA (2026-09-10): purga la tabla
 *                                  COMPLETA, sin importar la antigüedad.
 *                                  En este caso se usa TRUNCATE en vez de
 *                                  DELETE + VACUUM FULL, porque TRUNCATE
 *                                  libera el espacio en disco de inmediato
 *                                  (más rápido y sin necesitar el VACUUM
 *                                  aparte).
 *
 * Solo borrar filas (DELETE) NO reduce el tamaño físico de la tabla
 * en Postgres/Supabase -- el espacio queda "reservado" hasta que se
 * corre VACUUM. Por eso la purga parcial hace las dos cosas en el mismo
 * paso: DELETE + VACUUM FULL.
 *
 * Protegido: solo usuarios con rol admin.
 */
router.post(
  "/purgar-auditoria",
  requireAuth,
  requireRol("admin"),
  async (req, res) => {
    const diasRecibidos = req.body?.dias;
    // MEJORA (2026-09-10): dias=0 es la señal explícita de "purgar todo,
    // sin filtro de antigüedad" -- se distingue de "no mandaron nada"
    // (que sigue usando el valor por defecto de 3 días, comportamiento
    // original sin cambios).
    const purgarTodo = diasRecibidos === 0;
    const dias = Number.isInteger(diasRecibidos) && diasRecibidos > 0 ? diasRecibidos : 3;

    const client = await pool.connect();
    try {
      let registrosABorrar;

      if (purgarTodo) {
        const conteo = await client.query(`SELECT COUNT(*)::int AS total FROM auditoria`);
        registrosABorrar = conteo.rows[0].total;
        await client.query(`TRUNCATE TABLE auditoria RESTART IDENTITY`);
      } else {
        const conteo = await client.query(
          `SELECT COUNT(*)::int AS total
           FROM auditoria
           WHERE fecha < NOW() - ($1 || ' days')::interval`,
          [dias]
        );
        registrosABorrar = conteo.rows[0].total;
        await client.query(
          `DELETE FROM auditoria
           WHERE fecha < NOW() - ($1 || ' days')::interval`,
          [dias]
        );
        // VACUUM FULL no puede correr dentro de una transacción normal
        // ni con el mismo client si hay una transacción abierta -- se
        // ejecuta aparte, directo.
        await client.query("VACUUM FULL auditoria");
      }

      const tamano = await client.query(
        `SELECT pg_size_pretty(pg_total_relation_size('auditoria')) AS tamano`
      );
      res.json({
        ok: true,
        purgado_completo: purgarTodo,
        dias_retenidos: purgarTodo ? 0 : dias,
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
