const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/routes/supervision.js'),'utf8');
const start=source.indexOf('router.post(\n  "/matricula-nivel/:codigoPlantel"');
const end=source.indexOf('// Cambia los niveles de un plantel',start);
assert.ok(start>0&&end>start);
const snippet=source.slice(start,end);
function harness({assigned=['primaria'],failOn=null}={}){
 const calls=[];let released=false;
 const client={async query(sql,params=[]){
  const s=String(sql).trim();calls.push({sql:s,params});
  if(failOn&&s.includes(failOn))throw Error('simulated db failure');
  if(s.startsWith('SELECT nivel FROM plantel_niveles'))return {rows:assigned.map(nivel=>({nivel}))};
  if(s.includes('RETURNING *'))return {rows:[{codigo_plantel:'ABC',periodo_escolar:params[1],hembras:5,varones:6}]};
  return {rows:[]};
 },release(){released=true}};
 const routes=[];
 const router={post(...args){routes.push(args)}};
 const pool={connect:async()=>client};
 const ctx={router,pool,requireAuth(){},requireRol(){},requireMismoPlantel(){},ROLES_SUPERVISION_Y_DIRECTOR:['admin','supervision','director'],textoVacio:v=>v===undefined||v===null||String(v).trim()==='',console};
 vm.runInNewContext(snippet,ctx);
 const handler=routes[0].at(-1);
 async function run(body){
  const req={params:{codigoPlantel:'ABC'},body,usuario:{id:99}};
  const res={statusCode:200,status(n){this.statusCode=n;return this},json(payload){this.payload=payload;return this}};
  await handler(req,res);return res;
 }
 return {run,calls,released:()=>released};
}
const valid={periodo_escolar:'2026-2027',niveles:[{nivel:'primaria',hembras:5,varones:6}]};
test('successful matricula por nivel commits and updates aggregate',async()=>{
 const h=harness();const res=await h.run(valid);
 assert.equal(res.statusCode,200);
 assert.equal(h.calls[0].sql,'BEGIN');
 assert.ok(h.calls.some(c=>c.sql.includes('INSERT INTO matricula_nivel')));
 assert.ok(h.calls.some(c=>c.sql.includes('INSERT INTO matricula_planteles')));
 assert.equal(h.calls.at(-1).sql,'COMMIT');
 assert.equal(h.released(),true);
});
test('unassigned level rolls back with no inserts',async()=>{
 const h=harness();const res=await h.run({...valid,niveles:[{nivel:'media',hembras:1,varones:2}]});
 assert.equal(res.statusCode,400);
 assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));
 assert.ok(!h.calls.some(c=>c.sql.includes('INSERT INTO')));
 assert.equal(h.released(),true);
});
test('DB failure rolls back and releases client',async()=>{
 const h=harness({failOn:'INSERT INTO matricula_nivel'});const res=await h.run(valid);
 assert.equal(res.statusCode,500);
 assert.equal(h.calls.at(-1).sql,'ROLLBACK');
 assert.equal(h.released(),true);
});
test('invalid and repeated levels rejected before DB access',async()=>{
 for(const niveles of [[{nivel:'primaria',hembras:-1,varones:1}],[{nivel:'primaria',hembras:1.5,varones:1}],[{nivel:'primaria',hembras:1,varones:1},{nivel:'primaria',hembras:2,varones:2}]]) {
  const h=harness();const res=await h.run({...valid,niveles});
  assert.equal(res.statusCode,400);
  assert.equal(h.calls.length,0);
 }
});
test('missing levels and missing period rejected before DB access',async()=>{
 for(const body of [{periodo_escolar:'',niveles:valid.niveles},{periodo_escolar:'2026-2027',niveles:[]}]) {
  const h=harness();const res=await h.run(body);
  assert.equal(res.statusCode,400);assert.equal(h.calls.length,0);
 }
});
