import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { z } from 'zod';
import { createConfig } from '../server/config.js';
import { Store } from '../server/store.js';
import { Orchestrator } from '../server/orchestrator.js';
import { configSchema, normalizeConfig, connectionSchema, planSchema } from '../server/schema.js';
import { getWorkflow, routePlan } from '../server/routing.js';
import { ModelRuntime } from '../server/runtime.js';
import { executeWorker } from '../server/worker.js';
import { cliStructured, parseCliResult } from '../server/cli.js';
import { listConnectionModels } from '../server/api-models.js';
import { readText } from '../server/files.js';
import { catalog } from '../server/catalog.js';
import { createApp } from '../server/index.js';

const root=path.resolve(import.meta.dirname,'..'),tempRoot=path.join(root,'.piagent','tests');
await fs.mkdir(tempRoot,{recursive:true});
async function remove(dir){const relative=path.relative(tempRoot,path.resolve(dir));if(!relative || relative.startsWith('..') || path.isAbsolute(relative))throw new Error('Unsafe cleanup');await fs.rm(dir,{recursive:true,force:true});}
const task=(id,worker='kimi',dependsOn=[])=>({id,title:id,instructions:'Write a complete deliverable',worker,dependsOn,acceptance:['Deliverable is complete']});
const plan=tasks=>({summary:'Plan',questions:[],tasks});
const pass={verdict:'pass',summary:'Evidence verified',questions:[],revisions:[]};
async function fixture(t,{supervisor,worker,workflow={},runtime}={}){
  const dir=await fs.mkdtemp(path.join(tempRoot,'v2-')),dataDir=path.join(dir,'data'),project=path.join(dir,'project');await fs.mkdir(project);
  const config=createConfig(root,dataDir),cfg=config.get();cfg.connections.filter(c=>c.kind!=='subscription-cli').forEach(c=>c.model='mock');
  Object.assign(cfg.workflow,workflow);config.save({...cfg,keys:{MOONSHOT_API_KEY:'mock-kimi',DEEPSEEK_API_KEY:'mock-deepseek'}});
  const store=new Store(dataDir),runner=new Orchestrator({store,config,dataDir,supervisor,worker,runtime});
  t.after(async()=>{await runner.shutdown();store.close();await remove(dir);});return {dir,dataDir,project,config,store,runner};
}
async function wait(check){const start=Date.now();while(!check()){if(Date.now()-start>4000)throw new Error('Timed out');await new Promise(r=>setTimeout(r,5));}}
async function finish(f,id){await f.runner.live.get(id)?.promise;return f.runner.get(id);}

test('v1 configuration migrates into an arbitrary-role connection registry without losing endpoints',()=>{
  const old={codex:{binary:'my-codex',model:'chosen-gpt'},workers:[{id:'kimi',name:'Kimi',baseUrl:'https://example.com/v1',model:'my-model',apiKeyEnv:'KEY'}],policy:{concurrency:2,maxRevisions:1,maxWorkerTurns:5,maxRunInputTokens:10000,maxRunOutputTokens:10000}};
  const c=normalizeConfig(old);assert.equal(c.connections[0].binary,'my-codex');assert.equal(c.connections[1].model,'my-model');assert.equal(c.workflow.reviewer,'codex');
  assert.throws(()=>configSchema.parse({...c,workflow:{...c.workflow,reviewer:'missing'}}));
  assert.ok(catalog.some(p=>p.kind==='subscription-cli'&&p.adapter==='claude'));assert.ok(catalog.some(p=>p.api==='google-generative-ai'));assert.ok(catalog.some(p=>p.kind==='coding-plan'));
});

