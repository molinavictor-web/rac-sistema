const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../db/pool");

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Falta email o password." });
  }

  const { rows } = await pool.query(
    "SELECT id, nombre, email, password_hash, rol, municipio_id, codigo_plantel, activo FROM usuarios WHERE email = $1",
    [email]
  );
  const usuario = rows[0];
  if (!usuario || !usuario.activo) {
    return res.status(401).json({ error: "Credenciales inválidas." });
  }

  const ok = await bcrypt.compare(password, usuario.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Credenciales inválidas." });
  }

  const token = jwt.sign(
    {
      id: usuario.id,
      rol: usuario.rol,
      municipio_id: usuario.municipio_id,
      codigo_plantel: usuario.codigo_plantel,
      nombre: usuario.nombre,
    },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );

  res.json({
    token,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      municipio_id: usuario.municipio_id,
      codigo_plantel: usuario.codigo_plantel,
    },
  });
});

module.exports = router;
