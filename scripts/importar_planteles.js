/**
 * Importa un CSV de planteles (formato: estado;municipio;parroquia;
 * cod_plantel;nombre_plantel;tipo_dependencia;denominacion;direccion)
 * a las tablas municipios + planteles.
 *
 * Uso: node scripts/importar_planteles.js ruta/al/archivo.csv
 */
require("dotenv").config();
const fs = require("fs");
const { Pool } = require("pg");

async function main() {
  const archivo = process.argv[2];
  if (!archivo) {
    console.error("Uso: node scripts/importar_planteles.js ruta/al/archivo.csv");
    process.exit(1);
  }

  const contenido = fs.readFileSync(archivo, "latin1");
  const lineas = contenido.split(/\r?\n/).filter((l) => l.trim());
  const header = lineas[0].split(";").map((h) => h.trim());
  const filas = lineas.slice(1).map((linea) => {
    const valores = linea.split(";");
    return Object.fromEntries(header.map((h, i) => [h, (valores[i] || "").trim()]));
  });

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  });

  console.log(`Importando ${filas.length} planteles...`);

  let municipiosCreados = 0;
  let plantelesCreados = 0;

  for (const fila of filas) {
    // upsert de municipio
    const { rows: mRows } = await pool.query(
      `INSERT INTO municipios (codigo, nombre)
       VALUES ($1, $2)
       ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING id, (xmax = 0) AS insertado`,
      [fila.municipio, fila.municipio] // el CSV no trae código separado; se usa el nombre como código provisional
    );
    if (mRows[0].insertado) municipiosCreados++;
    const municipioId = mRows[0].id;

    const { rowCount } = await pool.query(
      `INSERT INTO planteles (codigo_plantel, nombre, municipio_id, dependencia, estado)
       VALUES ($1, $2, $3, $4, 'activo')
       ON CONFLICT (codigo_plantel) DO UPDATE
       SET nombre = EXCLUDED.nombre, municipio_id = EXCLUDED.municipio_id, dependencia = EXCLUDED.dependencia, actualizado_en = now()`,
      [fila.cod_plantel, fila.nombre_plantel, municipioId, fila.tipo_dependencia]
    );
    plantelesCreados += rowCount;
  }

  console.log(`Listo. Municipios nuevos: ${municipiosCreados}. Planteles insertados/actualizados: ${plantelesCreados}.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Error importando planteles:", err);
  process.exit(1);
});
