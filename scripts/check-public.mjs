import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const site=path.join(root,'site');
const blockedNames=/(?:client_secret|service[-_]?account|\.clasprc|\.env(?:\.|$)|\.sqlite|\.db$|\.pem$|\.key$|firebase-debug|backups?)/i;
const blockedContents=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/"type"\s*:\s*"service_account"/,/gh[pousr]_[A-Za-z0-9_]{30,}/,/github_pat_[A-Za-z0-9_]{30,}/,/AIza[^\s"']{20,}[^\s"']*/];
let count=0;
async function walk(dir){
  for(const item of await readdir(dir,{withFileTypes:true})){
    if(item.isSymbolicLink())throw new Error('Public tree must not contain symlinks');
    if(blockedNames.test(item.name))throw new Error('Sensitive filename in public tree');
    const file=path.join(dir,item.name);
    if(item.isDirectory()){await walk(file);continue;}
    if(!/\.(?:html|js|css|svg|json|txt|xml|webmanifest)$/.test(item.name)&&item.name!=='.nojekyll')throw new Error('Unexpected public artifact: '+path.relative(site,file));
    const content=await readFile(file,'utf8');
    for(const pattern of blockedContents){
      if(pattern===blockedContents.at(-1)&&path.relative(site,file).replaceAll('\\','/')==='apps/diary/firebase-config.js')continue;
      if(pattern.test(content))throw new Error('Secret-shaped content in public tree: '+path.relative(site,file));
    }
    if(/(?:localhost|127\.0\.0\.1):(?:8000|9005)/.test(content))throw new Error('Local backend URL in public artifact');
    count++;
  }
}
await walk(site);
console.log(`Public artifact check passed: ${count} text assets; no local diary database, credentials, or private keys.`);
