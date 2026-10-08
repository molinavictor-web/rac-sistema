const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/routes/auth.js'),'utf8');
function setup(user){
 const routes=[];const queries=[];const signCalls=[];
 const router={post(route,handler){routes.push({route,handler})}};
 const pool={async query(sql,params){queries.push({sql,params});return {rows:user?[user]:[]}}};
 const bcrypt={async compare(password,hash){return password==='correct-password'&&hash==='hash'}};
 const jwt={sign(payload,secret,options){signCalls.push({payload,secret,options});return 'test-token'}};
 const context={require(name){if(name==='express')return {Router:()=>router};if(name==='bcryptjs')return bcrypt;if(name==='jsonwebtoken')return jwt;if(name==='../db/pool')return {pool};throw Error(name)},module:{exports:{}},process:{env:{JWT_SECRET:'isolated-test-secret'}}};
 vm.runInNewContext(source,context);
 async function login(body){const res={code:200,status(code){this.code=code;return this},json(data){this.data=data;return this}};await routes[0].handler({body},res);return res}
 return {login,queries,signCalls};
}
const active={id:10,nombre:'Director ficticio',email:'demo@example.invalid',password_hash:'hash',rol:'director',municipio_id:1,codigo_plantel:'ABC',activo:true};
test('inactive account denied even with correct password',async()=>{
 const h=setup({...active,activo:false});const r=await h.login({email:active.email,password:'correct-password'});
 assert.equal(r.code,401);assert.equal(h.signCalls.length,0);
});
test('nonexistent account denied without token',async()=>{
 const h=setup(null);const r=await h.login({email:active.email,password:'correct-password'});
 assert.equal(r.code,401);assert.equal(h.signCalls.length,0);
});
test('wrong password denied without token',async()=>{
 const h=setup(active);const r=await h.login({email:active.email,password:'wrong'});
 assert.equal(r.code,401);assert.equal(h.signCalls.length,0);
});
test('active account authenticates with scoped identity and expiration',async()=>{
 const h=setup(active);const r=await h.login({email:active.email,password:'correct-password'});
 assert.equal(r.code,200);assert.equal(r.data.token,'test-token');
 assert.equal(h.signCalls.length,1);
 assert.equal(h.signCalls[0].payload.codigo_plantel,'ABC');
 assert.equal(h.signCalls[0].options.expiresIn,'12h');
 assert.equal(h.queries.length,1);
 assert.match(h.queries[0].sql,/activo FROM usuarios/);
});
test('missing credentials rejected before database access',async()=>{
 const h=setup(active);const r=await h.login({email:'',password:''});
 assert.equal(r.code,400);assert.equal(h.queries.length,0);
});
