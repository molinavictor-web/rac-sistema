const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const { pool, conTransaccionAuditada } = require("../db/pool");
const { validarRegistro, normalizarCedula } = require("../services/validacion");
const { requireAuth, requireMismoMunicipio } = require("../middleware/auth");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_SIZE_MB) || 20) * 1024 * 1024 },
});

// Mapeo de encabezados esperados del Excel del RAC hacia nuestros
// nombres de campo internos. Los municipios envían archivos "embasurados"
// -- este mapeo es tolerante a mayúsculas/espacios extra.
const MAPEO_COLUMNAS = {
  cedula: ["CEDULA", "CÉDULA"],
  nombre: ["NOMBRE Y APELLIDO", "NOMBRE"],
  codigo_plantel: ["CODIGO DEL PLANTEL", "COD_PLANTEL", "COD DEA"],
  horas_academicas: ["HORAS ACADEMICAS", "HORAS ACADÉMICAS"],
  horas_adm: ["HORAS ADM", "HORAS ADMINISTRATIVAS"],
  cargo: ["CARGO"],
  turno: ["TURNO QUE ATIENDE", "TURNO"],
};

function normalizarFila(filaCruda) {
  const limpio = {};
  for (const [campo, posiblesNombres] of Object.entries(MAPEO_COLUMNAS)) {
    const clave = Object.keys(filaCruda).find((k) =>
      posiblesNombres.includes(k.trim().toUpperCase())
    );
    limpio[campo] = clave ? String(filaCruda[clave]).trim() : "";
  }
  return limpio;
}

/**
 * POST /api/cargas
 * form-data: archivo (xlsx/csv), periodo_escolar
 * Solo el encargado de su propio municipio (o admin/operador).
 */
router.post(
  "/",
  requireAuth,
  requireMismoMunicipio((req) => req.body.municipio_id),
  upload.single("archivo"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Falta el archivo." });
    }
    const { municipio_id, periodo_escolar } = req.body;
    if (!municipio_id || !periodo_escolar) {
      return res.status(400).json({ error: "Falta municipio_id o periodo_escolar." });
    }

    let filas;
    try {
      const libro = XLSX.read(req.file.buffer, { type: "buffer" });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      filas = XLSX.utils.sheet_to_json(hoja, { defval: "" });
    } catch (err) {
      return res.status(400).json({ error: "No se pudo leer el archivo. ¿Es un Excel/CSV válido?" });
    }

    if (filas.length === 0) {
      return res.status(400).json({ error: "El archivo no tiene filas de datos." });
    }

    const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
      const { rows: cargaRows } = await client.query(
        `INSERT INTO cargas_municipio (municipio_id, usuario_id, nombre_archivo, cantidad_filas, estado)
         VALUES ($1, $2, $3, $4, 'procesando') RETURNING id`,
        [municipio_id, req.usuario.id, req.file.originalname, filas.length]
      );
      const cargaId = cargaRows[0].id;

      let totalAlertas = 0;

      for (let i = 0; i < filas.length; i++) {
        const fila = normalizarFila(filas[i]);
        const cedula = normalizarCedula(fila.cedula);
        if (!cedula) continue; // fila vacía o basura, se ignora

        const alertas = await validarRegistro(client, fila);
        const resultadoValidacion = alertas.length > 0 ? "alerta" : "ok";

        const { rows: detalleRows } = await client.query(
          `INSERT INTO carga_detalle
             (carga_id, fila_original, cedula, plantel_reportado, horas_reportadas, resultado_validacion)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            cargaId,
            i + 2, // +2: fila 1 es encabezado, index base 0
            cedula,
            fila.codigo_plantel || null,
            fila.horas_academicas || null,
            resultadoValidacion,
          ]
        );
        const detalleId = detalleRows[0].id;

        for (const alerta of alertas) {
          await client.query(
            `INSERT INTO alertas (carga_detalle_id, cedula, tipo, detalle)
             VALUES ($1, $2, $3, $4)`,
            [detalleId, cedula, alerta.tipo, alerta.detalle]
          );
          totalAlertas++;
        }

        // si no hubo alertas de existencia, se puede insertar/actualizar
        // el registro real en `rac` -- lo dejamos aquí como upsert simple.
        if (!alertas.some((a) => a.tipo === "no_existe_ministerio")) {
          const { rows: plantelRows } = await client.query(
            "SELECT id FROM planteles WHERE codigo_plantel = $1",
            [fila.codigo_plantel]
          );
          if (plantelRows.length > 0) {
            await client.query(
              `INSERT INTO rac (cedula, plantel_id, cargo, turno, horas_academicas, horas_adm, periodo_escolar)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                cedula,
                plantelRows[0].id,
                fila.cargo || null,
                fila.turno || null,
                Number(fila.horas_academicas) || 0,
                Number(fila.horas_adm) || 0,
                periodo_escolar,
              ]
            );
          }
        }
      }

      await client.query(
        `UPDATE cargas_municipio SET estado = 'completado' WHERE id = $1`,
        [cargaId]
      );

      return { cargaId, totalFilas: filas.length, totalAlertas };
    });

    res.status(201).json({
      mensaje: "Carga procesada.",
      carga_id: resultado.cargaId,
      filas_procesadas: resultado.totalFilas,
      alertas_generadas: resultado.totalAlertas,
    });
  }
);

/**
 * GET /api/cargas/:id/alertas
 * Lista las alertas generadas por una carga específica.
 */
router.get("/:id/alertas", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.cedula, a.tipo, a.detalle, a.estado, cd.fila_original
     FROM alertas a
     JOIN carga_detalle cd ON cd.id = a.carga_detalle_id
     WHERE cd.carga_id = $1
     ORDER BY cd.fila_original`,
    [req.params.id]
  );
  res.json(rows);
});

module.exports = router;
