const assert = require("node:assert/strict");
const test = require("node:test");
const { permisosDeUsuario, tienePermiso, requirePermiso } = require("../src/core/permissions");
test("roles legados mantienen permisos esperados", () => {
  assert.equal(tienePermiso({ rol: "operador_plantel" }, "fede.ver"), true);
  assert.equal(tienePermiso({ rol: "operador_plantel" }, "rac.ver"), false);
  assert.equal(tienePermiso({ rol: "director" }, "supervision.ver"), true);
  assert.equal(tienePermiso({ rol: "director" }, "rac.ver"), false);
  assert.equal(tienePermiso({ rol: "admin" }, "usuarios.administrar"), true);
});
test("múltiples roles combinan permisos sin duplicados", () => {
  const p = permisosDeUsuario({ rol: "operador", roles: ["operador", "operador_plantel"] });
  assert.equal(p.includes("rac.ver") && p.includes("fede.ver"), true);
  assert.equal(p.length, new Set(p).size);
});
test("permiso desconocido se rechaza", () => {
  assert.equal(tienePermiso({ rol: "admin" }, "desconocido"), false);
  assert.throws(() => requirePermiso("desconocido"));
});
test("middleware rechaza acceso no autorizado", () => {
  const middleware = requirePermiso("fede.ver");
  let status;
  middleware({ usuario: { rol: "director" } }, { status(n) { status = n; return this; }, json() {} }, () => assert.fail("No debe autorizar"));
  assert.equal(status, 403);
});
