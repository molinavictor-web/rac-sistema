// Integración HTTP real Express + JWT + PostgreSQL efímero, sin tocar producción.
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const jwt=require('jsonwebtoken');
const {Pool}=require('pg');
const {requireAuth,requireRol,requireMismoPlantel}=require('../src/middleware/auth');
const {requireCuentaSupervisionActiva}=require('../src/middleware/supervisionAccount');
const dbUrl=process.env.SID_TEST_DATABASE_URL;
test('HTTP: permisos territoriales, cuentas revocadas y fallos cerrados sobre PostgreSQL real',async()=>{
 assert.match(dbUrl||'',/^postgresql:\/\/sid_test:sid_test_only@127\.0\.0\.1:5432\/sid_test$/);
 process.env.JWT_SECRET='sid-isolated-jwt-test-secret';
 process.env.DATABASE_URL=dbUrl;
 // La importación del middleware crea el pool antes de este test: DATABASE_URL debe venir del workflow.
 const pool=new Pool({connectionString:dbUrl});
 const client=await pool.connect();
 const app=express();app.use(express.json());
 let server;
 try {
  await client.query('CREATE TABLE IF NOT EXISTS usuarios (id integer PRIMARY KEY, activo boolean NOT NULL, rol text NOT NULL, codigo_plantel text)');
  await client.query('TRUNCATE usuarios');
  await client.query("INSERT INTO usuarios(id,activo,rol,codigo_plantel) VALUES (12,true,'director','ABC'),(13,false,'director','ABC'),(14,true,'supervision',null)");
  app.get('/api/supervision/matricula/:codigoPlantel',requireAuth,requireCuentaSupervisionActiva,requireRol('admin','supervision','director'),requireMismoPlantel(r=>r.params.codigoPlantel),(_req,res)=>res.json({ok:true}));
  app.get('/api/rac/private',requireAuth,(_req,res)=>res.json({ok:true}));
  server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const token=(id,rol,school)=>jwt.sign({id,rol,codigo_plantel:school},process.env.JWT_SECRET);
  async function get(path,t){const r=await fetch(base+path,{headers:{authorization:'Bearer '+t}});return r.status}
  assert.equal(await get('/api/supervision/matricula/ABC',token(12,'director','ABC')),200);
  assert.equal(await get('/api/supervision/matricula/XYZ',token(12,'director','ABC')),403);
  assert.equal(await get('/api/supervision/matricula/ABC',token(13,'director','ABC')),401);
  assert.equal(await get('/api/rac/private',token(12,'director','ABC')),403);
  assert.equal(await get('/api/supervision/matricula/ABC',token(14,'supervision',null)),200);
  await client.query("UPDATE usuarios SET activo=false WHERE id=12");
  assert.equal(await get('/api/supervision/matricula/ABC',token(12,'director','ABC')),401);
  await client.query("UPDATE usuarios SET activo=true,codigo_plantel='XYZ' WHERE id=12");
  assert.equal(await get('/api/supervision/matricula/ABC',token(12,'director','ABC')),401);
 }finally{
  if(server)await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  await client.query('DROP TABLE IF EXISTS usuarios');
  client.release();await pool.end();
  await require('../src/db/pool').pool.end();
 }
});
