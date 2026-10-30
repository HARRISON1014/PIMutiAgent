import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {snapshotOf,reviewScope,groupRevisions,reflectionReasons} from '../server/audit.js';
import {createConfig} from '../server/config.js';
import {Store} from '../server/store.js';
import {Orchestrator} from '../server/orchestrator.js';
import {writeText} from '../server/files.js';
const pass={verdict:'pass',summary:'已根据证据验收',questions:[],revisions:[]};
const revise=(key,instructions='最小修复',evidence='新改动中的实际缺陷')=>({verdict:'revise',summary:'修复阻塞验收的问题',questions:[],revisions:[{taskId:'a',issueKey:key,instructions,evidence,rationale:'影响明确的验收标准'}]});
const task=id=>({id,title:id,worker:'kimi',dependsOn:[],instructions:'交付文件',acceptance:['产物正确']});
const root=path.resolve(import.meta.dirname,'..'),base=path.join(root,'.piagent','tests');
async function fixture(t,supervisor,worker){
  await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'audit-policy-')),project=path.join(dir,'project');await fs.mkdir(project);
  const config=createConfig(root,dir),cfg=config.get();cfg.policy.maxRevisions=5;cfg.connections.filter(c=>c.kind==='api').forEach(c=>c.model='mock');config.save({...cfg,keys:{MOONSHOT_API_KEY:'mock-audit-key'}});
  const store=new Store(dir),runner=new Orchestrator({store,config,dataDir:dir,supervisor,worker});
  t.after(async()=>{await runner.shutdown();store.close();const relative=path.relative(base,dir);assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));await fs.rm(dir,{recursive:true,force:true});});return{runner,store,project};
}
test('incremental scope excludes unchanged files and reports additions, modifications and removals',()=>{
  const old=snapshotOf([{taskId:'a',path:'a.txt',content:'one\ntwo\nthree'},{taskId:'b',path:'stable.txt',content:'OLD_STABLE_CONTENT'},{taskId:'a',path:'deleted.txt',content:'old'}],[]);
  const now=snapshotOf([{taskId:'a',path:'a.txt',content:'one\nnew\nthree'},{taskId:'b',path:'stable.txt',content:'OLD_STABLE_CONTENT'},{taskId:'a',path:'new.txt',content:'added'}],[]);
  const scope=reviewScope(old,now);assert.equal(scope.mode,'incremental');assert.equal(scope.unchangedFileCount,1);assert.deepEqual(scope.files.map(f=>f.change),['modified','added','deleted']);assert.doesNotMatch(JSON.stringify(scope),/OLD_STABLE_CONTENT/);assert.equal(scope.files[0].diff.removed,'two');assert.equal(scope.files[0].diff.added,'new');
});
test('same-category findings are grouped once with all observed locations',()=>{
  const a=revise('input-validation');a.revisions.push({...a.revisions[0],instructions:'另一个位置的同类修复',evidence:'第二处实际位置'});a.revisions.push({...a.revisions[0]});
  const grouped=groupRevisions(a);assert.equal(grouped.revisions.length,1);assert.match(grouped.revisions[0].evidence,/第二处/);assert.equal(grouped.revisions[0].instructions.split('最小修复').length-1,1);
});
test('reflection threshold is per affected task and includes downstream rework',()=>{
  const run={revision:4,tasks:[{...task('a'),auditRevisions:0},{...task('b'),auditRevisions:3}],auditHistory:[]};assert.equal(reflectionReasons(run,revise('new')).length,0);
  run.tasks[1].dependsOn=['a'];assert.match(reflectionReasons(run,revise('new')).join(''),/三轮/);
});
test('fourth proposed rework pauses for reflection before any extra worker execution and persists history',async t=>{
  let reviews=0,writes=0,reflections=0;
  const f=await fixture(t,async({prompt})=>{
    if(prompt.includes('现在必须先复盘')){reflections++;assert.equal(writes,4);return {...pass,summary:'复盘确认此前意见属于审计误判，撤回无效建议；现有证据满足验收。'};}
    reviews++;assert.match(prompt,/内置审计规则/);if(reviews>1){assert.match(prompt,/"mode":"incremental"/);assert.match(prompt,/"diff"/);}return revise('issue-'+reviews);
  },async({workDir,artifact})=>{writes++;artifact(await writeText(workDir,'output.txt','version '+writes));return '交付版本 '+writes;});
  const run=await f.runner.create({prompt:'Build',projectPath:f.project,workflow:{assignmentMode:'manual'},manualTasks:[task('a')]});await f.runner.live.get(run.id)?.promise;
  const result=f.runner.get(run.id);assert.equal(result.status,'completed');assert.equal(writes,4);assert.equal(reflections,1);assert.equal(result.tasks[0].auditRevisions,3);assert.equal(result.auditHistory.at(-1).phase,'reflection');assert.equal(f.store.get(run.id).auditBaseline.files.length,1);
});
test('repeated issue requires reflection and identical advice is stopped rather than reissued',async t=>{
  let writes=0,reflections=0;
  const f=await fixture(t,async({prompt})=>{if(prompt.includes('现在必须先复盘')){reflections++;return revise('same-issue','最小 修复。','新改动中的实际 缺陷。');}return revise('same-issue');},async({workDir,artifact})=>{writes++;artifact(await writeText(workDir,'output.txt','version '+writes));return '已尝试修复 '+writes;});
  const run=await f.runner.create({prompt:'Build',projectPath:f.project,workflow:{assignmentMode:'manual'},manualTasks:[task('a')]});await f.runner.live.get(run.id)?.promise;
  assert.equal(f.runner.get(run.id).status,'failed');assert.equal(writes,2);assert.equal(reflections,1);assert.match(f.runner.get(run.id).error,/停止自动返工/);
});
test('reflection may continue only with an evidence-backed corrected fix while keeping the executor',async t=>{
  let reviews=0,writes=0;
  const f=await fixture(t,async({prompt})=>{
    if(prompt.includes('现在必须先复盘'))return revise('same-issue','改用经验证的最小修复方案','版本 2 的新证据确认问题尚未解决');
    return ++reviews<3?revise('same-issue'):pass;
  },async({task:current,workDir,artifact})=>{writes++;if(writes===3){assert.match(current.instructions,/经验证/);assert.doesNotMatch(current.instructions,/审计返工：最小修复/);}artifact(await writeText(workDir,'output.txt','version '+writes));return '交付 '+writes;});
  const run=await f.runner.create({prompt:'Build',projectPath:f.project,workflow:{assignmentMode:'manual'},manualTasks:[task('a')]});await f.runner.live.get(run.id)?.promise;
  assert.equal(f.runner.get(run.id).status,'completed');assert.equal(writes,3);assert.equal(f.runner.get(run.id).tasks[0].worker,'kimi');
});

test('audit findings require a stable identity, evidence and acceptance rationale',async()=>{
  const {auditSchema}=await import('../server/schema.js');
  assert.throws(()=>auditSchema.parse({verdict:'revise',summary:'fix',questions:[],revisions:[{taskId:'a',instructions:'Optional improvement'}]}));
  assert.equal(auditSchema.parse(revise('valid')).revisions[0].issueKey,'valid');
});
