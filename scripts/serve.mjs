import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../site/',import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};
http.createServer(async(req,res)=>{
  try {
    const requestPath=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let target=path.resolve(root,'.'+requestPath);
    if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    if((await stat(target)).isDirectory())target=path.join(target,'index.html');
    const body=await readFile(target);
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(body);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('페이지를 찾을 수 없습니다.');}
}).listen(4175,'127.0.0.1',()=>console.log('Local preview: http://127.0.0.1:4175'));
