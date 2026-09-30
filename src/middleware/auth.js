const jwt = require("jsonwebtoken");

// Roles del módulo Supervisión: SOLO pueden usar /api/supervision (su panel)
// y /api/auth (sesión). Cualquier otra ruta protegida del sistema RAC les
// responde 403, aunque esa ruta solo use requireAuth sin requireRol.
const ROLES_SOLO_SUPERVISION = ["supervision", "director"];
const RUTAS_PERMITIDAS_SUPERVISION = /^\/api\/(supervision|auth)(\/|\?|$)/;

/**
 * Verifica el token JWT y adjunta el usuario decodificado a req.usuario.
 * El token debe incluir { id, rol, municipio_id, codigo_plantel }.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Falta token de autenticación." });
  }
  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Token inválido o expirado." });
  }

  if (ROLES_SOLO_SUPERVISION.includes(req.usuario.rol) && !RUTAS_PERMITIDAS_SUPERVISION.test(req.originalUrl)) {
    return res.status(403).json({ error: "Tu usuario solo tiene acceso al panel de Supervisión." });
  }

  next();
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

/**
 * Para el rol 'director' del módulo Supervisión: garantiza que solo
 * pueda actuar sobre su propio plantel (compara con el params/body
 * según la ruta). 'admin' y 'supervision' pueden operar sobre
 * cualquier plantel (ven y editan el catálogo completo).
 */
function requireMismoPlantel(getCodigoPlantel) {
  return (req, res, next) => {
    if (req.usuario.rol === "admin" || req.usuario.rol === "supervision") {
      return next();
    }
    const plantelSolicitado = getCodigoPlantel(req);
    if (String(req.usuario.codigo_plantel) !== String(plantelSolicitado)) {
      return res.status(403).json({ error: "No puedes operar sobre otro plantel." });
    }
    next();
  };
}

module.exports = { requireAuth, requireRol, requireMismoMunicipio, requireMismoPlantel };
