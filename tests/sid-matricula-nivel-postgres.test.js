// PostgreSQL 17 real: reproduce las sentencias de matrícula-nivel y verifica atomicidad.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');
const url=process.env.SID_TEST_DATABASE_URL;
test('matrícula por nivel: suma, histórico, planteles y rollback en PostgreSQL real',async()=>{
 assert.equal(url,'postgresql://sid_test:sid_test_only@127.0.0.1:5432/sid_test');
 const source=fs.readFileSync(path.join(__dirname,'../src/routes/supervision.js'),'utf8');
 const segment=source.slice(source.indexOf('router.post(\n  "/matricula-nivel/:codigoPlantel"'),source.indexOf('// Cambia los niveles de un plantel'));
 assert.ok(segment.includes('await cliente.query("BEGIN")'));
 assert.ok(segment.includes('await cliente.query("COMMIT")'));
 assert.ok(segment.includes('await cliente.query("ROLLBACK")'));
 const sqlLevel=segment.match(/\x60(INSERT INTO matricula_nivel[\s\S]*?RETURNING \*)\x60/);
 // SQL de niveles no tiene RETURNING; extraer por delimitadores literales del código.
 const level=segment.match(/\x60(INSERT INTO matricula_nivel[\s\S]*?actualizado_en = now\(\))\x60/);
 const total=segment.match(/\x60(INSERT INTO matricula_planteles[\s\S]*?RETURNING \*)\x60/);
 assert.ok(level,'Debe encontrarse SQL real de matrícula por nivel');
 assert.ok(total,'Debe encontrarse SQL real de consolidación');
 const pool=new Pool({connectionString:url});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('CREATE TEMP TABLE matricula_nivel(codigo_plantel varchar NOT NULL,periodo_escolar varchar NOT NULL,nivel text NOT NULL,hembras int NOT NULL,varones int NOT NULL,actualizado_por int,actualizado_en timestamptz DEFAULT now(),PRIMARY KEY(codigo_plantel,periodo_escolar,nivel)) ON COMMIT DROP');
  await client.query('CREATE TEMP TABLE matricula_planteles(codigo_plantel varchar NOT NULL,periodo_escolar varchar NOT NULL,hembras int NOT NULL,varones int NOT NULL,actualizado_por int,actualizado_en timestamptz DEFAULT now(),PRIMARY KEY(codigo_plantel,periodo_escolar)) ON COMMIT DROP');
  const save=async(school,period,items)=>{for(const [n,h,v] of items)await client.query(level[1],[school,period,n,h,v,12]);return (await client.query(total[1],[school,period,12])).rows[0]};
  let row=await save('ABC','2024-2025',[['primaria',8,7]]);
  assert.equal(row.hembras,8);assert.equal(row.varones,7);
  row=await save('ABC','2025-2026',[['primaria',10,11],['inicial',3,4]]);
  assert.equal(row.hembras,13);assert.equal(row.varones,15);
  row=await save('XYZ','2025-2026',[['primaria',100,101]]);
  assert.equal(row.hembras,100);
  row=await save('ABC','2025-2026',[['primaria',12,13]]);
  assert.equal(row.hembras,15);assert.equal(row.varones,17);
  assert.equal((await client.query("SELECT hembras FROM matricula_planteles WHERE codigo_plantel='ABC' AND periodo_escolar='2024-2025'")).rows[0].hembras,8);
  assert.equal((await client.query("SELECT hembras FROM matricula_planteles WHERE codigo_plantel='XYZ' AND periodo_escolar='2025-2026'")).rows[0].hembras,100);
  await client.query('SAVEPOINT before_failure');
  await assert.rejects(client.query(level[1],['ABC','2025-2026','inicial',2147483648,0,12]),/out of range/);
  await client.query('ROLLBACK TO SAVEPOINT before_failure');
  assert.equal((await client.query("SELECT hembras FROM matricula_planteles WHERE codigo_plantel='ABC' AND periodo_escolar='2025-2026'")).rows[0].hembras,15);
  await client.query('ROLLBACK');
 }finally{client.release();await pool.end()}
});
