const jwt = require("jsonwebtoken");

/**
 * Verifica el token JWT y adjunta el usuario decodificado a req.usuario.
 * El token debe incluir { id, rol, municipio_id }.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Falta token de autenticación." });
  }
  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado." });
  }
}

/**
 * Uso: requireRol('admin', 'operador')
 * Debe usarse después de requireAuth.
 */
function requireRol(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario || !rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: "No tienes permiso para esta acción." });
    }
    next();
  };
}

/**
 * Para el rol encargado_municipio: garantiza que solo pueda actuar
 * sobre su propio municipio (compara con el body/params según la ruta).
 */
function requireMismoMunicipio(getMunicipioId) {
  return (req, res, next) => {
    if (req.usuario.rol === "admin" || req.usuario.rol === "operador") {
      return next(); // oficina central puede ver/tocar todos los municipios
    }
    const municipioSolicitado = getMunicipioId(req);
    if (String(req.usuario.municipio_id) !== String(municipioSolicitado)) {
      return res.status(403).json({ error: "No puedes operar sobre otro municipio." });
    }
    next();
  };
}

module.exports = { requireAuth, requireRol, requireMismoMunicipio };
