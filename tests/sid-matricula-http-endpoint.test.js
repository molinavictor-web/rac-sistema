// Endpoint real del router de Supervisión, JWT y PostgreSQL 17 efímero.
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const jwt=require('jsonwebtoken');
const {pool}=require('../src/db/pool');
const router=require('../src/routes/supervision');
test('POST matrícula-nivel: endpoint real, permisos, consolidación, histórico y rollback',async()=>{
 assert.equal(process.env.DATABASE_URL,'postgresql://sid_test:sid_test_only@127.0.0.1:5432/sid_test');
 assert.equal(process.env.SID_TEST_DATABASE_URL,process.env.DATABASE_URL);
 process.env.JWT_SECRET='sid-endpoint-isolated';
 const app=express();app.use(express.json());app.use('/api/supervision',router);
 let server;
 const sql=[
  'CREATE TABLE usuarios(id integer PRIMARY KEY,activo boolean NOT NULL,rol text NOT NULL,codigo_plantel text)',
  'CREATE TABLE plantel_niveles(codigo_plantel text NOT NULL,nivel text NOT NULL,PRIMARY KEY(codigo_plantel,nivel))',
  'CREATE TABLE matricula_nivel(codigo_plantel varchar NOT NULL,periodo_escolar varchar NOT NULL,nivel text NOT NULL,hembras int NOT NULL,varones int NOT NULL,actualizado_por int,actualizado_en timestamptz DEFAULT now(),PRIMARY KEY(codigo_plantel,periodo_escolar,nivel))',
  'CREATE TABLE matricula_planteles(codigo_plantel varchar NOT NULL,periodo_escolar varchar NOT NULL,hembras int NOT NULL,varones int NOT NULL,actualizado_por int,actualizado_en timestamptz DEFAULT now(),PRIMARY KEY(codigo_plantel,periodo_escolar))'
 ];
 try{
  for(const s of sql)await pool.query(s);
  await pool.query("INSERT INTO usuarios VALUES (12,true,'director','ABC'),(13,false,'director','ABC'),(14,true,'supervision',NULL)");
  await pool.query("INSERT INTO plantel_niveles VALUES ('ABC','primaria'),('ABC','inicial'),('XYZ','primaria')");
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const token=(id,rol,school)=>jwt.sign({id,rol,codigo_plantel:school},process.env.JWT_SECRET);
  const send=async(school,body,t)=>{const response=await fetch(base+'/api/supervision/matricula-nivel/'+school,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+t},body:JSON.stringify(body)});return {status:response.status,body:await response.json()}};
  const director=token(12,'director','ABC');
  const body=(period,levels)=>({periodo_escolar:period,niveles:levels.map(([nivel,hembras,varones])=>({nivel,hembras,varones}))});
  let r=await send('ABC',body('2024-2025',[['primaria',8,7]]),director);assert.equal(r.status,200,JSON.stringify(r.body));
  r=await send('ABC',body('2025-2026',[['primaria',10,11],['inicial',3,4]]),director);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.matricula.hembras,13);assert.equal(r.body.matricula.varones,15);
  r=await send('ABC',body('2025-2026',[['primaria',12,13]]),director);assert.equal(r.status,200);assert.equal(r.body.matricula.hembras,15);assert.equal(r.body.matricula.varones,17);
  r=await send('XYZ',body('2025-2026',[['primaria',50,60]]),director);assert.equal(r.status,403);
  r=await send('ABC',body('2025-2026',[['primaria',50,60]]),token(13,'director','ABC'));assert.equal(r.status,401);
  r=await send('ABC',body('2025-2026',[['secundaria',50,60]]),director);assert.equal(r.status,400);
  r=await send('ABC',body('2025-2026',[['primaria',5,5],['primaria',6,6]]),director);assert.equal(r.status,400);
  r=await send('XYZ',body('2025-2026',[['primaria',50,60]]),token(14,'supervision',null));assert.equal(r.status,200);
  const rows=(await pool.query('SELECT codigo_plantel,periodo_escolar,hembras,varones FROM matricula_planteles ORDER BY codigo_plantel,periodo_escolar')).rows;
  assert.deepEqual(rows.map(x=>[x.codigo_plantel,x.periodo_escolar,x.hembras,x.varones]),[['ABC','2024-2025',8,7],['ABC','2025-2026',15,17],['XYZ','2025-2026',50,60]]);
  // Valores fuera de int4 se rechazan antes de abrir una transacción.
  r=await send('ABC',body('2025-2026',[['primaria',99,99],['inicial',2147483648,1]]),director);assert.equal(r.status,400);
  // Dos niveles válidos por separado pueden desbordar el agregado: rollback atómico.
  r=await send('ABC',body('2025-2026',[['primaria',2147483647,99],['inicial',1,1]]),director);assert.equal(r.status,500);
  const after=(await pool.query("SELECT hembras,varones FROM matricula_nivel WHERE codigo_plantel='ABC' AND periodo_escolar='2025-2026' AND nivel='primaria'")).rows[0];
  assert.equal(after.hembras,12);assert.equal(after.varones,13);
 }finally{
  if(server)await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  for(const table of ['matricula_planteles','matricula_nivel','plantel_niveles','usuarios'])await pool.query('DROP TABLE IF EXISTS '+table);
  await pool.end();
 }
});
