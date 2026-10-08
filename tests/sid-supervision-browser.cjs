const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'../public');
const mime={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(data);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true});
 try {
  for(const width of [375,768,1366]){
   const page=await browser.newPage({viewport:{width,height:812},deviceScaleFactor:1});
   const errors=[];
   page.on('pageerror',err=>errors.push(err.message));
   await page.goto(origin+'/supervision/login.html',{waitUntil:'networkidle'});
   assert.equal(await page.locator('#formLogin').count(),1);
   assert.equal(await page.locator('#email').isVisible(),true);
   assert.equal(await page.locator('#password').isVisible(),true);
   assert.equal(await page.locator('#btnEntrar').isVisible(),true);
   const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:window.innerWidth}));
   assert.ok(dimensions.scroll<=dimensions.viewport+2,'Horizontal overflow at '+width+': '+JSON.stringify(dimensions));
   assert.deepEqual(errors,[],'Browser errors at '+width);
   await page.screenshot({path:'/tmp/sid-login-'+width+'.png',fullPage:true});
   console.log('PASS login viewport '+width+'px, no overflow or JS errors');
   await page.close();
  }

  // Smoke de navegación aislado: usuario ficticio, respuestas API simuladas.
  // No usa credenciales reales ni toca la base de datos.
  for(const [role,pages] of [
   ['supervision',['resumen','estadisticas','alertas','planteles','consolidado','municipales','circuitales','circuitos','directores']],
   ['director',['mi-plantel']]
  ]) {
   for(const name of pages) {
    const page=await browser.newPage({viewport:{width:375,height:812}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({role})=>{
     sessionStorage.setItem('rac_token','mock-not-a-real-token');
     sessionStorage.setItem('rac_usuario',JSON.stringify({id:1,nombre:'Prueba aislada',rol:role,codigo_plantel:'ABC',municipio_id:1}));
    },{role});
    await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({planteles:[],consolidado:[],supervisores:[],directores:[],circuitos:[],alertas:[],municipios:[],catalogo:[],asignados:[],filas:[],matricula_historico:[],plantel:{codigo_plantel:'ABC',eponimo_actual:'Plantel ficticio'},total:0})}));
    await page.goto(origin+'/supervision/'+name+'.html',{waitUntil:'networkidle'});
    assert.equal(await page.locator('.sidebar').count(),1,'Missing sidebar on '+name);
    assert.equal(await page.locator('.topbar').count(),1,'Missing topbar on '+name);
    const menu=page.locator('.mobile-menu');
    assert.equal(await menu.isVisible(),true,'Mobile menu missing on '+name);
    await menu.click();
    assert.equal(await menu.getAttribute('aria-expanded'),'true','Mobile menu failed to open on '+name);
    await page.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('aria-expanded'),'false','Mobile menu failed to close on '+name);
    assert.deepEqual(errors,[],'JavaScript errors on '+name);
    console.log('PASS mobile shell/menu '+role+'/'+name);
    await page.close();
   }
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(err=>{console.error(err);process.exitCode=1;server.close();});
