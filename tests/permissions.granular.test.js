const assert = require("node:assert/strict");
const test = require("node:test");
const { PERMISOS, ROLES_LEGADOS, permisosDeUsuario, tienePermiso, requirePermiso } = require("../src/core/permissions");

function ejecutar(middleware, usuario) {
  let status = 200;
  let nextCalled = false;
  middleware(
    { usuario },
    { status(n) { status = n; return this; }, json() { return this; } },
    () => { nextCalled = true; }
  );
  return { status, nextCalled };
}

test("catálogo incluye permisos granulares por módulo", () => {
  for (const codigo of [
    "rac.crear", "rac.editar", "rac.eliminar", "rac.credenciales.aprobar",
    "supervision.supervisores.administrar", "supervision.matricula.registrar",
    "fede.coordenadas.editar", "fede.archivos.subir", "fede.oauth.administrar"
  ]) assert.ok(Object.hasOwn(PERMISOS, codigo), codigo);
});

test("ningún rol legado obtiene permisos granulares por accidente", () => {
  const granulares = Object.keys(PERMISOS).filter((p) => ![
    "rac.ver", "rac.operar", "supervision.ver", "supervision.operar",
    "fede.ver", "fede.operar", "usuarios.administrar"
  ].includes(p));
  for (const rol of Object.keys(ROLES_LEGADOS)) {
    for (const permiso of granulares) {
      assert.equal(tienePermiso({ rol }, permiso), false, rol + " obtuvo " + permiso);
    }
  }
});

test("director no obtiene acceso a RAC ni FEDE", () => {
  for (const permiso of ["rac.ver", "rac.operar", "fede.ver", "fede.operar"]) {
    assert.equal(tienePermiso({ rol: "director" }, permiso), false);
  }
});

test("operador FEDE no recibe permisos RAC ni Supervisión", () => {
  for (const permiso of ["rac.ver", "rac.operar", "supervision.ver", "supervision.operar"]) {
    assert.equal(tienePermiso({ rol: "operador_plantel" }, permiso), false);
  }
});

test("usuario sin sesión devuelve 401", () => {
  assert.deepEqual(ejecutar(requirePermiso("rac.ver"), undefined), { status: 401, nextCalled: false });
});

test("usuario sin permiso devuelve 403", () => {
  assert.deepEqual(ejecutar(requirePermiso("fede.ver"), { rol: "director" }), { status: 403, nextCalled: false });
});

test("usuario con permiso legado válido continúa", () => {
  assert.deepEqual(ejecutar(requirePermiso("fede.ver"), { rol: "operador_plantel" }), { status: 200, nextCalled: true });
});

test("múltiples permisos requieren todos, no cualquiera", () => {
  assert.deepEqual(ejecutar(requirePermiso("rac.ver", "fede.ver"), { rol: "operador" }), { status: 403, nextCalled: false });
});

test("rol desconocido y permiso desconocido se rechazan", () => {
  assert.deepEqual(permisosDeUsuario({ rol: "rol_inexistente" }), []);
  assert.equal(tienePermiso({ rol: "admin" }, "inventado"), false);
  assert.throws(() => requirePermiso("inventado"));
  assert.throws(() => requirePermiso());
});

test("varios roles conservan unión sin duplicados", () => {
  const permisos = permisosDeUsuario({ rol: "operador", roles: ["operador", "operador_plantel"] });
  assert.ok(permisos.includes("rac.ver"));
  assert.ok(permisos.includes("fede.ver"));
  assert.equal(permisos.length, new Set(permisos).size);
});

// NOTA: alcance por municipio/plantel y estado activo dependen de middleware
// y consultas externas; no se consideran cubiertos por estas pruebas unitarias.
