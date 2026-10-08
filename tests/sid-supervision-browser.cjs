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
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(err=>{console.error(err);process.exitCode=1;server.close();});
