import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createConfig } from '../server/config.js';
import { Store } from '../server/store.js';
import { Orchestrator } from '../server/orchestrator.js';
import { validatePlan, planSchema, auditSchema } from '../server/schema.js';
import { confined, writeText, readText } from '../server/files.js';
import { executeWorker } from '../server/worker.js';
import { createApp } from '../server/index.js';
import { codexRequest } from '../server/codex.js';
import { riskSchema } from '../server/schema.js';

const appRoot = path.resolve(import.meta.dirname, '..');
const tempRoot = path.join(appRoot, '.piagent', 'tests');
await fs.mkdir(tempRoot, {recursive:true});
async function cleanup(dir) {
  const relative = path.relative(path.resolve(tempRoot), path.resolve(dir));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Refusing cleanup outside the test workspace');
  await fs.rm(dir, {recursive:true,force:true});
}
const task = (id, deps = [], worker = 'kimi') => ({ id, title: id, instructions: 'Write a useful file', worker, dependsOn: deps, acceptance: ['File exists and satisfies the request'] });
const plan = tasks => ({ summary: 'Plan', questions: [], tasks });
const pass = { verdict: 'pass', summary: 'Validated actual artifacts', questions: [], revisions: [] };
async function fixture(t, { supervisor, worker, policy = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(tempRoot, 'piagent-test-')), dataDir = path.join(dir, 'data'), project = path.join(dir, 'project');
  await fs.mkdir(project); await fs.writeFile(path.join(project, 'source.txt'),'source');
  const config = createConfig(appRoot, dataDir), cfg = config.get();
  cfg.connections.forEach(w => w.model = 'test-model'); Object.assign(cfg.policy,policy);
  config.save({ ...cfg, keys: { MOONSHOT_API_KEY:'test-secret-kimi', DEEPSEEK_API_KEY:'test-secret-deepseek' } });
  const store = new Store(dataDir), events = [];
  const runner = new Orchestrator({ store, config, dataDir, emit:ev => events.push(ev), supervisor, worker });
  t.after(async () => { await runner.shutdown(); store.close(); await cleanup(dir); });
  return { dir, dataDir, project, config, store, runner, events };
}
async function waitFor(check, timeout = 4000) {
  const start = Date.now(); while (!check()) { if (Date.now()-start>timeout) throw new Error('Timed out'); await new Promise(r => setTimeout(r,5)); }
}
async function settled(runner, id) { const pending = runner.live.get(id)?.promise; if (pending) await pending; return runner.get(id); }

test('planner rejects duplicate IDs, cycles, missing dependencies and unknown providers', () => {
  assert.throws(() => validatePlan(plan([task('a'),task('a')]),['kimi']),/重复/);
  assert.throws(() => validatePlan(plan([task('a',['b']),task('b',['a'])]),['kimi']),/循环/);
  assert.throws(() => validatePlan(plan([task('a',['missing'])]),['kimi']),/依赖/);
  assert.throws(() => validatePlan(plan([task('a',[],'wrong')]),['kimi']),/模型/);
  assert.equal(validatePlan(plan([task('a'),task('b',['a'])]),['kimi']).tasks.length,2);
});

test('file tools reject traversal, private files, alternate streams and junctions', async t => {
  const dir = await fs.mkdtemp(path.join(tempRoot,'piagent-files-'));
  t.after(() => cleanup(dir));
  for (const file of ['../outside','.env','.git/config','folder/../../escape','C:\\private','file:stream','.piagent/secrets.json','.env.','.. /escape','NUL.txt']) await assert.rejects(confined(dir,file,{write:true}));
  await writeText(dir,'nested/file.txt','hello'); assert.equal(await readText(dir,'nested/file.txt'),'hello');
  await assert.rejects(writeText(dir,'large.txt','x'.repeat(128001)),/128 KB/);
  const outside = path.join(dir,'outside'); await fs.mkdir(outside);
  try { await fs.symlink(outside,path.join(dir,'link'),process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code !== 'EPERM') throw error; return; }
  await assert.rejects(confined(dir,'link/private.txt',{write:true}),/链接|联接/);
});

