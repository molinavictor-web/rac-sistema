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
  // Catálogo granular preparatorio: NO se asigna a roles hasta validar matriz y rutas.
  "rac.consultar": "rac",
  "rac.crear": "rac",
  "rac.editar": "rac",
  "rac.eliminar": "rac",
  "rac.exportar": "rac",
  "rac.cargar": "rac",
  "rac.credenciales.generar": "rac",
  "rac.credenciales.aprobar": "rac",
  "rac.credenciales.eliminar": "rac",
  "supervision.consultar": "supervision",
  "supervision.planteles.editar": "supervision",
  "supervision.supervisores.administrar": "supervision",
  "supervision.circuitos.administrar": "supervision",
  "supervision.directores.administrar": "supervision",
  "supervision.matricula.consultar": "supervision",
  "supervision.matricula.registrar": "supervision",
  "fede.consultar": "fede",
  "fede.coordenadas.editar": "fede",
  "fede.archivos.consultar": "fede",
  "fede.archivos.subir": "fede",
  "fede.fachada.subir": "fede",
  "fede.directorio.editar": "fede",
  "fede.cache.refrescar": "fede",
  "fede.oauth.administrar": "fede",
});
const ROLES_LEGADOS = Object.freeze({
  admin: ["rac.ver", "rac.operar", "supervision.ver", "supervision.operar", "fede.ver", "fede.operar", "usuarios.administrar"],
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
