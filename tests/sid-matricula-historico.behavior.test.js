const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../src/routes/supervision.js'),'utf8');
const start=src.indexOf('router.post(\n  "/matricula/:codigoPlantel"');
const end=src.indexOf('// =========================================================\n// MATRÍCULA POR NIVEL',start);
assert.ok(start>=0&&end>start);
const data=new Map(),sqlLog=[];
const router={post(...args){router.handler=args.at(-1)}};
const pool={async query(sql,params){
 sqlLog.push(sql);
 assert.match(sql,/ON CONFLICT \(codigo_plantel, periodo_escolar\)/);
 const [school,period,h,v]=params;
 const key=school+'|'+period;
 data.set(key,{codigo_plantel:school,periodo_escolar:period,hembras:h,varones:v});
 return {rows:[data.get(key)]};
}};
vm.runInNewContext(src.slice(start,end),{router,pool,requireAuth(){},requireRol(){},requireMismoPlantel(){},ROLES_SUPERVISION_Y_DIRECTOR:['admin','supervision','director'],console});
async function save(school,period,h,v){
 const res={code:200,status(code){this.code=code;return this},json(payload){this.payload=payload;return this}};
 await router.handler({params:{codigoPlantel:school},body:{periodo_escolar:period,hembras:h,varones:v},usuario:{id:1}},res);
 assert.equal(res.code,200);
}
test('school-period upsert preserves historical records and isolates schools (simulated DB)',async()=>{
 await save('ABC','2024-2025',10,11);
 await save('ABC','2025-2026',20,21);
 await save('XYZ','2025-2026',30,31);
 await save('ABC','2025-2026',22,23);
 assert.deepEqual([data.get('ABC|2024-2025').hembras,data.get('ABC|2024-2025').varones],[10,11]);
 assert.deepEqual([data.get('ABC|2025-2026').hembras,data.get('ABC|2025-2026').varones],[22,23]);
 assert.deepEqual([data.get('XYZ|2025-2026').hembras,data.get('XYZ|2025-2026').varones],[30,31]);
 assert.equal(data.size,3);
 assert.equal(sqlLog.length,4);
});
