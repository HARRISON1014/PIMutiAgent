import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const normalize=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
export const AUDIT_RULES=`内置审计规则（必须遵守）：
1. 只报告有证据、影响用户目标或验收标准的实际缺陷。可选美化、个人偏好、无关重构和未证实的猜测不得阻止通过；不确定时明确说明，不编造测试结论。
2. 首轮完整审核。后续轮次只审核本轮新增/修改/删除内容、改变的任务结果和受这些改动直接影响的依赖；已审核且未变化的内容不得重新挑刺。旧问题确实未修复或被新改动重新引入时，复用原 issueKey，说明具体新证据，不伪装成新问题。
3. 同一任务的同类问题一次列全：统一 issueKey，列明全部已观察到的位置和证据、为何影响验收，以及最小可执行修复。不要一轮指出一处、下一轮再指出同类另一处。
4. revisions 的每条意见应包含稳定 issueKey、evidence 和 rationale。已解决、撤回的意见不得重复提出；不得推翻此前建议却不解释原因。保留用户指定的模型与任务边界。
5. 单个任务已返工三轮、准备进入第四轮及以后时，必须先停止自动修改并做审计复盘：逐条检查历史意见是否正确、是否互相矛盾、是否属于审计误判，重新思考解决思路，撤回无效建议，给出证据支持的最小方案。复盘本身不执行修改。
6. 缺乏证据不等于合格；只对已见证据作结论。确需用户做重要决策才 ask，不得用反复返工代替澄清。`;
export function issueId(revision) {return revision.taskId+':'+hash(normalize(revision.issueKey || revision.instructions));}
export function sameAdvice(a,b) {return normalize(a.instructions)===normalize(b.instructions) && normalize(a.evidence)===normalize(b.evidence);}
export function promptHistory(history) {
  const entries=[];let budget=32000;
  for(const entry of history.slice(-8).reverse()){
    const audit={...entry.audit,summary:entry.audit.summary.slice(0,1000),questions:entry.audit.questions.map(q=>q.slice(0,400)),revisions:entry.audit.revisions.map(r=>({...r,instructions:r.instructions.slice(0,400),evidence:r.evidence?.slice(0,250),rationale:r.rationale?.slice(0,250)}))};
    const item={round:entry.round,phase:entry.phase,audit},size=JSON.stringify(item).length;
    if(size>budget)break;entries.unshift(item);budget-=size;
  }
  return {entries,excerpt:history.length>0};
}
export function groupRevisions(audit) {
  const grouped=new Map(),seen=new Map();
  for(const revision of audit.revisions || []){
    const id=issueId(revision),existing=grouped.get(id);
    if(!existing){grouped.set(id,{...revision});seen.set(id,Object.fromEntries(['instructions','evidence','rationale'].map(key=>[key,new Set([normalize(revision[key])])])));continue;}
    for(const key of ['instructions','evidence','rationale'])if(revision[key] && !seen.get(id)[key].has(normalize(revision[key]))){seen.get(id)[key].add(normalize(revision[key]));existing[key]=[existing[key],revision[key]].filter(Boolean).join('\n').slice(0,key==='instructions'?12000:4000);}
  }
  return {...audit,revisions:[...grouped.values()]};
}
export function affectedTasks(tasks,revisions) {
  const ids=new Set(revisions.map(r=>r.taskId));let size;
  do{size=ids.size;for(const task of tasks)if(task.dependsOn.some(id=>ids.has(id)))ids.add(task.id);}while(ids.size!==size);
  return ids;
}
export function reflectionReasons(run,audit) {
  if(audit.verdict!=='revise')return [];
  const reasons=[],affected=affectedTasks(run.tasks,audit.revisions);
  for(const task of run.tasks)if(affected.has(task.id) && (task.auditRevisions??Math.min(run.revision||0,Math.max(0,(task.attempts||1)-1)))>=3)reasons.push(`任务 ${task.id} 已返工三轮或以上，继续修改前必须重新思考思路`);
  const old=new Set((run.auditHistory||[]).flatMap(entry=>(entry.audit.revisions||[]).map(issueId)));
  if(audit.revisions.some(r=>old.has(issueId(r))))reasons.push('出现历史同类意见，须核实是否确实未解决或重新引入，排除重复及无效建议');
  return reasons;
}
export function snapshotOf(evidence,tasks,commandSeq=0) {
  let remaining=80000;
  const files=evidence.map(file=>{const content=file.content.slice(0,Math.max(0,remaining));remaining-=content.length;return {taskId:file.taskId,path:file.path,key:JSON.stringify([file.taskId,file.path]),hash:file.sha256||hash(file.content),content,truncated:!!file.truncated||content.length<file.content.length};});
  return {files,tasks:tasks.map(t=>({id:t.id,hash:hash({result:t.result,acceptance:t.acceptance}),result:t.result?.slice(0,8000)})),commandSeq};
}
function difference(before,after) {
  const a=before.split('\n'),b=after.split('\n');let first=0,last=0;
  while(first<a.length && first<b.length && a[first]===b[first])first++;
  while(last<a.length-first && last<b.length-first && a[a.length-1-last]===b[b.length-1-last])last++;
  return {startLine:first+1,removed:a.slice(first,a.length-last).join('\n').slice(0,6000),added:b.slice(first,b.length-last).join('\n').slice(0,6000),contextBefore:b.slice(Math.max(0,first-3),first).join('\n'),contextAfter:b.slice(b.length-last,b.length-last+3).join('\n'),excerptOnly:true};
}
export function reviewScope(previous,current) {
  if(!previous)return {mode:'full',files:current.files,changedTasks:current.tasks};
  const old=new Map(previous.files.map(f=>[f.key,f])),now=new Map(current.files.map(f=>[f.key,f])),files=[];
  for(const file of current.files){const before=old.get(file.key);if(!before)files.push({...file,change:'added'});else if(before.hash!==file.hash)files.push({taskId:file.taskId,path:file.path,change:'modified',beforeHash:before.hash,hash:file.hash,truncated:before.truncated||file.truncated,diff:difference(before.content,file.content)});}
  for(const file of previous.files)if(!now.has(file.key))files.push({taskId:file.taskId,path:file.path,change:'deleted',beforeHash:file.hash});
  const oldTasks=new Map(previous.tasks.map(t=>[t.id,t.hash]));
  return {mode:'incremental',files,changedTasks:current.tasks.filter(t=>oldTasks.get(t.id)!==t.hash),unchangedFileCount:current.files.length-files.filter(f=>f.change!=='deleted').length};
}
