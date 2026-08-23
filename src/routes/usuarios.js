const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");

const router = express.Router();

// Crear un usuario nuevo (solo admin)
router.post("/", requireAuth, requireRol("admin"), async (req, res) => {
  const { nombre, email, password, rol, municipio_id } = req.body;

  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ error: "Faltan campos obligatorios: nombre, email, password, rol." });
  }

  const rolesValidos = ["encargado_municipio", "operador", "admin"];
  if (!rolesValidos.includes(rol)) {
    return res.status(400).json({ error: `Rol inválido. Debe ser uno de: ${rolesValidos.join(", ")}` });
  }

  if (rol === "encargado_municipio" && !municipio_id) {
    return res.status(400).json({ error: "municipio_id es obligatorio para el rol encargado_municipio." });
  }

  try {
    const passwordHash = bcrypt.hashSync(password, 10);

    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, municipio_id, activo)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, nombre, email, rol, municipio_id, activo, creado_en`,
      [nombre, email, passwordHash, rol, municipio_id || null]
    );

    res.status(201).json({ usuario: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe un usuario con ese email." });
    }
    console.error("Error creando usuario:", err);
    res.status(500).json({ error: "Error interno al crear el usuario." });
  }
});

// Listar usuarios (solo admin)
router.get("/", requireAuth, requireRol("admin"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nombre, email, rol, municipio_id, activo, creado_en
       FROM usuarios ORDER BY creado_en DESC`
    );
    res.json({ usuarios: rows });
  } catch (err) {
    console.error("Error listando usuarios:", err);
    res.status(500).json({ error: "Error interno al listar usuarios." });
  }
});

// Desactivar (o reactivar) un usuario, en vez de borrarlo (mejor para auditoría)
router.patch("/:id/activo", requireAuth, requireRol("admin"), async (req, res) => {
  const { id } = req.params;
  const { activo } = req.body;

  if (typeof activo !== "boolean") {
    return res.status(400).json({ error: "El campo 'activo' debe ser true o false." });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE usuarios SET activo = $1 WHERE id = $2
       RETURNING id, nombre, email, rol, activo`,
      [activo, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }
    res.json({ usuario: rows[0] });
  } catch (err) {
    console.error("Error actualizando usuario:", err);
    res.status(500).json({ error: "Error interno al actualizar el usuario." });
  }
});

module.exports = router;