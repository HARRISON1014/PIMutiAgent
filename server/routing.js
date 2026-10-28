import { workflowSchema, validatePlan } from './schema.js';

export function getWorkflow(config, overrides = {}) {
  const value = workflowSchema.parse({...config.workflow,...overrides});
  const ids = new Set(config.connections.filter(c=>c.enabled).map(c=>c.id));
  for (const id of [value.planner,value.reviewer,value.riskReviewer,value.defaultWorker,...value.workerPool,...value.rules.map(r=>r.worker)]) if (!ids.has(id)) throw new Error(`分工引用了不存在或已停用的连接：${id}`);
  value.workerPool = [...new Set(value.workerPool)];
  if(value.assignmentMode!=='manual' && !value.workerPool.includes(value.defaultWorker))throw new Error('默认执行模型必须包含在自动执行池中，或选择手动分工');
  return value;
}
export function routePlan(value, config, workflow, { manual = false } = {}) {
  const allowed = manual ? config.connections.filter(c=>c.enabled).map(c=>c.id) : workflow.workerPool;
  const plan = validatePlan(value,allowed);
  plan.tasks = plan.tasks.map(task => {
    if (manual) return {...task,assignmentSource:'user',pinned:true,allowFallback:!!value.tasks.find(t=>t.id === task.id)?.allowFallback};
    const rule = workflow.rules.find(rule => `${task.id}\n${task.title}\n${task.instructions}`.toLowerCase().includes(rule.match.toLowerCase()));
    if (rule) return {...task,worker:rule.worker,assignmentSource:`rule:${rule.match}`,pinned:true,allowFallback:rule.allowFallback};
    return {...task,assignmentSource:'planner',pinned:false,allowFallback:workflow.allowFallback};
  });
  return plan;
}
export function canUseConnection(c, config) { return !!c && c.enabled && (c.kind === 'subscription-cli' || (!!c.model && !!config.key(c.apiKeyEnv))); }
