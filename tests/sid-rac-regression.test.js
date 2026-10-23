const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const nav=read('public/js/nav.js');
const auth=read('src/middleware/auth.js');
const routes=read('src/routes/supervision.js');
function middleware(){
 const module={exports:{}};
 vm.runInNewContext(auth,{module,require(name){assert.equal(name,'jsonwebtoken');return {verify(token){return JSON.parse(token)}}},process:{env:{JWT_SECRET:'isolated'}}});
 return module.exports;
}
function invoke(fn,req){
 const res={code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}};
 let passed=false;
 fn(req,res,()=>{passed=true});
 return {passed,code:res.code};
}
function request(role,url='/api/rac'){return {headers:{authorization:'Bearer '+JSON.stringify({id:1,rol:role,municipio_id:4,codigo_plantel:'ABC'})},originalUrl:url}}
const m=middleware();
test('RAC roles retain access to protected RAC endpoints',()=>{
 for(const rol of ['admin','operador','encargado_municipio','operador_credenciales','operador_plantel']){
  assert.equal(invoke(m.requireAuth,request(rol)).passed,true,rol);
 }
});
test('supervision and director remain blocked from RAC endpoints',()=>{
 for(const rol of ['supervision','director']){
  assert.equal(invoke(m.requireAuth,request(rol)).code,403,rol);
  assert.equal(invoke(m.requireAuth,request(rol,'/api/supervision/resumen')).passed,true,rol);
 }
});
test('municipal scope retains territorial enforcement',()=>{
 const guard=m.requireMismoMunicipio(r=>r.params.municipio);
 for(const rol of ['encargado_municipio']){
  assert.equal(invoke(guard,{usuario:{rol,municipio_id:4},params:{municipio:5}}).code,403);
  assert.equal(invoke(guard,{usuario:{rol,municipio_id:4},params:{municipio:4}}).passed,true);
 }
});
test('RAC shared navigation retains every established role and key module',()=>{
 for(const role of ['admin','operador','encargado_municipio','operador_credenciales','operador_plantel']){
  assert.ok(nav.includes('"'+role+'"'),role);
 }
 for(const page of ['/dashboard.html','/rac.html','/exportar-rac.html','/cargas.html','/planteles-consulta.html','/directorio-directores.html','/credenciales.html','/usuarios.html']){
  assert.ok(nav.includes(page),page);
 }
 assert.match(nav,/window\.location\.pathname\.startsWith\("\/supervision\/"\)/);
 assert.match(nav,/document\.body\.classList\.contains\("sid-tech-supervision"\)/);
});
test('new active-account middleware is scoped to supervision router only',()=>{
 assert.match(routes,/router\.use\(requireAuth, requireCuentaSupervisionActiva\)/);
 assert.doesNotMatch(auth,/requireCuentaSupervisionActiva/);
});
