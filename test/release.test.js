import test from 'node:test';
import assert from 'node:assert/strict';
import {dependencyStamp,parsePort,npmInstallCommand,probeServer} from '../scripts/launch.js';
import {validatePublishFile} from '../scripts/check-publish.js';
import {createApp} from '../server/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {once} from 'node:events';

test('launcher validates ports and invalidates dependency cache on lock or Node major changes',()=>{
  assert.equal(parsePort(),4317);assert.equal(parsePort('9000'),9000);
  for(const value of ['',0,-1,'1.5','8080;echo',65536])assert.throws(()=>parsePort(value));
  const lock='locked-dependencies';assert.equal(dependencyStamp(lock,'24.1.0'),dependencyStamp(lock,'24.2.0'));
  assert.notEqual(dependencyStamp(lock,'24.1.0'),dependencyStamp(lock+'update','24.1.0'));assert.notEqual(dependencyStamp(lock,'24.1.0'),dependencyStamp(lock,'25.0.0'));
  assert.deepEqual(npmInstallCommand('linux'),{file:'npm',args:['ci','--no-audit','--no-fund']});assert.equal(npmInstallCommand('win32',{ComSpec:'cmd.exe'}).file,'cmd.exe');
});
test('publish check excludes runtime state, account login files and unreviewed binary assets',()=>{
  for(const file of ['.piagent/secrets.json','.env','.env.local','.codex/auth.json','credentials.json','docs/workbench.png','node_modules/private.js','public/secret.pem'])assert.ok(validatePublishFile(file,'private').length,file);
  assert.deepEqual(validatePublishFile('server/runtime.js','export const safe = true;'),[]);
  assert.deepEqual(validatePublishFile('.env.example','MOONSHOT_API_KEY=\nPORT=4317\n'),[]);
  assert.ok(validatePublishFile('.env.example','MOONSHOT_API_KEY=not-empty').length);
});
test('publish check detects tokens and exact local secret values without exposing them',()=>{
  const token='sk-'+ 'x'.repeat(35),local='local-value-'+ 'p'.repeat(20);
  assert.ok(validatePublishFile('README.md',token).includes('credential-pattern'));
  assert.deepEqual(validatePublishFile('README.md','Accidental value: '+local,[local]),['matches-local-secret']);
  assert.ok(validatePublishFile('config.example.json',JSON.stringify({connections:[{apiKey:local}]})).length);
});
test('launcher identifies only the PIagent service through public metadata',async t=>{
  const root=path.resolve(import.meta.dirname,'..'),baseDir=path.join(root,'.piagent','tests');await fs.mkdir(baseDir,{recursive:true});
  const dir=await fs.mkdtemp(path.join(baseDir,'launcher-')),app=await createApp({dataDir:dir,appRoot:root});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(async()=>{await app.close();const relative=path.relative(baseDir,dir);assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));await fs.rm(dir,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${app.server.address().port}`;assert.equal(await probeServer(url),true);
  const metadata=await(await fetch(url+'/api/info')).json();assert.deepEqual(metadata,{name:'piagent-mission-control',version:'0.2.0'});
  assert.equal(await probeServer(url+'/not-the-service'),false);
});
