// Smoke real Chromium de RAC con API y usuarios ficticios. No hay red productiva.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../public');
const mime={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(data)});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});
 const base='http://127.0.0.1:'+server.address().port;
 try{
  for(const role of ['admin','operador','encargado_municipio','operador_credenciales','operador_plantel']){
   for(const file of ['dashboard.html','rac.html']){
    const page=await browser.newPage({viewport:{width:375,height:812}});
    const errors=[];page.on('pageerror',err=>errors.push(err.message));
    await page.addInitScript(role=>{
     sessionStorage.setItem('rac_token','isolated-mock');
     sessionStorage.setItem('rac_usuario',JSON.stringify({id:1,nombre:'Prueba RAC',rol:role,municipio_id:1,codigo_plantel:'ABC'}));
    },role);
    await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({rac:[],planteles:[],alertas:[],total:0})}));
    await page.goto(base+'/'+file,{waitUntil:'networkidle'});
    assert.equal(await page.locator('.sidebar').count(),1,role+'/'+file+' sidebar');
    assert.equal(await page.locator('.topbar').count(),1,role+'/'+file+' topbar');
    assert.equal(await page.locator('.sidebar .usuario-chip').count(),1,role+'/'+file+' user');
    assert.equal(await page.locator('.sidebar nav a[href="/dashboard.html"]').count(),1,role+'/'+file+' dashboard link');
    assert.equal(await page.locator('.sidebar nav a[href="/rac.html"]').count(),1,role+'/'+file+' RAC link');
    assert.equal(await page.locator('.sidebar nav a[href="/usuarios.html"]').count(),role==='admin'?1:0,'usuarios visibility '+role);
    assert.equal(await page.locator('.sidebar nav a[href="/credenciales.html"]').count(),['admin','operador_credenciales'].includes(role)?1:0,'credenciales visibility '+role);
    assert.equal(await page.locator('.sidebar nav a[href="/directorio-directores.html"]').count(),['admin','operador','operador_plantel'].includes(role)?1:0,'directorio visibility '+role);
    assert.deepEqual(errors,[],'Browser JS errors '+role+'/'+file);
    if(file==='rac.html'){
     await page.locator('#cedulaBusqueda').fill('12345678');
     await page.locator('#formBuscar button[type="submit"]').click();
     await page.locator('#tablaRac .vacio').waitFor();
     assert.match(await page.locator('#tablaRac').innerText(),/Sin resultados/);
    }else{
     await page.locator('.dashboard-hero').waitFor();
    }
    console.log('PASS RAC '+role+'/'+file+' 375px');
    await page.close();
   }
  }
  // A role confined to Supervisión must be redirected away from RAC pages.
  for(const role of ['director','supervision']){
   const page=await browser.newPage();
   await page.addInitScript(role=>{sessionStorage.setItem('rac_token','isolated-mock');sessionStorage.setItem('rac_usuario',JSON.stringify({id:2,nombre:'Prueba',rol:role,codigo_plantel:'ABC'}))},role);
   await page.goto(base+'/dashboard.html',{waitUntil:'domcontentloaded'});
   await page.waitForURL('**/supervision/**');
   assert.ok(page.url().includes(role==='director'?'mi-plantel.html':'resumen.html'));
   console.log('PASS RAC redirect '+role);
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
})().catch(e=>{console.error(e);process.exitCode=1;server.close()});