test('parallel DAG waits for dependencies; audit revision invalidates all downstream tasks', async t => {
  let active = 0, peak = 0, auditCalls = 0; const executions = [];
  const f = await fixture(t,{
    supervisor: async ({schema}) => schema === planSchema ? plan([task('a'),task('b',[],'deepseek'),task('c',['a','b'])]) : ++auditCalls === 1 ? { verdict:'revise', summary:'Fix a', questions:[], revisions:[{taskId:'a',instructions:'Fix missing behavior',issueKey:'missing-behavior',evidence:'Test fixture output lacks required behavior',rationale:'Required for the acceptance criterion'}] } : pass,
    worker: async ({task,run,workDir,artifact,onEvent}) => {
      active++; peak = Math.max(peak,active); executions.push(task.id);
      if (task.id === 'c') assert.ok(run.tasks.filter(t => ['a','b'].includes(t.id)).every(t => t.status === 'completed'));
      await new Promise(r => setTimeout(r,25)); artifact(await writeText(workDir,'output.txt',task.instructions));
      onEvent({type:'usage',usage:{input:100,output:20,cached:10,source:task.worker}}); active--; return 'Delivered';
    },
  });
  const run = await f.runner.create({prompt:'Build a feature',projectPath:f.project});
  const result = await settled(f.runner,run.id);
  assert.equal(result.status,'completed'); assert.equal(peak,2); assert.equal(result.revision,1);
  assert.deepEqual(executions,['a','b','c','a','c']); assert.equal(result.usage.input,500);
  assert.equal(result.artifacts.length,3); assert.equal(result.tasks.find(t => t.id === 'b').attempts,1);
});

test('worker connection failures fall back once and retain evidence', async t => {
  const calls = [];
  const f = await fixture(t,{supervisor:async ({schema}) => schema === planSchema ? plan([task('a')]) : pass,
    worker:async ({worker}) => { calls.push(worker.id); if (worker.id === 'kimi') throw new Error('HTTP 429 test-secret-kimi'); return 'Done'; }});
  const run = await f.runner.create({prompt:'Task',projectPath:f.project}), result = await settled(f.runner,run.id);
  assert.equal(result.status,'completed'); assert.deepEqual(calls,['kimi','deepseek']);
  assert.equal(result.tasks[0].worker,'deepseek'); assert.ok(!JSON.stringify(f.store.events(run.id)).includes('test-secret-kimi'));
});

test('a confirmation is bound to its run and single use; source is not executed before approval', async t => {
  let executed = false;
  const f = await fixture(t,{supervisor:async ({schema}) => schema === planSchema ? plan([task('a')]) : schema === auditSchema ? pass : {decision:'ask',reason:'Need to run a bounded test'},
    worker:async ({authorize}) => { await authorize({executable:'node',args:['--version']}); executed = true; return 'Executed approved command'; }});
  const run = await f.runner.create({prompt:'Verify',projectPath:f.project});
  await waitFor(() => f.runner.get(run.id)?.approvals.some(a => a.status === 'pending'));
  const approval = run.approvals[0]; assert.equal(executed,false);
  assert.throws(() => f.runner.resolveApproval('wrong',approval.id,{approved:true}),/失效/);
  f.runner.resolveApproval(run.id,approval.id,{approved:true});
  assert.throws(() => f.runner.resolveApproval(run.id,approval.id,{approved:true}),/失效/);
  const result = await settled(f.runner,run.id); assert.equal(result.status,'completed'); assert.equal(executed,true);
});

test('cancel aborts a pending confirmation and never executes the action', async t => {
  let executed = false;
  const f = await fixture(t,{supervisor:async ({schema}) => schema === planSchema ? plan([task('a')]) : {decision:'ask',reason:'Confirm'},
    worker:async ({authorize}) => { await authorize({executable:'node',args:['--version']}); executed = true; return 'Done'; }});
  const run = await f.runner.create({prompt:'Verify',projectPath:f.project});
  await waitFor(() => run.approvals.length); f.runner.cancel(run.id);
  const result = await settled(f.runner,run.id);
  assert.equal(result.status,'cancelled'); assert.equal(executed,false); assert.equal(result.approvals[0].status,'expired');
});

