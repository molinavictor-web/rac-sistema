const express = require("express");
const { pool } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");
const router = express.Router();

/**
 * Tabla mapeo_codigos_plantel (creada en Supabase el 2026-09-10):
 *   codigo_incorrecto TEXT UNIQUE, codigo_correcto TEXT, nota TEXT,
 *   creado_en TIMESTAMP
 *
 * La usa `racCompleto.js` para resolver de forma transparente (sin generar
 * alerta) las filas cuyo código de plantel es un typo conocido. Hasta ahora
 * los mapeos se cargaban a mano por SQL directo en Supabase; estas rutas le
 * dan una interfaz al sistema, usada principalmente desde la pantalla
 * "Códigos sin catalogar" (botón "Marcar como typo").
 */

/**
 * GET /api/mapeo-codigos-plantel
 * Lista completa de mapeos, para mostrar los ya existentes y evitar
 * duplicarlos desde la pantalla "Códigos sin catalogar".
 */
router.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM mapeo_codigos_plantel ORDER BY creado_en DESC`
  );
  res.json({ mapeos: rows, total: rows.length });
});

/**
 * POST /api/mapeo-codigos-plantel
 * Alta de un mapeo nuevo (código incorrecto -> código correcto).
 * Solo operador/admin, igual que la resolución de alertas.
 */
router.post("/", requireAuth, requireRol("operador", "admin"), async (req, res) => {
  const codigo_incorrecto = (req.body.codigo_incorrecto || "").trim();
  const codigo_correcto = (req.body.codigo_correcto || "").trim();
  const nota = (req.body.nota || "").trim() || null;

  if (!codigo_incorrecto || !codigo_correcto) {
    return res.status(400).json({ error: "Faltan codigo_incorrecto o codigo_correcto." });
  }
  if (codigo_incorrecto === codigo_correcto) {
    return res.status(400).json({ error: "El código incorrecto y el correcto no pueden ser iguales." });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO mapeo_codigos_plantel (codigo_incorrecto, codigo_correcto, nota)
       VALUES ($1, $2, $3) RETURNING *`,
      [codigo_incorrecto, codigo_correcto, nota]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      // Violación de UNIQUE en codigo_incorrecto.
      return res
        .status(409)
        .json({ error: `Ya existe un mapeo cargado para el código "${codigo_incorrecto}".` });
    }
    throw err;
  }
});

module.exports = router;
