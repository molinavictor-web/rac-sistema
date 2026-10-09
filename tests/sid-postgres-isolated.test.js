// PostgreSQL real y efímero: ejecutado SOLO en GitHub Actions con service container.
const test=require('node:test');
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.SID_TEST_DATABASE_URL});
test('PostgreSQL aislado: histórico por plantel/período, actualización y rollback',async()=>{
 assert.ok(process.env.SID_TEST_DATABASE_URL?.includes('127.0.0.1'),'No usar bases remotas ni producción');
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query('CREATE TEMP TABLE matricula_planteles (codigo_plantel varchar(30) NOT NULL, periodo_escolar varchar(20) NOT NULL, hembras int NOT NULL, varones int NOT NULL, actualizado_por int, actualizado_en timestamptz DEFAULT now(), PRIMARY KEY(codigo_plantel,periodo_escolar)) ON COMMIT DROP');
  const upsert=`INSERT INTO matricula_planteles (codigo_plantel,periodo_escolar,hembras,varones,actualizado_por) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(codigo_plantel,periodo_escolar) DO UPDATE SET hembras=EXCLUDED.hembras,varones=EXCLUDED.varones,actualizado_por=EXCLUDED.actualizado_por,actualizado_en=now() RETURNING *`;
  for(const args of [['ABC','2024-2025',10,11,1],['ABC','2025-2026',20,21,1],['XYZ','2025-2026',30,31,1],['ABC','2025-2026',22,23,1]])await client.query(upsert,args);
  const rows=(await client.query('SELECT codigo_plantel,periodo_escolar,hembras,varones FROM matricula_planteles ORDER BY codigo_plantel,periodo_escolar')).rows;
  assert.equal(rows.length,3);
  assert.deepEqual(rows.map(r=>[r.codigo_plantel,r.periodo_escolar,r.hembras,r.varones]),[['ABC','2024-2025',10,11],['ABC','2025-2026',22,23],['XYZ','2025-2026',30,31]]);
  await client.query('SAVEPOINT before_error');
  await assert.rejects(client.query(upsert,['ABC','2025-2026',-1,2147483648,1]),/out of range/);
  await client.query('ROLLBACK TO SAVEPOINT before_error');
  assert.equal((await client.query('SELECT varones FROM matricula_planteles WHERE codigo_plantel=$1 AND periodo_escolar=$2',['ABC','2025-2026'])).rows[0].varones,23);
  await client.query('ROLLBACK');
 }finally{client.release();await pool.end()}
});
