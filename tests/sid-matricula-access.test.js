const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const middleware=fs.readFileSync(path.join(__dirname,'../src/middleware/auth.js'),'utf8');
const routeSource=fs.readFileSync(path.join(__dirname,'../src/routes/supervision.js'),'utf8');
function setup(){
 const mod={exports:{}};
 vm.runInNewContext(middleware,{require(name){if(name==='jsonwebtoken')return {verify(token){if(token==='invalid')throw Error('bad');return JSON.parse(token)}};throw Error(name)},module:mod,process:{env:{JWT_SECRET:'test-only'}}});
 return mod.exports;
}
function invoke(fn,usuario,params={},url='/api/supervision/matricula/ABC'){
 let called=false;
 const req={headers:{authorization:'Bearer '+JSON.stringify(usuario)},originalUrl:url,params,usuario};
 const res={code:200,status(n){this.code=n;return this},json(data){this.data=data;return this}};
 fn(req,res,()=>{called=true});
 return {called,code:res.code};
}
const director={id:10,rol:'director',codigo_plantel:'ABC',municipio_id:1};
test('director can operate own school but not another',()=>{
 const m=setup().requireMismoPlantel(r=>r.params.codigoPlantel);
 assert.equal(invoke(m,director,{codigoPlantel:'ABC'}).called,true);
 const forbidden=invoke(m,director,{codigoPlantel:'XYZ'});
 assert.equal(forbidden.code,403);assert.equal(forbidden.called,false);
});
test('supervision may operate another school; municipality operator cannot impersonate director',()=>{
 const m=setup().requireMismoPlantel(r=>r.params.codigoPlantel);
 assert.equal(invoke(m,{...director,rol:'supervision'},{codigoPlantel:'XYZ'}).called,true);
 assert.equal(invoke(m,{...director,rol:'encargado_municipio'},{codigoPlantel:'XYZ'}).code,403);
});
test('director and supervision cannot use protected RAC endpoints',()=>{
 const m=setup().requireAuth;
 assert.equal(invoke(m,director,{},'/api/usuarios').code,403);
 assert.equal(invoke(m,{...director,rol:'supervision'},{},'/api/planteles').code,403);
 assert.equal(invoke(m,director,{},'/api/supervision/matricula/ABC').called,true);
});
test('matricula routes keep auth, role and plantel guards before handlers',()=>{
 for(const route of ['/matricula/:codigoPlantel','/matricula-nivel/:codigoPlantel']){
  const start=routeSource.indexOf('router.post(\n  "'+route+'"');
  assert.ok(start>=0,'Missing route '+route);
  const header=routeSource.slice(start,start+280);
  assert.match(header,/requireAuth/);
  assert.match(header,/requireRol\(\.\.\.ROLES_SUPERVISION_Y_DIRECTOR\)/);
  assert.match(header,/requireMismoPlantel/);
 }
});