test('routing rules lock first matching assignment; manual tasks may use any enabled connection',async t=>{
  const f=await fixture(t),c=f.config.get(),w=getWorkflow(c,{rules:[{match:'front',worker:'codex',allowFallback:false},{match:'front',worker:'deepseek',allowFallback:true}]});
  const p=routePlan(plan([task('frontend')]),c,w);assert.equal(p.tasks[0].worker,'codex');assert.equal(p.tasks[0].pinned,true);assert.equal(p.tasks[0].allowFallback,false);
  assert.equal(routePlan(plan([task('manual','codex')]),c,w,{manual:true}).tasks[0].assignmentSource,'user');
  assert.throws(()=>routePlan(plan([task('bad','codex')]),c,w),/未配置/);
  assert.throws(()=>routePlan(plan([task('a','codex',['b']),task('b','kimi',['a'])]),c,w,{manual:true}),/循环/);
});

test('planning, auditing and risk review use independently selected API connections',async t=>{
  const calls=[];
  const f=await fixture(t,{workflow:{planner:'deepseek',reviewer:'kimi',riskReviewer:'deepseek'},supervisor:async ({connection,schema})=>{calls.push(connection.id);return schema===planSchema?plan([task('a')]):pass;},worker:async()=> 'Delivered'});
  const before=JSON.stringify(f.config.get().workflow),run=await f.runner.create({prompt:'Build',projectPath:f.project,workflow:{planner:'kimi',reviewer:'deepseek'}});
  assert.equal((await finish(f,run.id)).status,'completed');assert.deepEqual(calls,['kimi','deepseek']);assert.equal(JSON.stringify(f.config.get().workflow),before);
});

test('manual mode skips model planning and can assign Codex subscription to execution',async t=>{
  const roles=[],executors=[];
  const f=await fixture(t,{supervisor:async ({connection,schema})=>{assert.notEqual(schema,planSchema);roles.push(connection.id);return pass;},worker:async({worker})=>{executors.push(worker.id);return 'Delivered';}});
  const run=await f.runner.create({prompt:'Implement my design',projectPath:f.project,workflow:{assignmentMode:'manual',reviewer:'deepseek'},manualTasks:[task('implement','codex')]});
  const result=await finish(f,run.id);assert.equal(result.status,'completed');assert.deepEqual(executors,['codex']);assert.deepEqual(roles,['deepseek']);assert.equal(result.tasks[0].pinned,true);
});

test('review mode performs zero work until the user edits and confirms the plan',async t=>{
  const executed=[];
  const f=await fixture(t,{workflow:{assignmentMode:'review'},supervisor:async({schema})=>schema===planSchema?plan([task('a'),task('b','deepseek',['a'])]):pass,worker:async({task,worker})=>{executed.push([task.id,worker.id]);return 'Delivered';}});
  const run=await f.runner.create({prompt:'Build',projectPath:f.project});await wait(()=>run.status==='waiting_assignment');assert.equal(executed.length,0);
  assert.throws(()=>f.runner.confirmPlan(run.id,[task('a','missing')]),/模型/);
  f.runner.assignTask(run.id,'a',{worker:'codex'});
  assert.throws(()=>f.runner.confirmPlan(run.id,[task('a')],0),/刚刚/);
  f.runner.confirmPlan(run.id,[{...task('custom','codex'),instructions:'User replaced the original task'}]);
  const result=await finish(f,run.id);assert.equal(result.status,'completed');assert.deepEqual(executed,[['custom','codex']]);assert.equal(result.tasks[0].assignmentSource,'user');
  assert.throws(()=>f.runner.confirmPlan(run.id,[task('a')]),/等待分工/);
});

test('manually pinned execution never silently switches to a fallback model',async t=>{
  const calls=[];
  const f=await fixture(t,{supervisor:async()=>pass,worker:async({worker})=>{calls.push(worker.id);throw new Error('Model unavailable');}});
  const run=await f.runner.create({prompt:'Build',projectPath:f.project,workflow:{assignmentMode:'manual'},manualTasks:[task('a','codex')]});
  const result=await finish(f,run.id);assert.equal(result.status,'failed');assert.deepEqual(calls,['codex']);assert.equal(result.tasks[0].attempts,1);
});

