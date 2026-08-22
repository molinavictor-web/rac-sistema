const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render Postgres requiere SSL en producción
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 10,
});

/**
 * Ejecuta un bloque de trabajo dentro de una transacción, dejando fijado
 * `app.usuario_id` para que los triggers de auditoría (ver rac-schema.sql)
 * puedan capturar automáticamente quién hizo cada cambio.
 *
 * Uso:
 *   await conTransaccionAuditada(usuarioId, async (client) => {
 *     await client.query('UPDATE rac SET ... WHERE id = $1', [id]);
 *   });
 */
async function conTransaccionAuditada(usuarioId, trabajo) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // set_config con is_local=true equivale a "SET LOCAL" -- solo dura
    // el resto de esta transacción.
    await client.query("SELECT set_config('app.usuario_id', $1, true)", [
      usuarioId ? String(usuarioId) : "",
    ]);
    const resultado = await trabajo(client);
    await client.query("COMMIT");
    return resultado;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, conTransaccionAuditada };
