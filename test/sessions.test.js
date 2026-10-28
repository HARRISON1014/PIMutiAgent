import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createApp} from '../server/index.js';
import {Store} from '../server/store.js';
const root=path.resolve(import.meta.dirname,'..'),testRoot=path.join(root,'.piagent','tests');
async function fixture(t) {
  await fs.mkdir(testRoot,{recursive:true});
  const dir=await fs.mkdtemp(path.join(testRoot,'session-lifecycle-'));
  const app=await createApp({dataDir:dir,appRoot:root});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{await app.close();const relative=path.relative(testRoot,dir);assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));await fs.rm(dir,{recursive:true,force:true});});
  const request=async(url,method='GET',body)=>{
    const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json','X-PIagent':'1'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,value:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text()};
  };
  async function seed(title='Session') {
    const config=app.config.get(),id=randomUUID();
    const run={id,title,prompt:title,projectPath:root,config,workflow:config.workflow,demo:true,status:'completed',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),tasks:[],messages:[{id:randomUUID(),role:'user',text:title,at:new Date().toISOString()}],approvals:[],artifacts:[{taskId:'report',path:'report.txt',bytes:9}],activeCalls:[],revision:0,usage:{input:0,output:0,cached:0,byProvider:{}}};
    const output=path.join(dir,'workspaces',id,'report','report.txt');
    await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,'Keep file');
    app.store.event(run,{runId:id,type:'message',at:run.createdAt,text:title});return {run,output};
  }
  return {app,dir,base,request,seed};
}
test('archive persists, hides only the chosen session and restores its complete history',async t=>{
  const {app,dir,request,seed}=await fixture(t),{run}=await seed('Archive me'),other=await seed('Keep visible');
  assert.equal((await request('/sessions.js')).status,200);
  assert.equal((await request(`/api/runs/${run.id}/archive`,'POST',{archived:'true'})).status,400);
  const archived=await request(`/api/runs/${run.id}/archive`,'POST',{archived:true});assert.equal(archived.status,200);assert.ok(archived.value.archivedAt);
  let state=(await request('/api/state')).value;
  assert.deepEqual(state.runs.map(r=>r.id),[other.run.id]);assert.deepEqual(state.archivedRuns.map(r=>r.id),[run.id]);
  const persisted=new Store(dir);assert.equal(persisted.get(run.id).archivedAt,archived.value.archivedAt);persisted.close();
  assert.equal((await request(`/api/runs/${run.id}/messages`,'POST',{text:'Hidden mutation'})).status,400);
  assert.equal((await request(`/api/runs/${run.id}/retry`,'POST',{})).status,400);
  assert.equal((await request(`/api/runs/${run.id}/followup`,'POST',{text:'Hidden execution'})).status,400);
  assert.equal((await request(`/api/runs/${run.id}/artifact?taskId=report&path=report.txt`)).value.content,'Keep file');
  assert.equal((await request(`/api/runs/${run.id}/archive`,'POST',{archived:false})).status,200);
  state=(await request('/api/state')).value;assert.equal(state.runs.length,2);assert.equal(state.archivedRuns.length,0);
  const restored=app.runner.get(run.id);assert.deepEqual(restored.messages,run.messages);assert.deepEqual(restored.artifacts,run.artifacts);assert.equal(restored.archivedAt,null);assert.equal(app.store.events(run.id).length,3);
});
test('delete removes conversation and events atomically, preserves files and notifies connected views',async t=>{
  const {app,dir,base,request,seed}=await fixture(t),{run,output}=await seed('Delete test record'),other=await seed('Unrelated record');
  await request(`/api/runs/${run.id}/archive`,'POST',{archived:true});
  assert.equal((await fetch(`${base}/api/runs/${run.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'}})).status,403);
  const stream=await fetch(base+'/api/events',{signal:AbortSignal.timeout(5000)}),reader=stream.body.getReader();
  await reader.read(); // Consume the initial sync frame before deletion.
  assert.equal((await request(`/api/runs/${run.id}`,'DELETE',{})).status,200);
  const notification=new TextDecoder().decode((await reader.read()).value);await reader.cancel();
  assert.match(notification,/"type":"run_deleted"/);assert.ok(notification.includes(run.id));assert.doesNotMatch(notification,/id: undefined/);
  assert.equal(app.store.get(run.id),null);assert.deepEqual(app.store.events(run.id),[]);assert.equal((await request(`/api/runs/${run.id}`)).status,404);
  assert.equal((await request(`/api/runs/${run.id}`,'DELETE',{})).status,404);
  const state=(await request('/api/state')).value;assert.deepEqual(state.runs.map(r=>r.id),[other.run.id]);assert.equal(state.archivedRuns.length,0);
  assert.equal(await fs.readFile(output,'utf8'),'Keep file');
  const persisted=new Store(dir);assert.equal(persisted.get(run.id),null);assert.deepEqual(persisted.events(run.id),[]);persisted.close();
});
test('running and assignment-waiting sessions cannot be archived or deleted until stopped',async t=>{
  const {app,request}=await fixture(t);
  const created=await request('/api/runs','POST',{prompt:'Disposable lifecycle test',projectPath:root,demo:true,workflow:{assignmentMode:'review'}});assert.equal(created.status,201);
  const id=created.value.id,live=app.runner.live.get(id);
  assert.equal((await request(`/api/runs/${id}/archive`,'POST',{archived:true})).status,400);
  assert.equal((await request(`/api/runs/${id}`,'DELETE',{})).status,400);
  assert.ok(app.runner.get(id));app.runner.cancel(id);await live.promise;
  assert.equal((await request(`/api/runs/${id}/archive`,'POST',{archived:true})).status,200);
  assert.equal((await request(`/api/runs/${id}`,'DELETE',{})).status,200);
});
