export function createSessions(ui) {
  const {state,e,icon,status,shortDate,api,toast,openModal,closeModal,refreshAfterMutation,render,loadEvents,clearSelection}=ui;
  const pending=new Set();
  const find=id=>[...state.runs,...state.archivedRuns].find(r=>r.id===id);
  const active=run=>['queued','planning','executing','reviewing','waiting_confirmation','waiting_assignment'].includes(run.status);
  const closeButton=()=>`<button class="icon-btn" data-modal-action="close" title="关闭">${icon('close')}</button>`;
  function menu(id) {
    const run=find(id);if(!run)throw new Error('会话已不存在，请刷新列表');
    state.modal='session-manage';
    openModal(`<div class="modal-head"><div><h2>管理会话</h2><p>归档收起，删除清理记录。</p></div>${closeButton()}</div><div class="modal-body"><div class="session-subject"><b>${e(run.title)}</b>${status(run.status)}</div>${active(run)?'<p class="session-note">此任务仍在运行。请先关闭此窗口并停止任务，再归档或删除。</p>':''}<div class="session-manage-actions"><button class="session-option" data-modal-action="session-archive" data-id="${e(id)}" ${active(run)?'disabled':''}>${icon('archive')}<span><b>归档会话</b><small>从最近会话收起，保留完整记录，可随时恢复。</small></span>${icon('chevron')}</button><button class="session-option danger" data-modal-action="session-delete" data-id="${e(id)}" ${active(run)?'disabled':''}>${icon('trash')}<span><b>删除会话</b><small>永久删除对话与执行记录，本地产物文件保留。</small></span>${icon('chevron')}</button></div></div>`,'session-dialog');
  }
  function archivedRows() {
    return state.archivedRuns.length?state.archivedRuns.map(run=>`<div class="archived-session"><span class="archive-row-icon">${icon('archive')}</span><div><b>${e(run.title)}</b><small>${shortDate(run.archivedAt)} 归档 · ${run.demo?'演示 · ':''}${run.tasks.length} 个任务</small></div><button class="secondary" data-modal-action="session-restore" data-id="${e(run.id)}" ${pending.has(run.id)?'disabled':''}>${icon('refresh')}恢复并打开</button><button class="icon-btn danger" data-modal-action="session-delete" data-origin="archive" data-id="${e(run.id)}" title="删除归档会话：${e(run.title)}" ${pending.has(run.id)?'disabled':''}>${icon('trash')}</button></div>`).join(''):`<div class="empty-box">${icon('archive')}<h3>还没有归档会话</h3><p>最近会话旁的“更多”按钮中可以归档。<br>归档后，随时在这里恢复。</p></div>`;
  }
  function archives() {
    state.modal='session-archives';
    openModal(`<div class="modal-head"><div><h2>已归档会话 <span id="archives-count" class="muted">${state.archivedRuns.length}</span></h2><p>恢复后会重新出现在最近会话中，历史消息与产物记录完整保留。</p></div>${closeButton()}</div><div class="modal-body" id="archived-sessions">${archivedRows()}</div>`,'archive-dialog');
  }
  function sync() {
    const list=document.getElementById('archived-sessions');
    if(list){list.innerHTML=archivedRows();document.getElementById('archives-count').textContent=state.archivedRuns.length;}
  }
  function confirmDelete(id,origin) {
    const run=find(id);if(!run)throw new Error('会话已不存在，请刷新列表');
    if(active(run))throw new Error('请先停止运行中的任务');
    state.modal='session-delete';
    openModal(`<div class="modal-head"><div><h2>删除这个会话？</h2><p>此操作无法恢复；若只是暂时收起，可以选择归档。</p></div>${closeButton()}</div><div class="modal-body"><div class="session-subject"><b>${e(run.title)}</b>${status(run.status)}</div><div class="delete-notice">${icon('info')}<div><b>将永久删除对话、任务状态和执行记录。</b><p>已生成的本地产物文件会保留，源项目文件不受影响。</p></div></div></div><div class="modal-foot"><button class="secondary" data-modal-action="session-delete-cancel" data-id="${e(id)}" data-origin="${e(origin||'recent')}">取消</button><button class="primary danger-button" data-modal-action="session-delete-confirm" data-id="${e(id)}" data-origin="${e(origin||'recent')}">${icon('trash')}永久删除会话</button></div>`,'session-dialog');
  }
  async function action(button) {
    const type=button.dataset.modalAction,id=button.dataset.id,origin=button.dataset.origin;
    if(type==='session-delete')return confirmDelete(id,origin);
    if(type==='session-delete-cancel')return origin==='archive'?archives():menu(id);
    if(pending.has(id))return;
    pending.add(id);button.disabled=true;
    try {
      if(type==='session-archive' || type==='session-restore') {
        const archived=type==='session-archive';
        const run=await api(`/api/runs/${encodeURIComponent(id)}/archive`,{method:'POST',body:{archived}});
        if(archived && state.selected===id)clearSelection();
        await refreshAfterMutation();closeModal();
        if(!archived){state.selected=id;state.tab='chat';state.draft='';state.draftWorkflow=structuredClone(run.workflow);state.manualTasks=structuredClone(run.manualTasks||[]);localStorage.setItem('piagent.selected',id);await loadEvents(id);}
        render();toast(archived?'会话已归档，可在“已归档会话”中恢复':'会话已恢复');
      }
      if(type==='session-delete-confirm') {
        await api(`/api/runs/${encodeURIComponent(id)}`,{method:'DELETE',body:{}});
        if(state.selected===id)clearSelection();
        delete state.events[id];state.loadedEvents.delete(id);
        await refreshAfterMutation();closeModal();
        if(origin==='archive')archives();
        toast('会话与执行记录已删除，本地产物文件已保留');
      }
    } finally {pending.delete(id);button.disabled=false;sync();}
  }
  return {menu,archives,sync,action};
}
