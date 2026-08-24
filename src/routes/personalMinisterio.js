const express = require("express");
const multer = require("multer");
const { pool } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  // El archivo mensual del Ministerio suele pesar menos de 100MB ya
  // convertido a CSV. Ajusta MAX_UPLOAD_NOMINA_MB si hace falta más espacio.
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_NOMINA_MB) || 150) * 1024 * 1024 },
});

const BATCH_SIZE = 1000;

function parseLinea(linea) {
  return linea.split(";").map((v) => v.trim());
}

/**
 * POST /api/personal-ministerio/cargar
 * form-data: archivo (.csv, separado por ";", codificación latin1 --
 * el mismo formato que envía el Ministerio, tal cual usa scripts/importar_personal.js)
 * Solo admin. Es una FOTO MENSUAL COMPLETA: reemplaza toda la tabla
 * (igual que el script local), no un acumulado.
 *
 * Esta tabla es de solo consulta (el cruce se hace únicamente por
 * cédula), así que la auditoría normal se desactiva temporalmente
 * durante esta carga para no generar ~800k filas de auditoría en
 * cada corrida mensual -- se reactiva automáticamente al terminar.
 */
router.post("/cargar", requireAuth, requireRol("admin"), upload.single("archivo"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Falta el archivo." });
  }

  const contenido = req.file.buffer.toString("latin1");
  const lineas = contenido.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lineas.length < 2) {
    return res.status(400).json({ error: "El archivo no tiene filas de datos." });
  }

  const encabezados = parseLinea(lineas[0]).map((h) => h.toUpperCase());
  const idx = {
    cedula: encabezados.indexOf("CEDULA"),
    nombre: encabezados.indexOf("NOMBRE"),
    cargo: encabezados.indexOf("CARGO"),
    codNom: encabezados.indexOf("COD_NOM"),
    codDep: encabezados.indexOf("COD_DEP"),
    status: encabezados.indexOf("STATUS"),
  };
  for (const [campo, i] of Object.entries(idx)) {
    if (i === -1) {
      return res.status(400).json({ error: `Falta la columna esperada: ${campo}` });
    }
  }

  const filas = lineas.slice(1);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("ALTER TABLE personal_ministerio DISABLE TRIGGER trg_auditoria_personal_ministerio");
    await client.query("TRUNCATE TABLE personal_ministerio RESTART IDENTITY");

    let insertados = 0;
    for (let i = 0; i < filas.length; i += BATCH_SIZE) {
      const lote = filas.slice(i, i + BATCH_SIZE);
      const valores = [];
      const placeholders = [];

      lote.forEach((linea, j) => {
        const cols = parseLinea(linea);
        const base = j * 6;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
        );
        valores.push(
          cols[idx.cedula] || null,
          cols[idx.nombre] || null,
          cols[idx.cargo] || null,
          cols[idx.codNom] || null,
          cols[idx.codDep] || null,
          cols[idx.status] || "activo"
        );
      });

      await client.query(
        `INSERT INTO personal_ministerio (cedula, nombres, cargo, codigo_dependencia, codigo_plantel, estado)
         VALUES ${placeholders.join(", ")}`,
        valores
      );
      insertados += lote.length;
    }

    await client.query("ALTER TABLE personal_ministerio ENABLE TRIGGER trg_auditoria_personal_ministerio");
    await client.query("COMMIT");

    res.status(201).json({ mensaje: "Carga de nómina completada.", registros_cargados: insertados });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error cargando personal_ministerio:", err);
    res.status(500).json({ error: "Error al procesar el archivo. Revisa el formato (CSV con ';', columnas CEDULA/NOMBRE/CARGO/COD_NOM/COD_DEP/STATUS)." });
  } finally {
    client.release();
  }
});

module.exports = router;
