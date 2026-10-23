const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../src/routes/supervision.js'),'utf8');
const start=src.indexOf('router.post(\n  "/matricula/:codigoPlantel"');
const end=src.indexOf('// =========================================================\n// MATRÍCULA POR NIVEL',start);
assert.ok(start>=0&&end>start);
const snippet=src.slice(start,end);
function makeHarness(){
 const calls=[];const registered=[];
 const router={post(...args){registered.push(args)}};
 const pool={async query(sql,params){calls.push({sql,params});return {rows:[{codigo_plantel:'ABC',periodo_escolar:params[1],hembras:params[2],varones:params[3]}]}}};
 const ctx={router,pool,requireAuth(){},requireRol(){},requireMismoPlantel(){},ROLES_SUPERVISION_Y_DIRECTOR:['admin','supervision','director'],console};
 vm.runInNewContext(snippet,ctx);
 const handler=registered[0].at(-1);
 return {calls,async run(body){const res={statusCode:200,status(n){this.statusCode=n;return this},json(payload){this.payload=payload;return this}};await handler({params:{codigoPlantel:'ABC'},body,usuario:{id:1}},res);return res}};
}
test('total matricula valid integer is persisted with school and period',async()=>{
 const h=makeHarness();const res=await h.run({periodo_escolar:'2026-2027',hembras:12,varones:10});
 assert.equal(res.statusCode,200);
 assert.equal(h.calls.length,1);
 assert.deepEqual(Array.from(h.calls[0].params),['ABC','2026-2027',12,10,1]);
 assert.match(h.calls[0].sql,/ON CONFLICT \(codigo_plantel, periodo_escolar\)/);
});
test('total matricula rejects invalid values without database writes',async()=>{
 const base={periodo_escolar:'2026-2027',hembras:1,varones:2};
 for(const change of [{hembras:null},{hembras:''},{varones:undefined},{varones:' '},{hembras:-1},{hembras:1.5},{varones:'2.2'},{hembras:Number.MAX_SAFE_INTEGER+1},{periodo_escolar:''},{periodo_escolar:'x'.repeat(21)}]){
  const h=makeHarness();const res=await h.run({...base,...change});
  assert.equal(res.statusCode,400,JSON.stringify(change));
  assert.equal(h.calls.length,0,JSON.stringify(change));
 }
});
