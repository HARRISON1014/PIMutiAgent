import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parseEnv} from 'node:util';

const rootFiles=new Set(['.gitignore','.env.example','README.md','package.json','package-lock.json','config.example.json','start.bat','start.sh']);
const images=new Set(['docs/workspace-light.jpg','docs/sessions-management.jpg']);
export function validatePublishFile(file,content,localSecrets=[]) {
  const issues=[],allowed=rootFiles.has(file) || /^(server|public|scripts|test)\/[a-zA-Z0-9_.-]+\.(js|css|html|svg)$/.test(file) || /^docs\/[a-zA-Z0-9_.-]+\.md$/.test(file) || images.has(file);
  if(!allowed)return ['outside-source-allowlist'];
  const bytes=Buffer.isBuffer(content)?content:Buffer.from(content);
  if(images.has(file))return bytes.subarray(0,3).equals(Buffer.from([255,216,255]))?[]:['invalid-preview-image'];
  const text=bytes.toString('utf8');
  if(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/.test(text))issues.push('private-key');
  if(/(?:gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{25,}|AIza[A-Za-z0-9_-]{30,})/.test(text))issues.push('credential-pattern');
  if(/eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/.test(text))issues.push('jwt-token');
  if(/https?:\/\/[^\s/]+:[^\s@]+@/.test(text))issues.push('url-credentials');
  if(localSecrets.some(secret=>secret.length>=8 && text.includes(secret)))issues.push('matches-local-secret');
  if(file==='.env.example') {
    for(const [key,value] of Object.entries(parseEnv(text)))if(key!=='PORT' && value)issues.push('nonempty-example-setting');
  }
  if(file==='config.example.json') {
    try {
      const config=JSON.parse(text);
      for(const c of config.connections || [])if(Object.keys(c).some(key=>/^(apiKey|token|accessToken|refreshToken|password|secret)$/i.test(key)))issues.push('example-contains-credential-field');
    } catch {issues.push('invalid-example-json');}
  }
  return [...new Set(issues)];
}
async function localSecretValues(root) {
  const values=[];
  try {const saved=JSON.parse(await fs.readFile(path.join(root,'.piagent','secrets.json'),'utf8'));for(const value of Object.values(saved))if(typeof value==='string')values.push(value);}catch(error){if(error.code!=='ENOENT')throw error;}
  try {for(const [name,value] of Object.entries(parseEnv(await fs.readFile(path.join(root,'.env'),'utf8'))))if(/KEY|TOKEN|SECRET|PASSWORD/i.test(name))values.push(value);}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const [name,value] of Object.entries(process.env))if(/API_?KEY|ACCESS_TOKEN|REFRESH_TOKEN|SECRET/i.test(name) && value)values.push(value);
  return values.filter(value=>value.length>=8);
}
export async function main(args=process.argv.slice(2)) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),treeArg=args.find(arg=>arg.startsWith('--tree='));
  if(args.some(arg=>arg!=='--staged' && !arg.startsWith('--tree=')))throw new Error('Use --staged (default) or --tree=HEAD.');
  const ref=treeArg?.slice(7);
  if(ref && !/^[A-Za-z0-9_./-]+$/.test(ref))throw new Error('Invalid Git tree reference.');
  const git=argv=>execFileSync('git',argv,{cwd:root,windowsHide:true,maxBuffer:8*1024*1024});
  const records=git(ref?['ls-tree','-r','-z',ref]:['ls-files','--stage','-z']).toString('utf8').split('\0').filter(Boolean);
  const localSecrets=await localSecretValues(root),failures=[];
  if(!records.length)throw new Error('No tracked/staged files. Stage the reviewed source files first.');
  for(const record of records) {
    const tab=record.indexOf('\t'),metadata=record.slice(0,tab).split(' '),file=record.slice(tab+1);
    if(!['100644','100755'].includes(metadata[0])){failures.push({file,issues:['non-regular-file']});continue;}
    const content=git(['show',ref?`${ref}:${file}`:`:${file}`]);
    const issues=validatePublishFile(file,content,localSecrets);if(issues.length)failures.push({file,issues});
  }
  if(failures.length){for(const failure of failures)console.error(`${failure.file}: ${failure.issues.join(', ')}`);throw new Error('Publish check failed. No secret values were printed.');}
  console.log(`Publish check passed: ${records.length} ${ref?'committed':'staged'} source files; runtime data and credentials excluded.`);
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});