test('audit revisions preserve user-selected executors',async t=>{
  let audits=0;const calls=[];
  const f=await fixture(t,{supervisor:async()=>++audits===1?{verdict:'revise',summary:'Fix',questions:[],revisions:[{taskId:'a',instructions:'Improve',issueKey:'missing-behavior',evidence:'Mock task result is incomplete',rationale:'Acceptance requires a complete deliverable',worker:'deepseek'}]}:pass,worker:async({worker})=>{calls.push(worker.id);return 'Delivered';}});
  const run=await f.runner.create({prompt:'Build',projectPath:f.project,workflow:{assignmentMode:'manual'},manualTasks:[task('a','codex')]});
  assert.equal((await finish(f,run.id)).status,'completed');assert.deepEqual(calls,['codex','codex']);
});

test('pending tasks can be reassigned during execution; running tasks cannot',async t=>{
  let release;const gate=new Promise(r=>release=r),calls=[];
  const f=await fixture(t,{supervisor:async({schema})=>schema===planSchema?plan([task('a'),task('b','deepseek',['a'])]):pass,worker:async({task,worker})=>{calls.push([task.id,worker.id]);if(task.id==='a')await gate;return 'Delivered';}});
  const run=await f.runner.create({prompt:'Build',projectPath:f.project});await wait(()=>calls.length);
  assert.throws(()=>f.runner.assignTask(run.id,'a',{worker:'codex'}),/尚未开始/);
  f.runner.assignTask(run.id,'b',{worker:'codex'});release();assert.equal((await finish(f,run.id)).status,'completed');assert.deepEqual(calls,[['a','kimi'],['b','codex']]);
});

test('canceling assignment review settles cleanly and crash recovery retains the review state as interrupted',async t=>{
  const f=await fixture(t,{supervisor:async()=>plan([task('a')]),worker:async()=>{throw new Error('Must not execute');}});
  const run=await f.runner.create({prompt:'Build',projectPath:f.project,workflow:{assignmentMode:'review'}});await wait(()=>run.status==='waiting_assignment');f.runner.cancel(run.id);assert.equal((await finish(f,run.id)).status,'cancelled');
  f.store.save({...run,id:'crashed-review',status:'waiting_assignment',activeCalls:[{id:'stale'}]});f.store.recover();const recovered=f.store.get('crashed-review');assert.equal(recovered.status,'interrupted');assert.deepEqual(recovered.activeCalls,[]);
});

test('five non-Codex CLI adapters enforce native tool boundaries and parse terminal results',async t=>{
  const dir=await fs.mkdtemp(path.join(tempRoot,'cli-adapters-'));t.after(()=>remove(dir));
  for(const adapter of ['claude','gemini','copilot','qwen','kimi']){
    const calls=[];const c=connectionSchema.parse({id:adapter,name:adapter,kind:'subscription-cli',adapter,binary:adapter});
    const result=await cliStructured({connection:c,prompt:'Return ok',schema:z.object({ok:z.literal(true)}),dataDir:dir,signal:new AbortController().signal,readAuthSettings:async()=>({security:{auth:{selectedType:'qwen-oauth'}}}),execute:async(binary,args,options)=>{
      calls.push(args);assert.equal(options.env.ANTHROPIC_API_KEY,undefined);assert.equal(options.env.OPENAI_API_KEY,undefined);
      if(args[0]==='auth')return {code:0,stdout:JSON.stringify({authMethod:'claude.ai'}),stderr:''};
      if(adapter==='claude'){assert.ok(args.includes('--tools'));assert.ok(args.includes(''));assert.ok(args.includes('--safe-mode'));return {code:0,stdout:JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:{ok:true},usage:{input_tokens:10,output_tokens:5}}),stderr:''};}
      if(adapter==='gemini'){const settings=JSON.parse(await fs.readFile(options.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH,'utf8'));assert.equal(settings.security.auth.enforcedType,'oauth-personal');assert.ok(args.includes('--policy'));return {code:0,stdout:JSON.stringify({response:'{"ok":true}',stats:{models:{test:{tokens:{prompt:10,candidates:5,cached:0}}}}}),stderr:''};}
      if(adapter==='qwen'){assert.ok(args.includes('--max-tool-calls'));assert.ok(args.includes('0'));assert.ok(args.includes('--exclude-tools'));return {code:0,stdout:JSON.stringify([{type:'result',subtype:'success',result:'{"ok":true}'}]),stderr:''};}
      if(adapter==='kimi')assert.match(await fs.readFile(path.join(options.cwd,'agent.yaml'),'utf8'),/tools: \[\]/);
      if(adapter==='copilot'){assert.ok(args.includes('--available-tools=view'));assert.match(await fs.readFile(path.join(options.cwd,'request.md'),'utf8'),/Return ok/);}
      return {code:0,stdout:'{"ok":true}',stderr:''};
    }});
    assert.equal(result.ok,true);assert.ok(calls.length>=1);
  }
  assert.throws(()=>parseCliResult('claude',JSON.stringify({is_error:true,result:'Denied'})),/Denied/);
  assert.throws(()=>parseCliResult('qwen',JSON.stringify([{type:'assistant',message:'No terminal result'}])),/缺少/);
  assert.throws(()=>parseCliResult('gemini',JSON.stringify({error:{message:'Quota'}})),/Quota/);
});

