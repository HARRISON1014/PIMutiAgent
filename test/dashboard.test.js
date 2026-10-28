import test from 'node:test';
import assert from 'node:assert/strict';
import {createDashboard} from '../public/dashboard.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture() {
  const connections=[{id:'a',name:'Planner A',kind:'subscription-cli',enabled:true},{id:'b',name:'Worker B',kind:'api',enabled:true},{id:'c',name:'Auditor C',kind:'api',enabled:true}];
  const workflow={planner:'a',reviewer:'c',riskReviewer:'a',defaultWorker:'b',workerPool:['b'],assignmentMode:'auto',rules:[]};
  const config={connections,workflow,policy:{concurrency:2}};
  const state={config,runs:[],draftWorkflow:structuredClone(workflow),events:{},expanded:new Set(),openDetails:new Set(),railScope:'all'};
  const run={id:'run-1',title:'Example',status:'completed',demo:false,createdAt:'2026-10-29T00:00:00Z',config,workflow:structuredClone(workflow),tasks:[],activeCalls:[],roleCallCounts:{},approvals:[],artifacts:[],messages:[],usage:{input:0,output:0,byProvider:{}}};
  const dashboard=createDashboard({state,e:escape,icon:name=>`<svg data-icon="${name}"></svg>`,status:s=>`<span>${s}</span>`,num:n=>String(n),time:()=> '08:00:00'});
  return {state,run,dashboard};
}
test('manual workflow skips planner and keeps the user selected executor',()=>{
  const {state,run,dashboard}=fixture();run.workflow.assignmentMode='manual';run.tasks=[{worker:'c',status:'completed'}];state.runs=[run];
  const html=dashboard.flow(run);
  assert.match(html,/你指定/);assert.doesNotMatch(html,/title="规划/);assert.match(html,/title="执行 · API"/);assert.doesNotMatch(html,/Worker B/);
});
test('monitor prioritizes active and selected runs within its four lane limit',()=>{
  const {state,run,dashboard}=fixture();state.runs=Array.from({length:7},(_,i)=>({...run,id:`run-${i}`,status:i===1?'executing':'completed'}));state.selected='run-6';
  assert.deepEqual(dashboard.laneRuns().map(r=>r.id),['run-6','run-1','run-0','run-2']);
  state.runs.forEach(r=>r.status='executing');assert.ok(dashboard.laneRuns().some(r=>r.id==='run-6'));
  state.railScope='current';assert.deepEqual(dashboard.laneRuns().map(r=>r.id),['run-6']);
});
test('model output and tool arguments are escaped in conversation and swimlanes',()=>{
  const {state,run,dashboard}=fixture();run.title='<script>run</script>';run.messages=[{id:'m1',at:run.createdAt,role:'user',text:'<img src=x onerror=alert(1)>'}];
  state.runs=[run];state.events[run.id]=[{seq:1,at:run.createdAt,type:'tool',text:'<unsafe>',args:{path:'<secret>'}},{seq:2,at:run.createdAt,type:'handoff',text:'<img src=x>'}];
  const chat=dashboard.conversation(run),lanes=dashboard.lanes();
  assert.doesNotMatch(chat,/<img/);assert.match(chat,/&lt;img/);assert.match(chat,/&lt;secret&gt;/);assert.doesNotMatch(lanes,/<script>/);assert.match(lanes,/&lt;script&gt;/);
});
test('monitor reports actual active roles and does not invent completed calls',()=>{
  const {state,run,dashboard}=fixture();run.status='reviewing';run.activeCalls=[{connectionId:'c',role:'reviewer',stage:'Audit'}];state.runs=[run];
  const flow=dashboard.flow(run),lanes=dashboard.lanes();
  assert.match(flow,/chain-chip working/);assert.match(lanes,/roster-model live/);assert.match(lanes,/审计/);assert.doesNotMatch(flow,/data-icon="check"/);
});