test('usage threshold stops new work and recovery retains completed task state', async t => {
  let count = 0;
  const f = await fixture(t,{policy:{concurrency:1,maxRunInputTokens:1000},supervisor:async ({schema}) => schema === planSchema ? plan([task('a'),task('b')]) : pass,
    worker:async ({onEvent,task}) => { count++; onEvent({type:'usage',usage:{input:1200,output:10,source:task.worker}}); return 'Done'; }});
  const run = await f.runner.create({prompt:'Work',projectPath:f.project}), failed = await settled(f.runner,run.id);
  assert.equal(failed.status,'failed'); assert.equal(count,1); assert.equal(failed.tasks[0].status,'completed');
  const cfg = f.config.get(); cfg.policy.maxRunInputTokens = 10000; f.config.save(cfg);
  await f.runner.retry(run.id); const result = await settled(f.runner,run.id);
  assert.equal(result.status,'completed'); assert.equal(count,2); assert.equal(result.tasks[0].attempts,1);
});

test('planning clarification regenerates the plan with user context', async t => {
  let plans = 0;
  const f = await fixture(t,{supervisor:async ({schema,prompt}) => {
    if (schema !== planSchema) return pass;
    if (++plans === 1) return {...plan([task('a')]),questions:['Which format?']};
    assert.match(prompt,/Markdown/); return plan([task('b')]);
  },worker:async () => 'Delivered'});
  const run = await f.runner.create({prompt:'Prepare a report',projectPath:f.project});
  await waitFor(() => run.approvals.length);
  f.runner.resolveApproval(run.id,run.approvals[0].id,{approved:true,answer:'Markdown'});
  const result = await settled(f.runner,run.id); assert.equal(result.status,'completed'); assert.equal(result.tasks[0].id,'b');
});

test('Pi runtime performs an actual streamed tool call against an OpenAI-compatible endpoint', async t => {
  let requests = 0;
  const upstream = http.createServer(async (req,res) => {
    const chunks = []; for await (const b of req) chunks.push(b);
    const payload = JSON.parse(Buffer.concat(chunks));
    assert.equal(req.url,'/v1/chat/completions'); assert.equal(req.headers.authorization,'Bearer test-key');
    assert.ok(payload.tools.some(t => t.function.name === 'write_file'));
    requests++; res.writeHead(200,{'Content-Type':'text/event-stream'});
    const chunk = (delta,finish_reason=null) => res.write(`data: ${JSON.stringify({id:'completion-'+requests,object:'chat.completion.chunk',created:1,model:'mock',choices:[{index:0,delta,finish_reason}]})}\n\n`);
    if (requests === 1) {
      chunk({role:'assistant',tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'hello.txt',content:'Actual tool output'})}}]});
      chunk({},'tool_calls');
    } else { assert.ok(payload.messages.some(m => m.role === 'tool')); chunk({role:'assistant',content:'已交付 hello.txt。没有运行测试。'}); chunk({},'stop'); }
    res.write(`data: ${JSON.stringify({choices:[],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}})}\n\ndata: [DONE]\n\n`); res.end();
  });
  upstream.listen(0,'127.0.0.1'); await once(upstream,'listening');
  const dir = await fs.mkdtemp(path.join(tempRoot,'piagent-worker-')); t.after(async () => { await new Promise(r => upstream.close(r)); await cleanup(dir); });
  const artifacts = [], events = [];
  const output = await executeWorker({worker:{id:'mock',name:'Mock',model:'mock',baseUrl:`http://127.0.0.1:${upstream.address().port}/v1`,apiKeyEnv:'MOCK_API_KEY',contextWindow:32000,maxTokens:2048}, apiKey:'test-key', task:task('a',[],'mock'), run:{prompt:'Write hello',projectPath:dir,tasks:[],artifacts:[],messages:[]},workDir:dir,policy:{maxWorkerTurns:5},signal:new AbortController().signal,onEvent:ev=>events.push(ev),authorize:async()=>{throw new Error('Unexpected command');},artifact:a=>artifacts.push(a),readDependency:async()=>'',beforeRequest:()=>{}});
  assert.match(output,/hello.txt/); assert.equal(requests,2); assert.equal(await readText(dir,'hello.txt'),'Actual tool output'); assert.equal(artifacts.length,1);
  assert.ok(events.some(ev => ev.type === 'tool' && ev.text === 'write_file')); assert.equal(events.filter(ev=>ev.type==='usage').reduce((n,ev)=>n+ev.usage.input,0),200);
});

