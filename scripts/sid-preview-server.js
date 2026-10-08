// SID Tech 2.0 — servidor de vista previa estática. NO carga src/server.js.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../preview");
const port = Number(process.env.PORT || 3000);
const types = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".svg":"image/svg+xml"};
http.createServer((req,res)=>{
  const url = new URL(req.url,"http://localhost");
  if(url.pathname==="/health"){res.writeHead(200,{"Content-Type":"text/plain"});return res.end("SID preview OK");}
  const name = url.pathname==="/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(root,name);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end("Forbidden");}
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);return res.end("Not found");}
    res.writeHead(200,{"Content-Type":types[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store","Content-Security-Policy":"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'none'; frame-ancestors 'none'","X-Content-Type-Options":"nosniff"});
    res.end(data);
  });
}).listen(port,"0.0.0.0",()=>console.log("SID preview on port",port));
