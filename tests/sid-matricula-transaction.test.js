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
 const calls=[];let released=false;const levels=new Map();
 const client={async query(sql,params=[]){
  const s=String(sql).trim();calls.push({sql:s,params});
  if(failOn&&s.includes(failOn))throw Error('simulated db failure');
  if(s==='ROLLBACK')levels.clear();
  if(s.startsWith('INSERT INTO matricula_nivel'))levels.set(params[2],{hembras:params[3],varones:params[4]});
  if(s.startsWith('SELECT COALESCE(SUM(hembras)'))return {rows:[{hembras:[...levels.values()].reduce((a,x)=>a+x.hembras,0),varones:[...levels.values()].reduce((a,x)=>a+x.varones,0)}]};
  if(s.startsWith('SELECT nivel FROM plantel_niveles'))return {rows:assigned.map(nivel=>({nivel}))};
  if(s.includes('RETURNING *'))return {rows:[{codigo_plantel:'ABC',periodo_escolar:params[1],hembras:5,varones:6}]};
  return {rows:[]};
 },release(){released=true}};
 const routes=[];
 const router={post(...args){routes.push(args)}};
 const pool={connect:async()=>client};
 const ctx={router,pool,requireAuth(){},requireRol(){},requireMismoPlantel(){},ROLES_SUPERVISION_Y_DIRECTOR:['admin','supervision','director'],textoVacio:v=>v===undefined||v===null||String(v).trim()==='',MAX_MATRICULA_ENTERO:2147483647,console};
 vm.runInNewContext(snippet,ctx);
 const handler=routes[0].at(-1);
 async function run(body){
  const req={params:{codigoPlantel:'ABC'},body,usuario:{id:99}};
  const res={statusCode:200,status(n){this.statusCode=n;return this},json(payload){this.payload=payload;return this}};
  await handler(req,res);return res;
 }
 return {run,calls,released:()=>released,levels};
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

test('aggregate overflow is rejected with 400 and transaction rolls back',async()=>{
 const h=harness({assigned:['primaria','inicial']});
 const res=await h.run({periodo_escolar:'2026-2027',niveles:[{nivel:'primaria',hembras:2147483647,varones:10},{nivel:'inicial',hembras:1,varones:1}]});
 assert.equal(res.statusCode,400);
 assert.ok(h.calls.some(c=>c.sql.includes('SELECT COALESCE(SUM(hembras)')));
 assert.ok(h.calls.some(c=>c.sql==='ROLLBACK'));
 assert.ok(!h.calls.some(c=>c.sql.includes('INSERT INTO matricula_planteles')));
 assert.ok(!h.calls.some(c=>c.sql==='COMMIT'));
 assert.equal(h.levels.size,0);
 assert.equal(h.released(),true);
});