test('subscription execution uses the real Pi host tool loop and creates actual artifacts',async t=>{
  const f=await fixture(t);let turns=0;const artifacts=[],events=[];
  const runtime=new ModelRuntime({config:f.config,dataDir:f.dataDir,cli:async({schema,onEvent,prompt})=>{
    turns++;assert.match(prompt,/write_file/);onEvent({type:'usage',usage:{input:100,output:20,cached:0,source:'codex'}});
    return schema.parse(turns===1?{text:'保存产物',toolCalls:[{name:'write_file',arguments:JSON.stringify({path:'deliverable.txt',content:'Created by the Pi subscription bridge'})}]}:{text:'已交付，未执行命令测试。',toolCalls:[]});
  }});
  const connection=f.config.get().connections.find(c=>c.id==='codex'),workDir=path.join(f.dir,'output');await fs.mkdir(workDir);
  const result=await executeWorker({worker:connection,task:task('a','codex'),run:{prompt:'Write a file',projectPath:f.project,tasks:[],artifacts:[],messages:[]},workDir,policy:{maxWorkerTurns:5},signal:new AbortController().signal,onEvent:e=>events.push(e),authorize:async()=>{throw new Error('Unexpected command');},artifact:a=>artifacts.push(a),readDependency:async()=>'',beforeRequest:()=>{},runtime});
  assert.match(result,/已交付/);assert.equal(turns,2);assert.equal(artifacts.length,1);assert.match(await readText(workDir,'deliverable.txt'),/subscription bridge/);assert.equal(events.filter(e=>e.type==='usage').reduce((sum,e)=>sum+e.usage.input,0),200);
});

