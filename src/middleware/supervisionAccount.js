const { pool } = require("../db/pool");

// La desactivación, cambio de rol o reasignación invalida tokens ya emitidos
// para el módulo de Supervisión, sin esperar las 12 horas del JWT.
async function requireCuentaSupervisionActiva(req, res, next) {
  const id = req.usuario && req.usuario.id;
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
    return res.status(401).json({ error: "Sesión inválida." });
  }
  try {
    const { rows } = await pool.query(
      "SELECT activo, rol, codigo_plantel FROM usuarios WHERE id = $1",
      [id]
    );
    const actual = rows[0];
    if (!actual || !actual.activo ||
        actual.rol !== req.usuario.rol ||
        (actual.rol === "director" &&
          String(actual.codigo_plantel || "") !== String(req.usuario.codigo_plantel || ""))) {
      return res.status(401).json({ error: "Sesión revocada. Inicia sesión nuevamente." });
    }
    next();
  } catch (err) {
    console.error("Error validando cuenta de Supervisión:", err);
    res.status(503).json({ error: "No se pudo verificar la sesión." });
  }
}

module.exports = { requireCuentaSupervisionActiva };
