const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(require('node:path').join(__dirname, '../public/js/supervision-login.js'),'utf8');

async function simulate(role, errorMessage) {
  const nodes = Object.fromEntries(['formLogin','btnEntrar','loginError','email','password'].map(id => [id, { value: '', textContent:'', disabled:false, classList:{visible:false, add(x){if(x==='visible')this.visible=true},remove(x){if(x==='visible')this.visible=false}},addEventListener(type,fn){this.submit=fn}}]));
  nodes.email.value=' test@example.com ';
  nodes.password.value='test-password';
  let saved=null,request=null;
  const window={location:{href:''}};
  const RAC={post:async(url,data)=>{request={url,data};if(errorMessage)throw Error(errorMessage);return {token:'dummy',usuario:{rol:role}}},guardarSesion:(token,user)=>{saved={token,user}}};
  vm.runInNewContext(script,{document:{getElementById:id=>nodes[id]},window,RAC});
  await nodes.formLogin.submit({preventDefault(){}});
  return {nodes,window,saved,request};
}
test('director logs in and opens own plantel',async()=>{
 const r=await simulate('director');
 assert.equal(r.window.location.href,'/supervision/mi-plantel.html');
 assert.equal(r.request.url,'/api/auth/login');
 assert.equal(r.request.data.email,'test@example.com');
 assert.equal(r.saved.user.rol,'director');
 assert.equal(r.nodes.btnEntrar.disabled,false);
});
test('supervision logs in to planteles',async()=>{
 const r=await simulate('supervision');
 assert.equal(r.window.location.href,'/supervision/planteles.html');
 assert.equal(r.saved.user.rol,'supervision');
});
test('admin is accepted in supervision login',async()=>{
 const r=await simulate('admin');
 assert.equal(r.window.location.href,'/supervision/planteles.html');
});
test('RAC-only role cannot enter or save a session',async()=>{
 const r=await simulate('operador');
 assert.equal(r.saved,null);
 assert.equal(r.window.location.href,'');
 assert.equal(r.nodes.loginError.classList.visible,true);
 assert.match(r.nodes.loginError.textContent,/no tiene acceso/);
 assert.equal(r.nodes.btnEntrar.disabled,false);
});
test('invalid credentials show error without saving a session',async()=>{
 const r=await simulate(null,'Credenciales incorrectas');
 assert.equal(r.saved,null);
 assert.equal(r.window.location.href,'');
 assert.equal(r.nodes.loginError.classList.visible,true);
 assert.equal(r.nodes.loginError.textContent,'Credenciales incorrectas');
 assert.equal(r.nodes.btnEntrar.disabled,false);
});
