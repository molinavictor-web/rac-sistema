// SIGE Fase 1: catálogo central de permisos. No modifica los roles existentes.
const MODULOS = Object.freeze(["rac", "supervision", "fede"]);
const PERMISOS = Object.freeze({
  "rac.ver": "rac",
  "rac.operar": "rac",
  "supervision.ver": "supervision",
  "supervision.operar": "supervision",
  "fede.ver": "fede",
  "fede.operar": "fede",
  "usuarios.administrar": "core",
});
const ROLES_LEGADOS = Object.freeze({
  admin: Object.keys(PERMISOS),
  operador: ["rac.ver", "rac.operar"],
  encargado_municipio: ["rac.ver", "rac.operar"],
  operador_credenciales: ["rac.ver"],
  operador_plantel: ["fede.ver", "fede.operar"],
  supervision: ["supervision.ver", "supervision.operar"],
  director: ["supervision.ver"],
});
function permisosDeRoles(roles = []) {
  const lista = Array.isArray(roles) ? roles : [];
  return [...new Set(lista.flatMap((rol) => ROLES_LEGADOS[rol] || []))];
}
function permisosDeUsuario(usuario = {}) {
  const roles = Array.isArray(usuario.roles) && usuario.roles.length
    ? usuario.roles
    : (usuario.rol ? [usuario.rol] : []);
  return permisosDeRoles(roles);
}
function tienePermiso(usuario, permiso) {
  return Object.prototype.hasOwnProperty.call(PERMISOS, permiso)
    && permisosDeUsuario(usuario).includes(permiso);
}
function requirePermiso(...permisos) {
  if (!permisos.length || permisos.some((p) => !Object.prototype.hasOwnProperty.call(PERMISOS, p))) {
    throw new Error("Permisos no válidos");
  }
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: "No autenticado." });
    if (!permisos.every((p) => tienePermiso(req.usuario, p))) {
      return res.status(403).json({ error: "No tienes permiso para esta acción." });
    }
    next();
  };
}
module.exports = { MODULOS, PERMISOS, ROLES_LEGADOS, permisosDeRoles, permisosDeUsuario, tienePermiso, requirePermiso };