test('local HTTP app rejects cross-origin writes and DNS rebinding; demo persists real artifacts', async t => {
  const dir = await fs.mkdtemp(path.join(tempRoot,'piagent-http-')), app = await createApp({dataDir:dir,appRoot});
  app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
  t.after(async () => { await app.close(); await cleanup(dir); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const state = await (await fetch(base+'/api/state')).json(); assert.ok(state.config); assert.equal(state.runs.length,0);
  assert.equal((await fetch(base+'/api/runs',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json','X-PIagent':'1'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const rebound = await new Promise((resolve,reject) => { const req = http.get(base+'/api/state',{headers:{Host:'evil.example'}},res => {res.resume();resolve(res.statusCode);}); req.on('error',reject); });
  assert.equal(rebound,403);
  const response = await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json','X-PIagent':'1'},body:JSON.stringify({prompt:'Demo task',projectPath:appRoot,demo:true})});
  assert.equal(response.status,201); const run = await response.json(); const result = await settled(app.runner,run.id);
  assert.equal(result.status,'completed'); assert.equal(result.artifacts.length,3); assert.equal(result.usage.input,0);
  const artifact = result.artifacts[0]; const file = await (await fetch(`${base}/api/runs/${run.id}/artifact?taskId=${artifact.taskId}&path=${artifact.path}`)).json(); assert.match(file.content,/没有调用真实模型/);
  const bad = await fetch(`${base}/api/runs/${run.id}/artifact?taskId=..&path=secrets.json`); assert.equal(bad.status,404);
});

test('crash recovery expires approvals and preserves completed dependencies', async t => {
  const f = await fixture(t);
  f.store.save({id:'crash',status:'waiting_confirmation',tasks:[{id:'a',status:'completed'},{id:'b',status:'running'}],approvals:[{id:'approval',status:'pending'}]});
  f.store.recover(); const run = f.store.get('crash');
  assert.equal(run.status,'interrupted'); assert.equal(run.tasks[0].status,'completed'); assert.equal(run.tasks[1].status,'interrupted'); assert.equal(run.approvals[0].status,'expired');
});

test('Codex adapter accepts successful completion after transient errors, validates schema, and requires subscription auth', async t => {
  const dir = await fs.mkdtemp(path.join(tempRoot,'piagent-codex-')); t.after(() => cleanup(dir));
  const base = {config:{binary:'codex',model:'',transport:'https',timeoutMs:10000},prompt:'Check',schema:riskSchema,cwd:dir,dataDir:dir,signal:new AbortController().signal,checkLogin:async()=>({code:0,output:'Logged in using ChatGPT'})};
  let capturedArgs;
  const makeProcess = events => (_binary,args,options) => {
    capturedArgs = args; assert.equal(options.shell,false); assert.equal(options.env.CODEX_API_KEY,undefined);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
    setImmediate(() => { for (const event of events) child.stdout.write(JSON.stringify(event)+'\n'); child.stdout.end(); setImmediate(()=>child.emit('close',0)); }); return child;
  };
  const value = await codexRequest({...base,spawnProcess:makeProcess([{type:'error',message:'Reconnecting... 1/5'}, {type:'item.completed',item:{type:'agent_message',text:JSON.stringify({decision:'ask',reason:'Verified'})}},{type:'turn.completed',usage:{input_tokens:30,output_tokens:5}}])});
  assert.equal(value.reason,'Verified'); assert.ok(capturedArgs.includes('model_provider="piagent_chatgpt"')); assert.ok(capturedArgs.includes('model_providers.piagent_chatgpt.supports_websockets=false'));
  await assert.rejects(codexRequest({...base,spawnProcess:makeProcess([{type:'item.completed',item:{type:'agent_message',text:'{}'}},{type:'turn.completed'}])}),/无效/);
  await assert.rejects(codexRequest({...base,spawnProcess:makeProcess([{type:'turn.failed',error:{message:'Quota exhausted'}}])}),/Quota/);
  await assert.rejects(codexRequest({...base,checkLogin:async()=>({code:0,output:'Logged in using API key'}),spawnProcess:()=>{throw new Error('Must not launch');}}),/订阅登录/);
});
