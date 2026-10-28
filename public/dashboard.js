export function createDashboard(ui) {
  const {state,e,icon,status,num,time}=ui;
  const modes={auto:'自动分配',review:'先规划 · 我来指定',manual:'我拆任务 · 我指定'};
  const active=s=>['queued','planning','executing','reviewing','waiting_confirmation','waiting_assignment'].includes(s);
  const cfg=run=>run?.config || state.config;
  const workflow=run=>run?.workflow || state.draftWorkflow || state.config.workflow;
  const connection=(run,id)=>cfg(run).connections.find(c=>c.id===id) || state.config.connections.find(c=>c.id===id);
  const name=(run,id)=>connection(run,id)?.name || id || '协作引擎';
  const kind=c=>c?.kind==='subscription-cli'?'订阅 CLI':c?.kind==='coding-plan'?'Coding Plan':'API';
  const roles={planner:'规划',reviewer:'审计',riskReviewer:'风险判断',worker:'执行'};
  const titles={plan:'生成任务计划',artifact:'保存产物',audit:'结果审计',approval:'请求确认',approval_resolved:'确认已处理',revision:'安排返工',assignment:'更新分工',worker_error:'执行出错',model_idle:'模型调用结束'};
  const eventKinds={handoff:'handoff',artifact:'artifact',audit:'audit',approval:'approval',worker_error:'error',tool_result:'tool'};
  const colors=new Map();
  function color(run) { if(!run)return 0; if(!colors.has(run.id))colors.set(run.id,colors.size%4); return colors.get(run.id); }
  function eventLabel(ev,run) {
    if(ev.type==='artifact')return ev.artifact?.path || '保存产物';
    if(ev.type==='audit')return '审计'+({pass:'通过',revise:'需返工',ask:'待确认'}[ev.audit?.verdict] || '完成');
    if(ev.type==='approval')return ev.approval?.title || '等待你的确认';
    if(ev.type==='plan')return `计划 · ${ev.plan?.tasks?.length || run.tasks.length} 个任务`;
    if(ev.type==='tool_result')return `${ev.isError?'失败':'完成'} · ${ev.text || '工具调用'}`;
    return ev.text || titles[ev.type] || ev.type;
  }
  function chip(run,id,role) {
    const c=connection(run,id),working=run?.activeCalls?.some(call=>call.connectionId===id && call.role===role) || (role==='worker' && run?.tasks.some(t=>t.worker===id && t.status==='running'));
    const done=role==='worker'?run?.tasks.some(t=>t.worker===id && t.status==='completed'):(run?.roleCallCounts?.[role]||0)>0 && !working;
    return `<button class="chain-chip ${working?'working':''}" data-action="${run?'select':'workflow'}" ${run?`data-id="${e(run.id)}"`:''} title="${e(roles[role])} · ${e(c?.model || kind(c))}"><span class="model-glyph">${e((c?.name || '?').slice(0,1))}</span><span>${e(c?.name || id)}</span>${working?'<span class="pulse-dot"></span>':done?icon('check'):''}</button>`;
  }
  function chain(run) {
    const w=workflow(run),workers=[...new Set(run?.tasks.length?run.tasks.map(t=>t.worker):w.workerPool)];
    return `<div class="chain-row lane-color-${color(run)} ${run?.id===state.selected?'current':''}"><button class="chain-title" title="${e(run?.title || '新协作任务')}" data-action="${run?'select':'workflow'}" ${run?`data-id="${e(run.id)}"`:''}><span class="lane-dot"></span><span>${e(run?.title || '新协作任务')}</span></button><div class="chain-steps">${w.assignmentMode==='manual'?'<span class="chain-user">你指定</span>':chip(run,w.planner,'planner')}${icon('arrow')}<div class="chain-workers">${workers.slice(0,3).map(id=>chip(run,id,'worker')).join('')}${workers.length>3?`<span class="chain-more">+${workers.length-3}</span>`:''}</div>${icon('arrow')}${chip(run,w.reviewer,'reviewer')}${run?.approvals.some(a=>a.status==='pending')?`${icon('arrow')}<span class="chain-user attention">等你确认</span>`:''}</div></div>`;
  }
  function flow(run) {
    const rows=run?[run,...state.runs.filter(r=>r.id!==run.id && active(r.status)).slice(0,2)]:[null,...state.runs.filter(r=>active(r.status)).slice(0,2)];
    return `<section class="chain-board" aria-label="模型协作流程"><div class="board-heading"><span>${icon('network')}协作编排</span><button data-action="workflow">${run&&!active(run.status)?'下轮 · ':''}${e(modes[(run&&active(run.status)?workflow(run):state.draftWorkflow||state.config.workflow).assignmentMode])}${icon('settings')}</button></div>${rows.map(r=>chain(r)).join('')}<div class="board-caption">${run?.demo?'演示模式 · 模型响应为模拟数据':'规划、执行与审计可自由组合'}<span>任务、文件与上下文自动交接</span></div></section>`;
  }
  function stats(run) {
    const done=run?.tasks.filter(t=>t.status==='completed').length || 0,total=run?.tasks.length || 0;
    return `<span>${done}/${total} 任务</span><span>${num((run?.usage?.input || 0)+(run?.usage?.output || 0))} tokens${run?.demo?' · 模拟':''}</span>`;
  }
  function assignment(run) {
    const w=run&&active(run.status)?workflow(run):state.draftWorkflow||state.config.workflow;
    return `<div class="workflow-summary"><span>${icon('network')}${run&&!active(run.status)?'下轮设置 · ':''}${e(modes[w.assignmentMode])}</span><span>规划 ${w.assignmentMode==='manual'?'由你拆解':e(name(run,w.planner))}</span><span>审计 ${e(name(run,w.reviewer))}</span><button data-action="workflow">${run&&active(run.status)?'查看分工':run?'设置下轮分工':'设置本轮分工'}${icon('chevron')}</button></div>`;
  }
  function assignmentNotice(run) {
    if(run?.status!=='waiting_assignment')return '';
    return `<div class="approval-box"><b>${icon('network')}计划已生成，等待你的分工</b><p>打开任务页逐项选择模型，或编辑完整计划。你指定的模型会被锁定。</p><button class="primary" data-action="confirm-assignment" ${state.assignmentSaving?'disabled':''}>${icon('play')}按当前分工开始</button><button class="secondary" data-action="edit-plan" ${state.assignmentSaving?'disabled':''}>编辑完整计划</button><button class="text-button" data-action="tab" data-id="tasks">查看任务 ${icon('arrow')}</button></div>`;
  }
  function tasks(run) {
    if(!run?.tasks.length)return `<div class="empty-box">${icon('network')}<h3>${run?.status==='planning'?'正在拆解任务':'按你的方式分工'}</h3><p>可以让规划模型分配，也可以固定部分任务，或直接指定每个任务的执行者。</p><button class="secondary" data-action="workflow">${icon('settings')}设置本轮分工</button></div>`;
    const mutable=active(run.status);
    return `${run.audit?`<div class="audit-box"><b>${icon('shield')}${e(name(run,run.workflow.reviewer))} · 审计${e({pass:'通过',revise:'需要返工',ask:'需要确认'}[run.audit.verdict])}</b><p>${e(run.audit.summary)}</p></div>`:''}${run.tasks.map((t,i)=>`<article class="task-card ${e(t.status)}"><button class="task-heading-button" data-action="expand" data-id="${e(t.id)}" aria-expanded="${state.expanded.has(t.id)}"><div class="task-heading"><span class="task-index">${String(i+1).padStart(2,'0')}</span><h3>${e(t.title)}</h3></div>${status(t.status)}</button><div class="task-meta"><span>${icon('layers')}${e(name(run,t.worker))}</span><span>${icon('network')}${t.dependsOn.length?'依赖 '+t.dependsOn.map(e).join(', '):'可独立执行'}</span><span>${t.pinned?(t.assignmentSource?.startsWith('rule:')?'规则指定 · 已锁定':'你指定 · 已锁定'):'规划模型分配'}</span><span>${t.attempts} 次执行</span></div>${mutable && t.status==='pending'?`<div class="task-controls" data-task-id="${e(t.id)}"><label>指定执行模型<select data-assign-worker="${e(t.id)}" aria-label="${e(t.title)} 的执行模型">${cfg(run).connections.filter(c=>c.enabled).map(c=>`<option value="${e(c.id)}" ${c.id===t.worker?'selected':''}>${e(c.name)} · ${e(kind(c))}</option>`).join('')}</select></label><label class="check-option"><input type="checkbox" data-assign-fallback="${e(t.id)}" ${t.allowFallback?'checked':''}>允许备用模型</label></div>`:''}${state.expanded.has(t.id)?`<div class="task-expand"><p>${e(t.instructions)}</p><ul>${t.acceptance.map(a=>`<li>${e(a)}</li>`).join('')}</ul>${t.error?`<p class="danger">${e(t.error)}</p>`:''}${t.result?`<pre>${e(t.result)}</pre>`:''}</div>`:''}</article>`).join('')}`;
  }
  function conversation(run) {
    if(!run)return `<div class="welcome"><div class="welcome-kicker"><span class="tiny-mark">π</span> YOUR MODELS. ONE WORKSPACE.</div><h1>一个目标，<br>让合适的模型一起完成。</h1><p>你来决定谁规划、谁执行、谁审计。<br>模型之间自动传递任务和成果，你只在需要时介入。</p><div class="welcome-actions"><button class="secondary" data-action="workflow">${icon('network')}设置本轮分工${icon('arrow')}</button><button class="text-button" data-action="demo">${icon('play')}体验协作演示</button></div><div class="welcome-guide"><div><span>01</span><b>选好你的团队</b><small>API、Coding Plan、订阅 CLI</small></div><div><span>02</span><b>决定怎么分工</b><small>自动规划 / 你来指定</small></div><div><span>03</span><b>看见协作过程</b><small>任务、交接、审计实时可见</small></div></div><div class="sample-label">试着从这里开始</div><button class="sample" data-action="sample" data-index="0">${icon('code')}分析项目结构，输出改进与审计报告${icon('arrow')}</button><button class="sample" data-action="sample" data-index="1">${icon('file')}实现 CSV 清洗工具，并审计边界情况${icon('arrow')}</button></div>`;
    const entries=run.messages.map((m,i)=>({at:m.at,id:`message-${m.id||i}`,message:m}));
    const events=state.events[run.id] || [];
    for(const ev of events)if(['handoff','tool','tool_result','artifact','revision','assignment'].includes(ev.type))entries.push({at:ev.at,id:`conversation-event-${ev.seq}`,event:ev});
    entries.sort((a,b)=>new Date(a.at)-new Date(b.at));
    return `<div class="conversation-start"><span>${run.demo?'模拟协作记录':'协作记录'} · ${new Date(run.createdAt).toLocaleDateString('zh-CN')}</span><span>所有交接保存在本机</span></div>${entries.map(item=>{
      if(item.message){const m=item.message,actor=m.role==='user'?'你':m.actor?name(run,m.actor):m.role==='supervisor'?name(run,run.workflow.reviewer):'协作引擎';return `<article class="chat-message ${e(m.role)}" id="${e(item.id)}"><div class="message-author"><span class="message-avatar">${e(m.role==='user'?'你':actor.slice(0,1))}</span><b>${e(actor)}</b><time>${time(m.at)}</time>${m.role==='user'?'<span class="message-role">目标 / 补充</span>':''}</div><div class="message-text">${e(m.text)}</div></article>`;}
      const ev=item.event,label=eventLabel(ev,run),details=ev.args?JSON.stringify(ev.args,null,2):ev.result;
      return `<details class="inline-event ${e(eventKinds[ev.type] || 'tool')}" id="${e(item.id)}" data-detail-key="${e(item.id)}" ${state.openDetails.has(item.id)?'open':''}><summary><span class="event-symbol">${icon(ev.type==='handoff'?'layers':ev.type==='artifact'?'file':'code')}</span><b>${e(label)}</b><small>${e(ev.actor?name(run,ev.actor):'协作引擎')}</small><time>${time(ev.at)}</time>${icon('chevron')}</summary><div class="inline-event-body">${ev.taskId?`<span>任务 ${e(ev.taskId)}</span>`:''}${details?`<pre>${e(typeof details==='string'?details:JSON.stringify(details,null,2))}</pre>`:`<p>${e(label)}</p>`}${ev.type==='artifact'?'<button class="text-button" data-action="tab" data-id="artifacts">查看交付物 '+icon('arrow')+'</button>':''}</div></details>`;
    }).join('')}${active(run.status)?`<div class="chat-activity"><span class="pulse-dot"></span>${e({planning:`${name(run,run.workflow.planner)} 正在规划`,executing:'执行模型正在处理任务',reviewing:`${name(run,run.workflow.reviewer)} 正在审计`,waiting_confirmation:'等待你的确认',waiting_assignment:'等待你指定执行模型',queued:'准备开始协作'}[run.status])}<span>右侧查看实时轨迹</span></div>`:`<div class="conversation-end">${status(run.status)}<span>${run.artifacts.length} 个交付物 · 可继续发送新要求</span></div>`}`;
  }
  function composer(run) {
    const next=run&&active(run.status)?workflow(run):state.draftWorkflow||state.config.workflow;
    return `<div class="chat-composer"><form id="composer"><div class="composer-box"><textarea id="prompt-input" placeholder="${run&&active(run.status)?'补充要求，模型会接着处理…':run?'继续这个任务，或提出新的要求…':'描述目标，交给你的模型团队…'}" aria-label="任务描述" maxlength="20000">${e(state.draft)}</textarea><div class="composer-tools"><div class="composer-options"><button type="button" data-action="path" title="${e(state.projectPath)}">${icon('folder')}<span>${e(state.projectPath.split(/[\\/]/).filter(Boolean).at(-1) || '项目目录')}</span></button><button type="button" data-action="workflow">${icon('network')}<span>${run&&!active(run.status)?'下轮 · ':''}${e(modes[next.assignmentMode])}</span>${icon('chevron')}</button></div><button class="send-btn" type="submit" title="发送 · Ctrl+Enter" ${state.sending?'disabled':''}>${icon('up')}</button></div></div></form><div class="composer-note"><span>${run?.demo?'演示模式 · 模拟模型响应':'本地运行 · API 与订阅协作'}</span><span>Ctrl + Enter 发送</span></div></div>`;
  }
  function laneRuns() {
    if(state.railScope==='current')return state.runs.filter(r=>r.id===state.selected);
    const candidates=[...state.runs.filter(r=>r.id===state.selected),...state.runs.filter(r=>active(r.status)),...state.runs];
    return [...new Map(candidates.map(r=>[r.id,r])).values()].slice(0,4);
  }
  function lanes() {
    const runs=laneRuns();
    const laneEvents=run=>(state.events[run.id] || []).filter(ev=>['plan','handoff','tool_result','artifact','audit','approval','worker_error','revision','assignment'].includes(ev.type));
    return `<aside class="monitor-panel" aria-label="实时协作监视器"><header class="monitor-head"><h2>${icon('activity')}工作轨迹 · 泳道</h2><small>${state.runs.filter(r=>active(r.status)).length} 条运行中</small></header><div class="monitor-toolbar"><div class="segmented"><button data-action="rail-scope" data-id="all" class="${state.railScope==='all'?'active':''}">全部任务</button><button data-action="rail-scope" data-id="current" class="${state.railScope==='current'?'active':''}">当前任务</button></div><span>实时事件</span></div><div class="swimlane-scroll"><div class="swimlanes ${runs.length===1?'single-lane':''}">${runs.map(run=>{
      const events=laneEvents(run),done=run.tasks.filter(t=>t.status==='completed').length,calls=(run.activeCalls || []).map(c=>name(run,c.connectionId)),working=run.tasks.filter(t=>t.status==='running').map(t=>name(run,t.worker)),who=[...new Set([...calls,...working])];
      return `<section class="swimlane lane-color-${color(run)} ${run.id===state.selected?'selected':''}"><button class="lane-heading" data-action="select" data-id="${e(run.id)}"><b><span class="lane-dot"></span>${e(run.title)}</b><span>${e(who.join(' / ') || (active(run.status)?'等待调度':'本轮结束'))}</span><progress max="${run.tasks.length||1}" value="${done}"></progress><small>${done}/${run.tasks.length} · ${e(run.demo?'演示':'真实任务')}</small></button><div class="lane-track">${events.length?events.slice(-12).map(ev=>`<button class="lane-event ${e(eventKinds[ev.type] || 'tool')} ${ev.isError?'error':''} ${state.eventFocus?.runId===run.id && state.eventFocus.seq===ev.seq?'focused':''}" data-action="event-focus" data-id="${e(run.id)}" data-seq="${ev.seq}" title="${e(eventLabel(ev,run))}"><span class="track-node"></span><b>${e(eventLabel(ev,run))}</b><small>${e(ev.actor?name(run,ev.actor):'协作引擎')}</small><time>${time(ev.at).slice(0,5)}</time></button>`).join(''):`<div class="lane-empty">${state.events[run.id]?'等待执行记录':'读取记录中…'}</div>`}<div class="lane-current">${active(run.status)?'<span class="pulse-dot"></span>':icon(run.status==='completed'?'check':'clock')}${status(run.status)}</div></div></section>`;
    }).join('')}</div>${runs.length?'':`<div class="monitor-empty">${icon('network')}<b>协作发生时，轨迹在这里生长</b><p>每条任务一条泳道。<br>交接、工具调用和交付物实时更新。</p><span>01 规划　→　02 执行　→　03 审计</span></div>`}</div><div class="model-roster"><div class="roster-heading"><span>模型此刻</span><button data-action="settings">管理连接 ${icon('chevron')}</button></div>${state.config.connections.filter(c=>c.enabled).map(c=>{
      const actions=state.runs.filter(r=>active(r.status)).flatMap(r=>[...(r.activeCalls||[]).filter(call=>call.connectionId===c.id).map(call=>roles[call.role] || call.stage),...r.tasks.filter(t=>t.worker===c.id && t.status==='running').map(t=>'执行 · '+t.title)]),live=actions.length>0;
      return `<div class="roster-model ${live?'live':''}"><span class="model-glyph">${e(c.name.slice(0,1))}</span><b>${e(c.name)}<small>${e(kind(c))}</small></b><span class="roster-state" title="${e(actions.join(' / '))}">${live?'<span class="pulse-dot"></span>':''}${e(actions.join(' / ') || (c.kind==='subscription-cli' || c.configured?'待命':'待配置'))}</span></div>`;
    }).join('')}</div><footer class="event-legend"><span><i class="legend-node"></i>执行</span><span><i class="legend-node diamond"></i>模型交接</span><span>${icon('file')}产物</span><span>${icon('shield')}审计</span><span><i class="legend-node waiting"></i>等待确认</span></footer></aside>`;
  }
  return {stats,flow,tasks,assignment,assignmentNotice,conversation,composer,lanes,laneRuns};
}




