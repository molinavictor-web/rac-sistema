const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = p => fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const auth = read('src/middleware/auth.js');
const routes = read('src/routes/supervision.js');
const miPlantel = read('public/js/supervision-mi-plantel.js');

function loadMiddleware() {
  const module={exports:{}};
  vm.runInNewContext(auth,{module,exports:module.exports,require(name){assert.equal(name,'jsonwebtoken');return {verify(token){if(token==='invalid')throw Error('invalid');return JSON.parse(token)}}},process:{env:{JWT_SECRET:'test-only'}}});
  return module.exports;
}
const m=loadMiddleware();
const req=(user,url='/api/supervision/planteles/ABC')=>({headers:{authorization:'Bearer '+JSON.stringify(user)},originalUrl:url,usuario:user,params:{codigoPlantel:'ABC'}});
const check=(middleware,r)=>{let status=null,passed=false;middleware(r,{status(code){status=code;return this},json(){return this}},()=>{passed=true});return {status,passed}};
test('missing and invalid JWT denied',()=>{
 assert.equal(check(m.requireAuth,{headers:{},originalUrl:'/api/supervision/planteles'}).status,401);
 assert.equal(check(m.requireAuth,{headers:{authorization:'Bearer invalid'},originalUrl:'/api/supervision/planteles'}).status,401);
});
test('supervision/director cannot access RAC API',()=>{
 for(const rol of ['supervision','director']) {
  assert.equal(check(m.requireAuth,req({rol},'/api/usuarios')).status,403);
  assert.equal(check(m.requireAuth,req({rol},'/api/supervision/planteles')).passed,true);
 }
});
test('role check denies operator and director for admin-only routes',()=>{
 for(const rol of ['operador','director'])assert.equal(check(m.requireRol('admin','supervision'),{usuario:{rol}}).status,403);
 for(const rol of ['admin','supervision'])assert.equal(check(m.requireRol('admin','supervision'),{usuario:{rol}}).passed,true);
});
test('director may use own plantel, never a different one',()=>{
 const guard=m.requireMismoPlantel(r=>r.params.codigoPlantel);
 assert.equal(check(guard,req({rol:'director',codigo_plantel:'ABC'})).passed,true);
 assert.equal(check(guard,req({rol:'director',codigo_plantel:'XYZ'})).status,403);
 for(const rol of ['admin','supervision'])assert.equal(check(guard,req({rol})).passed,true);
});
test('municipal scope rejects another municipality',()=>{
 const guard=m.requireMismoMunicipio(r=>r.params.municipio);
 assert.equal(check(guard,{usuario:{rol:'encargado_municipio',municipio_id:5},params:{municipio:6}}).status,403);
 assert.equal(check(guard,{usuario:{rol:'encargado_municipio',municipio_id:5},params:{municipio:5}}).passed,true);
});
test('both matricula write routes require auth, role and same plantel',()=>{
 for(const endpoint of ['matricula','matricula-nivel']) {
  const pattern=new RegExp('router\\.post\\(\\s*"/'+endpoint+'/:codigoPlantel",\\s*requireAuth,\\s*requireRol\\(\\.\\.\\.ROLES_SUPERVISION_Y_DIRECTOR\\),\\s*requireMismoPlantel');
  assert.match(routes,pattern);
 }
 assert.match(miPlantel,/formMatricula/);
 assert.match(miPlantel,/\/api\/supervision\/matricula/);
});
test('responsive stylesheet defines mobile breakpoints and overflow',()=>{
 const css=read('public/css/sid-supervision-tech.css');
 assert.match(css,/@media\s*\(\s*max-width:\s*768px\s*\)/);
 assert.match(css,/overflow-x:\s*auto/);
 assert.match(css,/body\.sid-tech-supervision/);
 for(const name of ['login','mi-plantel'])assert.match(read('public/supervision/'+name+'.html'),/name="viewport"/);
});

test('total matricula rejects fractional and unsafe numbers at backend',()=>{
 const route=routes.match(/router\.post\(\s*"\/matricula\/:codigoPlantel"[\s\S]*?\/\/ =========================================================\n\/\/ MATRÍCULA POR NIVEL/);
 assert.ok(route,'Total matricula route exists');
 assert.match(route[0],/Number\.isSafeInteger\(h\)/);
 assert.match(route[0],/Number\.isSafeInteger\(v\)/);
});
