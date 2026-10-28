import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

export function parsePort(value='4317') {
  if(!/^\d+$/.test(String(value)) || Number(value)<1 || Number(value)>65535)throw new Error('PORT must be an integer between 1 and 65535.');
  return Number(value);
}
export function dependencyStamp(lock,nodeVersion=process.versions.node) {
  return createHash('sha256').update(lock).update('\nnode='+nodeVersion.split('.')[0]).digest('hex');
}
export function npmInstallCommand(platform=process.platform,env=process.env) {
  return platform==='win32'?{file:env.ComSpec || 'cmd.exe',args:['/d','/s','/c','npm.cmd ci --no-audit --no-fund']}:{file:'npm',args:['ci','--no-audit','--no-fund']};
}
export async function probeServer(url) {
  try {
    const response=await fetch(url+'/api/info',{signal:AbortSignal.timeout(1000)});
    return response.ok && (await response.json()).name==='piagent-mission-control';
  } catch {return false;}
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function openBrowser(url) {
  const command=process.platform==='win32'?['rundll32.exe',['url.dll,FileProtocolHandler',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
  const child=spawn(command[0],command[1],{detached:true,stdio:'ignore',windowsHide:true});
  child.on('error',()=>console.log('Open this URL in your browser:',url));child.unref();
}
export async function main(args=process.argv.slice(2)) {
  if(args.includes('--help')) {
    console.log('PIagent launcher\nRequires Node.js 24+ and npm.\nnode scripts/launch.js [--no-open]\nInstalls locked dependencies on first start, then starts the local workspace.\nKeep this window open. Press Ctrl+C to stop.');return;
  }
  if(args.some(arg=>arg!=='--no-open'))throw new Error('Unknown option. Use --help.');
  if(Number(process.versions.node.split('.')[0])<24)throw new Error('Node.js 24 or newer is required: https://nodejs.org/');
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  try {process.loadEnvFile(path.join(root,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const port=parsePort(process.env.PORT),url=`http://127.0.0.1:${port}`,shouldOpen=!args.includes('--no-open') && process.env.PIAGENT_NO_OPEN!=='1';
  if(await probeServer(url)){console.log('PIagent is already running:',url);if(shouldOpen)openBrowser(url);return;}
  const lock=await fs.readFile(path.join(root,'package-lock.json')),stamp=dependencyStamp(lock),marker=path.join(root,'node_modules','.piagent-install.json');
  let installed;
  try {installed=JSON.parse(await fs.readFile(marker,'utf8'));await fs.access(path.join(root,'node_modules','@earendil-works','pi-agent-core','package.json'));}catch{installed=null;}
  if(installed?.stamp!==stamp) {
    console.log('Installing locked dependencies (first start or dependency update)...');
    const command=npmInstallCommand();
    await new Promise((resolve,reject)=>{
      const child=spawn(command.file,command.args,{cwd:root,stdio:'inherit',windowsHide:true});
      const progress=setInterval(()=>console.log('Still waiting for npm. Check the installer output above if this takes unusually long.'),30000);
      const timer=setTimeout(()=>{
        if(process.platform==='win32') {const stop=spawn('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore',windowsHide:true});stop.on('error',()=>child.kill());}
        else child.kill('SIGTERM');
        clearInterval(progress);reject(new Error('Dependency install timed out after 10 minutes. Check Node/npm and network access, or run npm ci manually.'));
      },600000);
      const clear=()=>{clearTimeout(timer);clearInterval(progress);};
      child.on('error',error=>{clear();reject(error);});child.on('exit',code=>{clear();code===0?resolve():reject(new Error('Dependency install failed. Check npm/network access and run start.bat again.'));});
    });
    await fs.writeFile(marker,JSON.stringify({stamp}));
  }
  console.log('Starting PIagent. Keep this window open; Ctrl+C stops the service.');
  const child=spawn(process.execPath,['--env-file-if-exists=.env','server/index.js'],{cwd:root,stdio:'inherit',windowsHide:true});
  let exited=false;
  const finished=new Promise(resolve=>{
    child.on('error',error=>{console.error(error.message);exited=true;resolve(1);});
    child.on('exit',code=>{exited=true;resolve(code??1);});
  });
  const stop=()=>{if(!exited)child.kill('SIGTERM');};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    const deadline=Date.now()+60000;let ready=false;
    while(!exited && Date.now()<deadline){if(await probeServer(url)){ready=true;break;}await sleep(200);}
    if(!ready){stop();throw new Error(`PIagent did not start on ${url}. Check the error above, or choose another PORT in .env.`);}
    console.log('Workspace:',url);if(shouldOpen)openBrowser(url);
    const code=await finished;if(code)process.exitCode=code;
  } finally {process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error('Launch failed:',error.message);process.exitCode=1;});
