/**
 * Aplica src/db/schema.sql a la base de datos apuntada por DATABASE_URL.
 * Uso: npm run migrate
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
  const schemaPath = path.join(__dirname, "..", "src", "db", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });

  console.log("Aplicando esquema...");
  try {
    await pool.query(sql);
    console.log("Listo. Tablas creadas/actualizadas.");
  } catch (err) {
    console.error("Error aplicando el esquema:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
