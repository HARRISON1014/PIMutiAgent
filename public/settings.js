export function createSettings(ui) {
  const {state,e,icon,api,toast,openModal,closeModal,refresh,render,selected}=ui;
  let editing='settings',draft,keys={},taskDraft=[],planVersion=0;
  const kinds={'api':'API','coding-plan':'Coding Plan','subscription-cli':'订阅 / 账号 CLI'};
  const modes={auto:'规划模型自动分配',review:'先规划，再由我逐项指定',manual:'我填写任务并指定模型'};
  const options=(items,value)=>items.map(([id,name])=>`<option value="${e(id)}" ${id===value?'selected':''}>${e(name)}</option>`).join('');
  const select=(label,id,value,items)=>`<div class="field"><label for="${id}">${label}</label><select id="${id}">${options(items,value)}</select></div>`;
  const field=(label,id,value,type='text')=>`<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${e(value)}" ${type==='password'?'autocomplete="new-password"':''}></div>`;
  const choices=()=>draft.connections.filter(c=>c.enabled).map(c=>[c.id,`${c.name} · ${kinds[c.kind]}${c.model?' · '+c.model:''}`]);
  const value=id=>document.getElementById(id)?.value;
  function workflowFields(w) {
    return `<div class="form-section-title">${icon('network')}角色分工 · 任意连接均可承担任意角色</div><div class="form-grid">${select('规划模型','wf-planner',w.planner,choices())}${select('最终审计模型','wf-reviewer',w.reviewer,choices())}${select('命令风险判断模型','wf-riskReviewer',w.riskReviewer,choices())}${select('默认执行模型（供自动规划参考）','wf-defaultWorker',w.defaultWorker,choices())}${select('分工方式','wf-assignmentMode',w.assignmentMode,Object.entries(modes))}</div><div class="field pool-field"><label>自动规划可选择的执行池（手动指定可使用其他连接）</label><div class="pool-options">${draft.connections.filter(c=>c.enabled).map(c=>`<label class="check-option"><input type="checkbox" data-pool-id="${e(c.id)}" ${w.workerPool.includes(c.id)?'checked':''}><span>${e(c.name)}</span></label>`).join('')}</div></div><label class="check-option"><input id="wf-allowFallback" type="checkbox" ${w.allowFallback?'checked':''}><span>自动分配的任务失败时允许使用执行池内的备用模型</span></label><div class="hint-line">手动指定和规则分配默认锁定模型；单个任务可以另行允许备用模型。</div><div class="form-section-title rule-title">${icon('layers')}固定分工规则 · 从上到下首次匹配生效</div><div id="routing-rules">${w.rules.map((r,i)=>`<div class="routing-rule">${field('任务关键词',`rule-${i}-match`,r.match)}${select('固定执行模型',`rule-${i}-worker`,r.worker,choices())}<label class="check-option"><input id="rule-${i}-fallback" type="checkbox" ${r.allowFallback?'checked':''}>允许备用</label><button class="icon-btn danger" data-modal-action="remove-rule" data-index="${i}" title="删除规则">${icon('close')}</button></div>`).join('')}</div><button class="secondary" data-modal-action="add-rule">${icon('plus')}添加固定分工规则</button>`;
  }
  function collectWorkflow() {
    return {planner:value('wf-planner'),reviewer:value('wf-reviewer'),riskReviewer:value('wf-riskReviewer'),defaultWorker:value('wf-defaultWorker'),assignmentMode:value('wf-assignmentMode'),workerPool:[...document.querySelectorAll('[data-pool-id]:checked')].map(n=>n.dataset.poolId),allowFallback:document.getElementById('wf-allowFallback').checked,rules:draft.workflow.rules.map((_,i)=>({match:value(`rule-${i}-match`).trim(),worker:value(`rule-${i}-worker`),allowFallback:document.getElementById(`rule-${i}-fallback`).checked}))};
  }
  function connectionFields(c,i) {
    const verified=state.verification?.[c.id];
    const stateLabel=verified?.message || (c.kind==='subscription-cli'?'官方 CLI：需要安装、账号登录和推理验证':c.configured?'已保存密钥，推理未验证':'等待配置密钥和模型 ID');
    return `<details class="provider-form connection-form" open><summary><b>${e(c.name)}</b><span class="tag ${c.kind==='subscription-cli'?'':'api'}">${e(kinds[c.kind])}</span><span class="connection-summary">${e(verified?.state==='inference-verified'?'推理已验证':c.configured?'已填密钥':'待验证')}</span></summary><div class="form-grid">${field('显示名称',`conn-${i}-name`,c.name)}${field('连接 ID',`conn-${i}-id`,c.id)}${select('接入方式',`conn-${i}-kind`,c.kind,Object.entries(kinds))}${field('模型 ID（CLI 可留空使用账号默认模型）',`conn-${i}-model`,c.model)}${c.kind==='subscription-cli'?`${select('官方 CLI 适配器',`conn-${i}-adapter`,c.adapter,[['codex','Codex'],['claude','Claude Code'],['gemini','Gemini CLI'],['copilot','GitHub Copilot CLI'],['qwen','Qwen Code'],['kimi','Kimi Code']])}${field('可执行文件或 JS 入口',`conn-${i}-binary`,c.binary||c.adapter)}`:`${select('API 协议',`conn-${i}-api`,c.api,[['openai-completions','OpenAI Chat Completions'],['openai-responses','OpenAI Responses'],['anthropic-messages','Anthropic Messages'],['google-generative-ai','Google Gemini Native']])}${field('API Base URL',`conn-${i}-baseUrl`,c.baseUrl)}${field('API Key（留空保留现有密钥）',`conn-${i}-key`,keys[c.apiKeyEnv]||'','password')}${field('密钥环境变量',`conn-${i}-apiKeyEnv`,c.apiKeyEnv)}`}${field('上下文窗口 tokens',`conn-${i}-contextWindow`,c.contextWindow,'number')}${field('最大输出 tokens',`conn-${i}-maxTokens`,c.maxTokens,'number')}</div><div class="connection-buttons"><button class="secondary" data-modal-action="connection-kind" data-index="${i}">应用接入方式</button>${c.kind==='subscription-cli'?`<button class="secondary" data-modal-action="probe" data-index="${i}">${icon('refresh')}检测安装与登录</button>`:`<button class="secondary" data-modal-action="models" data-index="${i}">${icon('refresh')}读取模型列表</button>`}<button class="secondary" data-modal-action="test" data-index="${i}">${icon('play')}推理测试（消耗额度）</button><button class="icon-btn danger" data-modal-action="remove-connection" data-index="${i}" title="删除此连接">${icon('close')}</button></div><div class="connection-result" id="connection-result-${i}">${e(stateLabel)}</div><div id="model-list-${i}" class="model-list"></div></details>`;
  }
  function settingsContent() {
    editing='settings';
    openModal(`<div class="modal-head"><div><h2>模型池与默认分工</h2><p>连接来源和工作角色独立配置。可以让任意 API 或订阅模型负责规划、审计或执行。</p></div><button class="icon-btn" data-modal-action="close" title="关闭">${icon('close')}</button></div><div class="modal-body"><div class="config-help">${(state.supportNotes||[]).map(n=>`<div>${e(n)}</div>`).join('')}<div>API Key 仅保存在本机，页面不会回显。CLI 复用对应官方客户端的账号登录。</div></div>${workflowFields(draft.workflow)}<div class="divider"></div><div class="form-section-title">${icon('layers')}模型连接池</div><div class="preset-picker"><select id="provider-preset" aria-label="选择厂商预设">${options((state.catalog||[]).map(c=>[c.id,c.name]),state.catalog?.[0]?.id)}</select><button class="secondary" data-modal-action="add-preset">${icon('plus')}添加连接</button></div>${draft.connections.map(connectionFields).join('')}<div class="divider"></div><div class="form-section-title">${icon('settings')}调度与用量阈值</div><div class="form-grid three">${Object.entries(draft.policy).map(([k,v])=>field({concurrency:'同时执行任务数',maxRevisions:'最多自动返工轮数',maxWorkerTurns:'单任务最多模型轮数',maxRunInputTokens:'输入 token 阈值',maxRunOutputTokens:'输出 token 阈值'}[k],`policy-${k}`,v,'number')).join('')}</div></div><div class="modal-foot"><small>默认分工对新任务生效。<br>创建任务前可单独覆盖本轮分工。</small><button class="primary" data-modal-action="save-settings">${icon('check')}保存模型与默认分工</button></div>`);
  }
  function collectSettings() {
    draft.workflow=collectWorkflow();
    const renamed=new Map();
    draft.connections.forEach((c,i)=>{
      const oldId=c.id;
      for(const k of ['name','id','model','kind'])c[k]=value(`conn-${i}-${k}`).trim();
      for(const k of ['api','adapter','binary','baseUrl'])if(value(`conn-${i}-${k}`)!==undefined)c[k]=value(`conn-${i}-${k}`).trim();
      const oldEnv=c.apiKeyEnv;
      if(value(`conn-${i}-apiKeyEnv`)!==undefined)c.apiKeyEnv=value(`conn-${i}-apiKeyEnv`).trim();
      if(value(`conn-${i}-key`)?.trim())keys[c.apiKeyEnv]=value(`conn-${i}-key`).trim();
      if(oldEnv!==c.apiKeyEnv)delete keys[oldEnv];
      for(const k of ['contextWindow','maxTokens'])c[k]=Number(value(`conn-${i}-${k}`));
      if(oldId!==c.id)renamed.set(oldId,c.id);
    });
    for(const k of ['planner','reviewer','riskReviewer','defaultWorker'])draft.workflow[k]=renamed.get(draft.workflow[k])||draft.workflow[k];
    draft.workflow.workerPool=draft.workflow.workerPool.map(id=>renamed.get(id)||id);
    draft.workflow.rules.forEach(r=>r.worker=renamed.get(r.worker)||r.worker);
    for(const k of Object.keys(draft.policy))draft.policy[k]=Number(value('policy-'+k));
    return {...draft,keys:Object.fromEntries(Object.entries(keys).filter(([env])=>draft.connections.some(c=>c.apiKeyEnv===env && c.kind!=='subscription-cli')))};
  }
  function manualFields(tasks) {
    return `<div class="manual-task-list">${tasks.map((t,i)=>`<div class="manual-task"><div class="manual-task-heading"><b>任务 ${i+1}</b><button class="icon-btn danger" data-modal-action="remove-manual" data-index="${i}" title="删除任务">${icon('close')}</button></div><div class="form-grid">${field('任务 ID',`manual-${i}-id`,t.id)}${field('任务标题',`manual-${i}-title`,t.title)}${select('指定执行模型',`manual-${i}-worker`,t.worker,choices())}${field('依赖任务 ID（英文逗号分隔）',`manual-${i}-depends`,t.dependsOn.join(', '))}<div class="field full"><label for="manual-${i}-instructions">具体要求</label><textarea id="manual-${i}-instructions">${e(t.instructions)}</textarea></div><div class="field full"><label for="manual-${i}-acceptance">验收标准（每行一条）</label><textarea id="manual-${i}-acceptance">${e(t.acceptance.join('\n'))}</textarea></div><label class="check-option full"><input id="manual-${i}-fallback" type="checkbox" ${t.allowFallback?'checked':''}>失败时允许切换至执行池内的备用模型</label></div></div>`).join('')}</div><button class="secondary" data-modal-action="add-manual">${icon('plus')}添加我指定的任务</button>`;
  }
  function collectManual() {
    return taskDraft.map((_,i)=>({id:value(`manual-${i}-id`).trim(),title:value(`manual-${i}-title`).trim(),worker:value(`manual-${i}-worker`),dependsOn:value(`manual-${i}-depends`).split(/[,，]/).map(s=>s.trim()).filter(Boolean),instructions:value(`manual-${i}-instructions`).trim(),acceptance:value(`manual-${i}-acceptance`).split('\n').map(s=>s.trim()).filter(Boolean),allowFallback:document.getElementById(`manual-${i}-fallback`).checked}));
  }
  function workflowContent() {
    editing='workflow';
    openModal(`<div class="modal-head"><div><h2>本轮角色与任务分工</h2><p>手动任务可以使用任何已启用的连接，包括承担规划或审计的同一个模型。</p></div><button class="icon-btn" data-modal-action="close" title="关闭">${icon('close')}</button></div><div class="modal-body">${workflowFields(draft.workflow)}<div class="divider"></div><div class="form-section-title">${icon('file')}我指定的任务</div><p class="artifact-note">选择“我填写任务并指定模型”后，直接使用下面的任务，跳过模型拆解。其他模式会保留草稿；规则仍可固定部分任务。</p>${manualFields(taskDraft)}</div><div class="modal-foot"><small>这是本轮设置，不改写默认分工。<br>指定模型默认锁定。</small><button class="primary" data-modal-action="save-workflow">${icon('check')}使用本轮分工</button></div>`);
  }
  function planContent() {
    editing='plan';openModal(`<div class="modal-head"><div><h2>编辑计划并指定执行模型</h2><p>可修改任务、要求、依赖和模型。保存后锁定分工并开始执行。</p></div><button class="icon-btn" data-modal-action="close" title="关闭">${icon('close')}</button></div><div class="modal-body">${manualFields(taskDraft)}</div><div class="modal-foot"><small>模型不会覆盖你的指定。<br>运行中的任务不会被重新分配。</small><button class="primary" data-modal-action="confirm-plan">${icon('play')}按此计划开始执行</button></div>`);
  }
  function collectCurrent() {if(editing==='settings')collectSettings();else if(editing==='workflow'){draft.workflow=collectWorkflow();taskDraft=collectManual();}else taskDraft=collectManual();}
  function redraw() {if(editing==='settings')settingsContent();else if(editing==='workflow')workflowContent();else planContent();}
  async function saveConfig() {
    const result=await api('/api/config',{method:'PUT',body:collectSettings()});state.config=result;draft=structuredClone(result);keys={};state.draftWorkflow=structuredClone(result.workflow);await refresh();return result;
  }
  return {
    clearSecrets(){keys={};},
    open(){draft=structuredClone(state.config);keys={};settingsContent();},
    openWorkflow(){
      const run=selected();if(run && ['queued','planning','executing','reviewing','waiting_confirmation','waiting_assignment'].includes(run.status)){
        const w=run.workflow,n=id=>run.config.connections.find(c=>c.id===id)?.name||id;
        openModal(`<div class="modal-head"><div><h2>本轮分工</h2><p>角色已固定；未开始任务可以在任务卡片重新指定，等待分工时还可以编辑完整计划。</p></div><button class="icon-btn" data-modal-action="close" title="关闭">${icon('close')}</button></div><div class="modal-body"><div class="role-summary-list">${[['planner','目标规划'],['reviewer','最终审计'],['riskReviewer','命令风险判断'],['defaultWorker','默认执行']].map(([k,label])=>`<p><span>${label}</span><b>${e(n(w[k]))}</b></p>`).join('')}<p><span>分工方式</span><b>${e(modes[w.assignmentMode])}</b></p></div><div class="divider"></div>${w.rules.map(r=>`<p class="artifact-note">${e(r.match)} → ${e(n(r.worker))}${r.allowFallback?' · 允许备用':' · 锁定模型'}</p>`).join('')}</div>`);return;
      }
      draft=structuredClone(state.config);draft.workflow=structuredClone(state.draftWorkflow || state.config.workflow);taskDraft=structuredClone(state.manualTasks || []);workflowContent();
    },
    editPlan(){if(state.assignmentSaving)return;const run=selected();draft=structuredClone(run.config);taskDraft=structuredClone(run.tasks);planVersion=run.assignmentVersion||0;planContent();},
    async action(button){
      const type=button.dataset.modalAction,i=Number(button.dataset.index);
      if(type==='close'){keys={};return closeModal();}
      if(type==='save-settings'){button.disabled=true;try{await saveConfig();closeModal();render();toast('连接与默认分工已保存');}finally{button.disabled=false;}return;}
      if(type==='save-workflow'){collectCurrent();if(!draft.workflow.workerPool.length)throw new Error('请至少选择一个执行池模型');if(draft.workflow.assignmentMode==='manual'&&!taskDraft.length)throw new Error('请至少填写一个任务');state.draftWorkflow=draft.workflow;state.manualTasks=taskDraft;closeModal();render();toast('本轮分工已设置，发送目标即可开始');return;}
      if(type==='confirm-plan'){taskDraft=collectManual();await api(`/api/runs/${selected().id}/plan`,{method:'POST',body:{tasks:taskDraft,version:planVersion}});closeModal();await refresh();return;}
      if(type==='add-rule'){collectCurrent();draft.workflow.rules.push({match:'',worker:draft.workflow.defaultWorker,allowFallback:false});redraw();return;}
      if(type==='remove-rule'){collectCurrent();draft.workflow.rules.splice(i,1);redraw();return;}
      if(type==='add-manual'){collectCurrent();let n=taskDraft.length+1;while(taskDraft.some(t=>t.id===`task-${n}`))n++;taskDraft.push({id:`task-${n}`,title:'',instructions:'',worker:draft.workflow.defaultWorker,dependsOn:[],acceptance:[],allowFallback:false});redraw();return;}
      if(type==='remove-manual'){collectCurrent();taskDraft.splice(i,1);redraw();return;}
      if(type==='add-preset'){
        const preset=state.catalog.find(c=>c.id===value('provider-preset'));collectSettings();let id=preset.id,n=2;while(draft.connections.some(c=>c.id===id))id=`${preset.id}-${n++}`;
        draft.connections.push({...preset,id,enabled:true,api:preset.api||'openai-completions',apiKeyEnv:preset.apiKeyEnv||'CUSTOM_API_KEY',baseUrl:preset.baseUrl||'',adapter:preset.adapter||'codex',binary:preset.binary||'',model:'',transport:'https',timeoutMs:300000,contextWindow:128000,maxTokens:8192,reasoning:false});
        settingsContent();return;
      }
      if(type==='connection-kind'){collectSettings();settingsContent();return;}
      if(type==='remove-connection'){
        collectSettings();if(draft.connections.length<=1)throw new Error('至少保留一个连接');const removed=draft.connections.splice(i,1)[0],first=draft.connections[0].id;
        for(const k of ['planner','reviewer','riskReviewer','defaultWorker'])if(draft.workflow[k]===removed.id)draft.workflow[k]=first;
        draft.workflow.workerPool=draft.workflow.workerPool.filter(id=>id!==removed.id);if(!draft.workflow.workerPool.length)draft.workflow.workerPool=[first];draft.workflow.rules=draft.workflow.rules.filter(r=>r.worker!==removed.id);settingsContent();return;
      }
      if(type==='choose-model'){document.getElementById(`conn-${i}-model`).value=button.dataset.model;return;}
      if(['models','probe','test'].includes(type)){
        button.disabled=true;try{
          const saved=await saveConfig(),c=saved.connections[i];
          document.querySelectorAll('input[type=password]').forEach(n=>n.value='');
          const target=document.getElementById(`connection-result-${i}`);target.textContent=type==='test'?'正在进行真实推理，可能需要等待…':'正在检测…';
          const result=await api(type==='models'?`/api/models/${encodeURIComponent(c.id)}`:`/api/connections/${encodeURIComponent(c.id)}/${type}`,type==='models'?{}:{method:'POST',body:{}});
          if(type==='models') {document.getElementById(`model-list-${i}`).innerHTML=result.models.map(id=>`<button class="model-chip" data-modal-action="choose-model" data-index="${i}" data-model="${e(id)}">${e(id)}</button>`).join('');target.textContent='模型列表已返回。选择模型后保存；模型权限请使用推理测试验证。';}
          else {state.verification ||= {};state.verification[c.id]=result;target.textContent=result.message;}
        }catch(error){const target=document.getElementById(`connection-result-${i}`);if(target)target.textContent=error.message;throw error;}finally{button.disabled=false;}return;
      }
      if(type==='save-path'){const val=value('project-path-input').trim();if(!val)throw new Error('请输入本机项目目录');state.projectPath=val;localStorage.setItem('piagent.path',val);closeModal();render();}
    },
  };
}