test('native Anthropic, Gemini and OpenAI Responses protocols support structured role calls and model lists',async t=>{
  const received=[];
  const upstream=http.createServer(async(req,res)=>{
    const chunks=[];for await(const b of req)chunks.push(b);const payload=chunks.length?JSON.parse(Buffer.concat(chunks)):null;received.push(req.url);
    if(req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url.includes('v1beta')?{models:[{name:'models/mock'}]}:{data:[{id:'mock'}]}));return;}
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const sse=(type,value)=>res.write(`${type?'event: '+type+'\n':''}data: ${JSON.stringify(value)}\n\n`);
    if(req.url.startsWith('/anthropic')){
      assert.equal(req.headers['x-api-key'],'mock-key');assert.equal(payload.model,'mock');
      for(const event of [{type:'message_start',message:{id:'msg_1',type:'message',role:'assistant',model:'mock',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'{"ok":true}'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:5}},{type:'message_stop'}])sse(event.type,event);
    } else if(req.url.startsWith('/gemini')){
      assert.equal(req.headers['x-goog-api-key'],'mock-key');sse('',{candidates:[{content:{role:'model',parts:[{text:'{"ok":true}'}]},finishReason:'STOP',index:0}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:5,totalTokenCount:15}});
    } else {
      assert.equal(req.headers.authorization,'Bearer mock-key');const item={id:'msg_1',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'{"ok":true}',annotations:[]}]};
      const events=[{type:'response.created',response:{id:'resp_1',status:'in_progress',created_at:1,model:'mock',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.content_part.added',item_id:'msg_1',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',item_id:'msg_1',output_index:0,content_index:0,delta:'{"ok":true}'},{type:'response.output_text.done',item_id:'msg_1',output_index:0,content_index:0,text:'{"ok":true}'},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{id:'resp_1',status:'completed',model:'mock',output:[item],usage:{input_tokens:10,output_tokens:5,total_tokens:15,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}}];events.forEach((ev,i)=>sse(ev.type,{...ev,sequence_number:i}));
    }
    res.end();
  });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');t.after(()=>new Promise(r=>upstream.close(r)));
  const base=`http://127.0.0.1:${upstream.address().port}`,config={key:()=> 'mock-key'},runtime=new ModelRuntime({config,dataDir:tempRoot});
  for(const [id,api,baseUrl] of [['a','anthropic-messages',base+'/anthropic'],['g','google-generative-ai',base+'/gemini/v1beta'],['o','openai-responses',base+'/openai/v1']]){
    const c=connectionSchema.parse({id,name:id,kind:'api',api,baseUrl,model:'mock',apiKeyEnv:'MOCK_KEY'}),events=[];
    const result=await runtime.structured({connection:c,prompt:'Return ok',schema:z.object({ok:z.literal(true)}),signal:AbortSignal.timeout(15000),onEvent:e=>events.push(e)});
    assert.equal(result.ok,true);assert.ok(events.some(e=>e.type==='usage'&&e.usage.input===10));assert.deepEqual(await listConnectionModels(c,'mock-key'),['mock']);
  }
  assert.ok(received.some(v=>v.includes('/v1/messages')));assert.ok(received.some(v=>v.includes('streamGenerateContent')));assert.ok(received.some(v=>v.includes('/responses')));
});

test('HTTP assignment workflow validates versions and serves the configurable frontend modules',async t=>{
  const dir=await fs.mkdtemp(path.join(tempRoot,'v2-http-')),app=await createApp({dataDir:dir,appRoot:root});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(async()=>{await app.close();await remove(dir);});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=(url,body)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json','X-PIagent':'1'},body:JSON.stringify(body)});
  for(const file of ['settings.js','dashboard.js'])assert.equal((await fetch(base+'/'+file)).status,200);
  const metadata=await(await fetch(base+'/api/catalog')).json();assert.equal(metadata.catalog.filter(c=>c.kind==='subscription-cli').length,6);
  const response=await request('/api/runs',{prompt:'Test user assignment',projectPath:root,demo:true,workflow:{assignmentMode:'review'}});assert.equal(response.status,201);const run=await response.json();
  await wait(()=>app.runner.get(run.id).status==='waiting_assignment');
  const tasks=app.runner.get(run.id).tasks;
  assert.equal((await request(`/api/runs/${run.id}/tasks/${tasks[0].id}/assign`,{worker:'codex'})).status,200);
  assert.equal((await request(`/api/runs/${run.id}/plan`,{tasks,version:0})).status,400);
  const current=app.runner.get(run.id);
  assert.equal((await request(`/api/runs/${run.id}/plan`,{tasks:current.tasks,version:current.assignmentVersion})).status,200);
  await app.runner.live.get(run.id)?.promise;const finished=app.runner.get(run.id);assert.equal(finished.status,'completed');assert.equal(finished.tasks[0].worker,'codex');assert.ok(finished.tasks.every(t=>t.pinned));
});
