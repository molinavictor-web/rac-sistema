const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const middlewareSource=fs.readFileSync(path.join(__dirname,'../src/middleware/supervisionAccount.js'),'utf8');
const routerSource=fs.readFileSync(path.join(__dirname,'../src/routes/supervision.js'),'utf8');
function harness(row,dbError=false){
 const queries=[];
 const pool={async query(sql,params){queries.push({sql,params});if(dbError)throw Error('simulated database outage');return {rows:row?[row]:[]}}};
 const mod={exports:{}};
 vm.runInNewContext(middlewareSource,{module:mod,require(name){assert.equal(name,'../db/pool');return {pool}},console:{error(){}}});
 const fn=mod.exports.requireCuentaSupervisionActiva;
 async function check(usuario){
  let next=false;
  const res={code:200,status(code){this.code=code;return this},json(data){this.data=data;return this}};
  await fn({usuario},res,()=>{next=true});
  return {next,code:res.code};
 }
 return {check,queries};
}
const director={id:12,rol:'director',codigo_plantel:'ABC'};
test('supervision router validates current account on every route, isolated from RAC',()=>{
 assert.match(routerSource,/router\.use\(requireAuth, requireCuentaSupervisionActiva\)/);
 assert.match(routerSource,/require\("\.\.\/middleware\/supervisionAccount"\)/);
});
test('active director with unchanged plantel may proceed',async()=>{
 const h=harness({activo:true,rol:'director',codigo_plantel:'ABC'});
 const result=await h.check(director);
 assert.equal(result.next,true);assert.equal(result.code,200);assert.equal(h.queries.length,1);
});
test('disabled director is denied even with previously issued token',async()=>{
 const h=harness({activo:false,rol:'director',codigo_plantel:'ABC'});
 const result=await h.check(director);
 assert.equal(result.next,false);assert.equal(result.code,401);
});
test('role or school reassignment revokes existing token',async()=>{
 for(const row of [{activo:true,rol:'supervision',codigo_plantel:'ABC'},{activo:true,rol:'director',codigo_plantel:'XYZ'}]){
  const result=await harness(row).check(director);
  assert.equal(result.next,false);assert.equal(result.code,401);
 }
});
test('deleted account is denied',async()=>{
 const result=await harness(null).check(director);
 assert.equal(result.next,false);assert.equal(result.code,401);
});
test('database failure fails closed with 503',async()=>{
 const result=await harness(null,true).check(director);
 assert.equal(result.next,false);assert.equal(result.code,503);
});
test('missing or invalid identity rejected before database access',async()=>{
 for(const user of [null,{id:0},{id:'bad'}]){
  const h=harness(null);const result=await h.check(user);
  assert.equal(result.next,false);assert.equal(result.code,401);assert.equal(h.queries.length,0);
 }
});
