import { createSettings } from './settings.js';
import { createDashboard } from './dashboard.js';
import { createSessions } from './sessions.js';
const icons = {
  more:'M5 12h.01M12 12h.01M19 12h.01', archive:'M3 3h18v4H3zM5 7v14h14V7M9 11h6', trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  plus:'M12 5v14M5 12h14', search:'m21 21-5-5M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0', grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  layers:'m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5', settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 2h4l1 3 3 1 3-1 2 4-2 3 1 3-2 4-4-1-2 2h-4l-1-3-3-1-3 1-2-4 2-3-1-3 2-4 4 1z',
  chevron:'m9 5 7 7-7 7', arrow:'M5 12h14m-6-6 6 6-6 6', up:'M12 19V5m-6 6 6-6 6 6', close:'m6 6 12 12M6 18 18 6',
  spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z', network:'M12 8V3M5 17v-5h14v5M12 12V8M2 17h6v5H2zM16 17h6v5h-6zM9 3h6v5H9z',
  check:'m5 12 4 4L19 6', clock:'M12 8v5l3 2M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0', activity:'M2 12h5l3-8 4 16 3-8h5',
  chat:'M21 11a8 8 0 0 1-8 8H5l-4 3V11a8 8 0 0 1 8-8h4a8 8 0 0 1 8 8zM6 9h10M6 13h6', file:'M14 2H5v20h14V7zM14 2v6h5M8 13h8M8 17h6',
  folder:'M2 6h8l2 3h10v12H2zM2 6V3h8l3 3h9v3', bolt:'m13 2-9 12h7l-1 8 10-12h-7z', shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6',
  play:'m8 4 12 8-12 8z', stop:'M5 5h14v14H5z', download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0',
  refresh:'M20 7A9 9 0 0 0 4 5L1 8m0-6v6h6M4 17a9 9 0 0 0 16 2l3-3m0 6v-6h-6', external:'M14 3h7v7M10 14 21 3M10 3H3v18h18v-7', code:'m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18', info:'M12 10v7M12 6h.01M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.activity}"/></svg>`;
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = { queued:'排队中', planning:'规划中', executing:'执行中', running:'执行中', reviewing:'审计中', waiting_confirmation:'等待确认', waiting_assignment:'等待分工', pending:'等待依赖', completed:'已完成', failed:'失败', cancelled:'已取消', interrupted:'已中断', blocked:'受阻', idle:'待命' };
const busy = s => ['queued','planning','executing','reviewing','waiting_confirmation','waiting_assignment'].includes(s);
const status = (s, text = labels[s] || s) => `<span class="status ${e(s)}"><span class="dot"></span>${e(text)}</span>`;
const time = value => new Date(value).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const shortDate = value => new Date(value).toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'});
const num = n => n >= 1000 ? (n/1000).toFixed(1) + 'k' : String(n || 0);
const state = { runs:[], archivedRuns:[], config:null, selected:localStorage.getItem('piagent.selected'), projectPath:localStorage.getItem('piagent.path') || '', tab:'chat', search:'', railScope:'all', monitorHidden:matchMedia('(max-width:700px)').matches, openDetails:new Set(), loadedEvents:new Set(), eventFocus:null, events:{}, expanded:new Set(), answers:{}, draft:'', connected:false, health:null, modal:null, sending:false, draftWorkflow:null, manualTasks:[], catalog:[], supportNotes:[], verification:{},assignmentSaving:0 };
const app = document.querySelector('#app'), modalRoot = document.querySelector('#modal-root');
const configUI = createSettings({state,e,icon,api,toast,openModal,closeModal,refresh,render,selected});
const dashboard = createDashboard({state,e,icon,status,num,time});
const sessions = createSessions({state,e,icon,status,shortDate,api,toast,openModal,closeModal,refreshAfterMutation,render,loadEvents,clearSelection});
let toastTimer, refreshTimer, refreshPromise;
function toast(message, error = false) {
  const node = document.querySelector('#toast'); node.textContent = message; node.className = `visible${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => node.className = '', error ? 6500 : 3500);
}
async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers:{'Content-Type':'application/json','X-PIagent':'1',...options.headers}, body:options.body === undefined ? undefined : JSON.stringify(options.body) });
  const value = await res.json(); if (!res.ok) { const error=new Error(value.error || `请求失败 (${res.status})`);error.status=res.status;throw error; } return value;
}
function selected() { return state.runs.find(r => r.id === state.selected); }
function clearSelection() {
  state.selected=null;localStorage.removeItem('piagent.selected');state.tab='chat';state.draft='';
  state.draftWorkflow=structuredClone(state.config.workflow);state.manualTasks=[];state.eventFocus=null;
}
async function refreshAfterMutation() { if(refreshPromise)try{await refreshPromise;}catch{} await refresh(); }
async function loadEvents(id) {
  if(!id)return;
  try {state.events[id]=await api(`/api/runs/${id}/events`);state.loadedEvents.add(id);}
  catch(error){if(error.status!==404)throw error;delete state.events[id];state.loadedEvents.delete(id);}
}
async function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const value = await api('/api/state'); state.runs = value.runs; state.archivedRuns=value.archivedRuns || []; state.config = value.config; state.verification=value.verification || {}; state.draftWorkflow ||= structuredClone(state.config.workflow);
    if (!state.projectPath) state.projectPath = value.projectPath;
    if (state.selected && !selected()) clearSelection();
    await Promise.all(dashboard.laneRuns().filter(r=>!state.loadedEvents.has(r.id)).map(r=>loadEvents(r.id)));
    render();
    sessions.sync();
  })().finally(() => refreshPromise = null);
  return refreshPromise;
}
function scheduleRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => refresh().catch(err => toast(err.message,true)), 220); }
function renderRecent() {
  const filtered = state.runs.filter(r=>!state.search || `${r.title} ${r.prompt}`.toLowerCase().includes(state.search.toLowerCase()));
  const recentRow = r=>`<div class="recent-entry ${r.id===state.selected?'selected':''}"><button title="${e(r.title)} · ${e(labels[r.status])}" aria-label="${e(r.title)} · ${e(labels[r.status])}" class="recent ${e(r.status)} ${r.id===state.selected?'selected':''}" data-action="select" data-id="${e(r.id)}"><span class="recent-icon">${icon(r.status==='completed'?'check':r.status==='failed'?'info':'chat')}</span><div><b>${e(r.title)}</b><small>${r.demo?'演示 · ':''}${e(labels[r.status])} · ${shortDate(r.createdAt)}</small></div><span class="dot"></span></button><button class="recent-more icon-btn" data-action="manage-session" data-id="${e(r.id)}" title="更多：${e(r.title)}" aria-label="管理会话：${e(r.title)}">${icon('more')}</button></div>`;
  const groups = [['进行中的任务',filtered.filter(r=>busy(r.status))],['最近会话',filtered.filter(r=>!busy(r.status))]];
  return groups.map(([label,runs])=>runs.length?`<div class="section-label">${label}<span>${runs.length}</span></div>${runs.map(recentRow).join('')}`:'').join('')+(!filtered.length?`<div class="recent-empty">${state.search?'没有找到匹配的会话':'从一个目标开始，<br>让不同模型一起完成。'}</div>`:'');
}
function render() {
  if (!state.config) return;
  const focus = document.activeElement?.id, selection = document.activeElement?.selectionStart;
  const oldMain = document.querySelector('.main-scroll'), mainScroll = oldMain?.scrollTop || 0;
  const atBottom = !oldMain || oldMain.scrollHeight-oldMain.scrollTop-oldMain.clientHeight < 100;
  const oldMonitor = document.querySelector('.swimlane-scroll'), monitorScroll = oldMonitor?.scrollTop || 0;
  const monitorBottom = !oldMonitor || oldMonitor.scrollHeight-oldMonitor.scrollTop-oldMonitor.clientHeight < 80;
  const oldRecent = document.querySelector('.recent-list'), recentScroll = oldRecent?.scrollTop || 0;
  const run = selected(), activeRuns = state.runs.filter(r => busy(r.status)).length;
  const viewKey=`${run?.id || 'new'}:${state.tab}`, changedView=state.renderedView!==viewKey;
  state.renderedView=viewKey;
  app.innerHTML = `<div class="shell"><header class="topbar"><button class="brand" data-action="new" aria-label="PIagent 新建任务"><span class="brandmark">π</span><b>PI<span>agent</span></b><span class="version">WORKSPACE</span></button><div class="top-context"><span class="workspace-tag">多模型协作</span><span>任务、对话与交接</span></div><div class="top-actions"><span class="connection ${state.connected?'connected':''}"><span class="dot"></span>${state.connected?'本地引擎在线':'正在重连'}</span><button class="secondary small" data-action="demo">${icon('play')}体验演示</button><button class="primary small" data-action="new">${icon('plus')}新建任务</button><button class="icon-btn archive-shortcut" data-action="archives" title="已归档会话">${icon('archive')}</button><button class="icon-btn" data-action="toggle-monitor" aria-pressed="${!state.monitorHidden}" title="显示或隐藏监视器">${icon('layers')}</button></div></header><div class="workbench ${state.monitorHidden?'monitor-hidden':''}"><aside class="sidebar"><div class="sidebar-search"><div class="search-box">${icon('search')}<input id="session-search" aria-label="搜索会话" placeholder="搜索会话" value="${e(state.search)}"><span>⌕</span></div><button class="icon-btn" data-action="new" title="新建协作任务">${icon('plus')}</button></div><div class="recent-list">${renderRecent()}</div><div class="side-bottom"><button class="nav-item" data-action="archives" title="已归档会话"><span class="nav-archive-icon">${icon('archive')}</span><span>已归档会话</span><small>${state.archivedRuns.length}</small></button><button class="nav-item" data-action="settings">${icon('layers')}<span>模型与连接</span><small>${state.config.connections.filter(c=>c.enabled).length}</small></button><button class="nav-item" data-action="workflow">${icon('network')}<span>角色与分工</span>${icon('chevron')}</button><div class="local-mode"><span class="dot"></span>本地工作空间<span>v0.2</span></div></div></aside><main class="center-pane">${dashboard.flow(run)}<div class="conversation-header"><div class="conversation-title"><span class="title-dot"></span><h2>${e(run?.title || '新协作任务')}</h2>${run?.demo?'<span class="tag demo">演示</span>':''}${run?status(run.status):'<span class="tag">准备就绪</span>'}${run?`<button class="icon-btn session-header-more" data-action="manage-session" data-id="${e(run.id)}" title="管理当前会话">${icon('more')}</button>`:''}</div><div class="conversation-tabs" role="tablist" aria-label="任务视图">${[['chat','对话',null],['tasks','任务',run?.tasks.length||0],['events','记录',state.events[run?.id]?.length||0],['artifacts','产物',run?.artifacts.length||0]].map(([id,label,count])=>`<button role="tab" aria-selected="${state.tab===id}" class="tab ${state.tab===id?'active':''}" data-action="tab" data-id="${id}">${label}${count!==null?`<small>${count}</small>`:''}</button>`).join('')}<div class="view-actions">${run&&busy(run.status)?`<button data-action="cancel" class="text-button danger">${icon('stop')}停止</button>`:run?`<span class="task-fraction">${dashboard.stats(run)}</span>`:'<span class="task-fraction">你决定分工</span>'}</div></div></div><div class="main-scroll ${state.tab==='chat'?'chat-messages':''}">${run?.error?`<div class="error-box"><b>任务${e(labels[run.status])}</b><p>${e(run.error)}</p><button class="secondary" data-action="retry">${icon('refresh')}从中断处继续</button></div>`:''}${(run?.approvals||[]).filter(a=>a.status==='pending').map(renderApproval).join('')}${dashboard.assignmentNotice(run)}${state.tab==='chat'?dashboard.conversation(run):state.tab==='tasks'?dashboard.assignment(run)+renderTasks(run):state.tab==='events'?renderEvents(run):renderArtifacts(run)}</div>${dashboard.composer(run)}</main>${dashboard.lanes()}</div><footer class="statusbar"><div><span class="dot ${activeRuns?'live':''}"></span>${activeRuns} 条任务运行中<span class="statusbar-divider"></span>${state.runs.length} 个会话</div><div><span>PI 驱动</span><span>API + 订阅 CLI</span><span class="statusbar-divider"></span><span>${state.connected?'事件同步正常':'正在恢复连接'}</span></div></footer></div>`;
  const main=document.querySelector('.main-scroll');
  main.scrollTop=changedView?(state.tab==='chat'&&run?main.scrollHeight:0):state.tab==='chat'&&run&&atBottom?main.scrollHeight:mainScroll;
  const monitor=document.querySelector('.swimlane-scroll'); monitor.scrollTop=oldMonitor && activeRuns && monitorBottom?monitor.scrollHeight:monitorScroll;
  document.querySelector('.recent-list').scrollTop=recentScroll;
  if (focus && document.getElementById(focus) && !modalRoot.children.length) {
    const node = document.getElementById(focus); node.focus({preventScroll:true});
    if (typeof selection === 'number' && node.setSelectionRange) node.setSelectionRange(selection, selection);
  }
}
function renderApproval(a) {
  return `<div class="approval-box"><b>${icon('shield')} ${e(a.title)}</b><p>${e(a.detail)}</p>${a.action ? `<pre>${e(JSON.stringify(a.action,null,2))}</pre>` : ''}${a.kind === 'question' ? `<textarea id="answer-${e(a.id)}" placeholder="填写你的判断或补充信息…">${e(state.answers[a.id] || '')}</textarea>` : ''}<button class="primary" data-action="approve" data-id="${e(a.id)}">${icon('check')}${a.kind === 'question' ? '提交答复并继续' : '同意本次命令'}</button><button class="secondary" data-action="deny" data-id="${e(a.id)}">拒绝</button></div>`;
}
function renderTasks(run) { return dashboard.tasks(run); }
function renderEvents(run) {
  const events = (state.events[run?.id] || []).filter(ev => !['usage','output','message','task','approval_resolved'].includes(ev.type)).slice(-100).reverse();
  if (!events.length) return '<div class="empty-box">'+icon('activity')+'<h3>还没有执行事件</h3><p>模型分工、工具调用、交接与审计会按时间记录在这里。</p></div>';
  return `<div class="timeline">${events.map(ev => `<div class="timeline-item ${state.eventFocus?.runId===run.id && state.eventFocus.seq===ev.seq ? 'focused' : ''}" id="event-${ev.seq}"><time>${time(ev.at)}</time><b>${e(ev.actor || '协作引擎')}${ev.taskId ? ' · '+e(ev.taskId) : ''}</b><p>${e(ev.text || ({plan:'规划已生成',artifact:'保存产物：'+ev.artifact?.path,audit:'审计完成：'+ev.audit?.verdict,approval:'等待你的确认',tool:'调用工具',tool_result:'工具执行结果'}[ev.type] || ev.type))}</p>${ev.args || ev.result ? `<details><summary>查看${ev.isError ? '失败' : '执行'}详情</summary><pre>${e(ev.result || JSON.stringify(ev.args,null,2))}</pre></details>` : ''}</div>`).join('')}</div>`;
}
function artifactUrl(run, a) { return `/api/runs/${run.id}/artifact?taskId=${encodeURIComponent(a.taskId)}&path=${encodeURIComponent(a.path)}`; }
function renderArtifacts(run) {
  if (!run?.artifacts.length) return '<div class="empty-box">'+icon('folder')+'<h3>交付物会保存在这里</h3><p>每个任务使用独立输出目录。可以直接预览、下载文件，并查看产物来自哪个任务。</p></div>';
  return `<p class="artifact-note">产物保存在本机的 .piagent/workspaces 目录。源项目保持只读，集成任务负责整理交付文件。${run.demo ? '当前文件均为演示产物。' : ''}</p>${run.artifacts.map((a,i) => `<div class="artifact-card"><div class="artifact-icon">${icon('file')}</div><div><b>${e(a.path)}</b><small>${e(a.taskId)} · ${a.bytes} bytes</small></div><div class="artifact-actions"><button class="icon-btn" data-action="preview" data-index="${i}" title="预览文件">${icon('eye')}</button><a href="${e(artifactUrl(run,a))}&download=1" title="下载文件">${icon('download')}</a></div></div>`).join('')}`;
}

async function submit() {
  if (state.sending || !state.draft.trim()) return;
  state.sending = true; const draft = state.draft.trim(), run = selected();
  try {
    if (run && busy(run.status)) {
      await api(`/api/runs/${run.id}/messages`, {method:'POST',body:{text:draft,workflow:state.draftWorkflow,manualTasks:state.manualTasks.length?state.manualTasks:run.manualTasks}}); toast('已记录补充要求，将在后续模型调用时传入');
    } else {
      const value = run ? await api(`/api/runs/${run.id}/followup`, {method:'POST',body:{text:draft,workflow:state.draftWorkflow,manualTasks:state.manualTasks.length?state.manualTasks:run.manualTasks}}) : await api('/api/runs',{method:'POST',body:{prompt:draft,projectPath:state.projectPath,workflow:state.draftWorkflow,manualTasks:state.manualTasks}});
      state.selected = value.id; state.tab = 'chat'; localStorage.setItem('piagent.selected',value.id); await loadEvents(value.id);
    }
    state.draft = ''; await refresh();
  } catch (error) { toast(error.message,true); } finally { state.sending = false; render(); }
}
const samples = ['请分析这个项目的结构和主要模块，找出三个最值得改进的问题，为每个问题给出具体文件位置、改进方案和验证方法，并生成一份审计报告。','请用 Python 实现一个 CSV 数据清洗工具，支持缺失值处理、去重与列名规范化。交付可运行代码、使用说明和测试文件，并由审计模型检查边界情况。'];
async function action(button) {
  const type = button.dataset.action, run = selected();
  if (type === 'manage-session') return sessions.menu(button.dataset.id);
  if (type === 'archives') return sessions.archives();
  if (type === 'settings') return settingsModal();
  if (type === 'toggle-monitor') { state.monitorHidden=!state.monitorHidden; render(); return; }
  if (type === 'rail-scope') { state.railScope=button.dataset.id; await Promise.all(dashboard.laneRuns().filter(r=>!state.loadedEvents.has(r.id)).map(r=>loadEvents(r.id))); render(); return; }
  if (type === 'event-focus') {
    state.selected=button.dataset.id; state.tab='events'; state.eventFocus={runId:state.selected,seq:Number(button.dataset.seq)};
    const chosen=selected(); state.draftWorkflow=structuredClone(chosen.workflow); state.manualTasks=structuredClone(chosen.manualTasks||[]);
    localStorage.setItem('piagent.selected',state.selected); await loadEvents(state.selected); render();
    document.getElementById(`event-${state.eventFocus.seq}`)?.scrollIntoView({block:'center',behavior:'smooth'}); return;
  }
  if (type === 'workflow') return configUI.openWorkflow();
  if (type === 'edit-plan') return configUI.editPlan();
  if (type === 'confirm-assignment') {if(state.assignmentSaving)return;await api(`/api/runs/${run.id}/plan`,{method:'POST',body:{tasks:run.tasks,version:run.assignmentVersion||0}}); await refresh(); return; }
  if (type === 'new') { state.selected = null; localStorage.removeItem('piagent.selected'); state.tab = 'chat'; state.draft = ''; state.draftWorkflow=structuredClone(state.config.workflow);state.manualTasks=[];render(); document.querySelector('#prompt-input').focus(); return; }
  if (type === 'overview') { state.tab = 'chat'; render(); return; }
  if (type === 'select') { state.selected = button.dataset.id; state.tab = 'chat';const chosen=selected();state.draftWorkflow=structuredClone(chosen.workflow);state.manualTasks=structuredClone(chosen.manualTasks || []); localStorage.setItem('piagent.selected',state.selected); await loadEvents(state.selected); render(); return; }
  if (type === 'tab') { state.tab = button.dataset.id; if (run) await loadEvents(run.id); render(); return; }
  if (type === 'sample') { state.draft = samples[Number(button.dataset.index)]; render(); document.querySelector('#prompt-input').focus(); return; }
  if (type === 'expand') { const id = button.dataset.id; state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id); render(); return; }
  if (type === 'path') return pathModal();
  if (type === 'demo') {
    const value = await api('/api/runs',{method:'POST',body:{prompt:state.draft.trim() || '体验多模型并行协作与自动交接',projectPath:state.projectPath,demo:true,workflow:state.draftWorkflow,manualTasks:state.manualTasks}});
    state.selected = value.id; state.draft = ''; state.tab = 'chat'; localStorage.setItem('piagent.selected',value.id); await loadEvents(value.id); await refresh(); return;
  }
  if (type === 'cancel') { await api(`/api/runs/${run.id}/cancel`,{method:'POST',body:{}}); await refresh(); return; }
  if (type === 'retry') { await api(`/api/runs/${run.id}/retry`,{method:'POST',body:{}}); await refresh(); return; }
  if (type === 'approve' || type === 'deny') {
    const id = button.dataset.id, answer = document.getElementById(`answer-${id}`)?.value || '';
    await api(`/api/runs/${run.id}/approvals/${id}`,{method:'POST',body:{approved:type === 'approve',answer}}); await refresh(); return;
  }
  if (type === 'preview') {
    const artifact = run.artifacts[Number(button.dataset.index)]; const value = await api(artifactUrl(run,artifact));
    openModal(`<div class="modal-head"><div><h2>${e(artifact.path)}</h2><p>${e(artifact.taskId)} · ${artifact.bytes} bytes</p></div><button class="icon-btn" data-modal-action="close" title="关闭">${icon('close')}</button></div><div class="modal-body"><pre class="file-preview">${e(value.content)}</pre></div><div class="modal-foot"><small>文本预览 · 文件保存在本机</small><a class="secondary" href="${e(artifactUrl(run,artifact))}&download=1">${icon('download')}下载文件</a></div>`); return;
  }
}
app.addEventListener('click',event => { const button = event.target.closest('[data-action]'); if (button) action(button).catch(error => toast(error.message,true)); });
app.addEventListener('input',event => { if (event.target.id === 'session-search') { state.search=event.target.value; document.querySelector('.recent-list').innerHTML=renderRecent(); } if (event.target.id === 'prompt-input') state.draft = event.target.value; if (event.target.id.startsWith('answer-')) state.answers[event.target.id.slice(7)] = event.target.value; });
app.addEventListener('toggle',event=>{
  const key=event.target.dataset.detailKey;
  if(key) { if(event.target.open)state.openDetails.add(key);else state.openDetails.delete(key); }
},true);
app.addEventListener('change',async event=>{
  const taskId=event.target.dataset.assignWorker || event.target.dataset.assignFallback;
  if(!taskId)return;
  const controls=event.target.closest('.task-controls'),run=selected();
  const worker=controls.querySelector('select').value,allowFallback=event.target.dataset.assignFallback ? event.target.checked : false;
  state.assignmentSaving++;
  document.querySelectorAll('[data-action="confirm-assignment"],[data-action="edit-plan"]').forEach(n=>n.disabled=true);
  event.target.disabled=true;
  try{await api(`/api/runs/${run.id}/tasks/${encodeURIComponent(taskId)}/assign`,{method:'POST',body:{worker,allowFallback}});if(refreshPromise)await refreshPromise;await refresh();}
  catch(error){toast(error.message,true);await refresh();}
  finally{state.assignmentSaving--;render();}
});
app.addEventListener('submit',event => { if (event.target.id === 'composer') { event.preventDefault(); submit(); } });
app.addEventListener('keydown',event => {
  if (event.target.id === 'prompt-input' && (event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); submit(); }
  if (event.target.matches('[role=button]') && ['Enter',' '].includes(event.key)) { event.preventDefault(); action(event.target).catch(error => toast(error.message,true)); }
});
let modalFocus;
function openModal(content, cls = '') { modalFocus = document.activeElement; modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal ${cls}" role="dialog" aria-modal="true" aria-label="工作台对话框">${content}</section></div>`; modalRoot.querySelector('button,input')?.focus(); }
function closeModal() { modalRoot.innerHTML = ''; state.modal = null; configUI.clearSecrets();modalFocus?.focus?.(); }
document.addEventListener('keydown', event => {
  if (!modalRoot.children.length) return;
  if (event.key === 'Escape') closeModal();
  if (event.key === 'Tab') {
    const nodes = [...modalRoot.querySelectorAll('button,a[href],input,textarea,select')].filter(n => !n.disabled);
    if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
    if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
  }
});
modalRoot.addEventListener('click',event => { if (event.target.classList.contains('modal-backdrop')) closeModal(); const button = event.target.closest('[data-modal-action]'); if (button) modalAction(button).catch(error => toast(error.message,true)); });
function field(label,id,value,hint='',type='text') { return `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${e(value)}" ${type === 'password' ? 'autocomplete="new-password"' : ''}>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`; }
function settingsModal() { return configUI.open(); }
async function modalAction(button) { return button.dataset.modalAction.startsWith('session-')?sessions.action(button):configUI.action(button); }
function pathModal() { openModal(`<div class="modal-head"><div><h2>项目工作目录</h2><p>模型可以读取这个目录，产物保存到独立任务目录。</p></div><button class="icon-btn" data-modal-action="close" title="关闭">${icon('close')}</button></div><div class="modal-body"><label for="project-path-input">本机绝对路径</label><input id="project-path-input" value="${e(state.projectPath)}"><small>例如 E:\\projects\\my-app。创建任务时会校验目录是否存在。</small></div><div class="modal-foot"><small>源文件通过工具保持只读</small><button class="primary" data-modal-action="save-path">使用此目录</button></div>`,'path-form'); }

try {
  const catalogData=await api('/api/catalog');state.catalog=catalogData.catalog;state.supportNotes=catalogData.supportNotes;
  await refresh(); if (state.selected) { await loadEvents(state.selected); render(); }
  api('/api/health').then(value => { state.health = value; }).catch(() => {});
  const events = new EventSource('/api/events');
  events.addEventListener('sync',async () => { state.connected = true; try { await refresh(); await Promise.all(dashboard.laneRuns().map(r=>loadEvents(r.id))); render(); } catch(error) { toast(error.message,true); } });
  events.onmessage = message => {
    const ev = JSON.parse(message.data), list = state.events[ev.runId] ||= [];
    if(ev.type==='run_deleted'){delete state.events[ev.runId];state.loadedEvents.delete(ev.runId);scheduleRefresh();return;}
    if (!list.some(item => item.seq === ev.seq)) { list.push(ev); if (list.length > 3000) list.shift(); }
    scheduleRefresh();
  };
  events.onerror = () => { state.connected = false; render(); };
} catch(error) { app.innerHTML = `<div class="boot"><small>无法连接本地服务：${e(error.message)}。请确认 npm start 正在运行后刷新。</small></div>`; }







