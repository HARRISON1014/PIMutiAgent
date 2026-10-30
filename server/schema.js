import { z } from 'zod';

export const connectionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), name: z.string().min(1).max(60),
  provider: z.string().max(60).default('custom'), kind: z.enum(['api','coding-plan','subscription-cli']).default('api'),
  api: z.enum(['openai-completions','openai-responses','anthropic-messages','google-generative-ai']).default('openai-completions'),
  baseUrl: z.string().default(''), model: z.string().max(160).default(''), apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).default('CUSTOM_API_KEY'),
  adapter: z.enum(['codex','claude','gemini','copilot','qwen','kimi']).default('codex'), binary: z.string().max(1000).default(''),
  transport: z.enum(['https','auto']).default('https'), timeoutMs: z.number().int().min(10000).max(1800000).default(300000),
  enabled: z.boolean().default(true), reasoning: z.boolean().default(false),
  contextWindow: z.number().int().min(8192).max(2000000).default(128000),
  maxTokens: z.number().int().min(256).max(65536).default(8192),
}).superRefine((c, ctx) => {
  if (c.kind !== 'subscription-cli') {
    try { if (!['https:','http:'].includes(new URL(c.baseUrl).protocol)) throw new Error(); }
    catch { ctx.addIssue({ code:'custom',message:'API 连接必须有 HTTP(S) Base URL',path:['baseUrl'] }); }
  }
});
export const routingRuleSchema = z.object({ match: z.string().min(1).max(160), worker: z.string().min(1), allowFallback: z.boolean().default(false) });
export const workflowSchema = z.object({
  planner: z.string().min(1), reviewer: z.string().min(1), riskReviewer: z.string().min(1), defaultWorker: z.string().min(1),
  workerPool: z.array(z.string().min(1)).min(1).max(32), assignmentMode: z.enum(['auto','review','manual']).default('auto'),
  rules: z.array(routingRuleSchema).max(30).default([]), allowFallback: z.boolean().default(true),
});
export const configSchema = z.object({
  version: z.literal(2).default(2),
  connections: z.array(connectionSchema).min(1).max(40).refine(cs => new Set(cs.map(c=>c.id)).size === cs.length, '连接 ID 不能重复'),
  workflow: workflowSchema,
  policy: z.object({ concurrency: z.number().int().min(1).max(6).default(2), maxRevisions: z.number().int().min(0).max(5).default(2), maxWorkerTurns: z.number().int().min(2).max(60).default(20), maxRunInputTokens: z.number().int().min(1000).default(200000), maxRunOutputTokens: z.number().int().min(1000).default(50000) }),
}).superRefine((c, ctx) => {
  const ids = new Set(c.connections.map(c=>c.id));
  if(c.workflow.assignmentMode!=='manual' && !c.workflow.workerPool.includes(c.workflow.defaultWorker))ctx.addIssue({code:'custom',message:'默认执行模型必须包含在自动执行池中',path:['workflow','defaultWorker']});
  for (const id of [c.workflow.planner,c.workflow.reviewer,c.workflow.riskReviewer,c.workflow.defaultWorker,...c.workflow.workerPool,...c.workflow.rules.map(r=>r.worker)]) if (!ids.has(id)) ctx.addIssue({code:'custom',message:`工作流引用了不存在的连接 ${id}`,path:['workflow']});
});
export function normalizeConfig(value) {
  if (value.connections) return configSchema.parse(value);
  const workers = (value.workers || []).map(w=>({...w,provider:w.id,kind:'api'}));
  return configSchema.parse({version:2,connections:[{id:'codex',name:'Codex 订阅',provider:'openai',kind:'subscription-cli',adapter:'codex',...value.codex},...workers],workflow:{planner:'codex',reviewer:'codex',riskReviewer:'codex',defaultWorker:workers[0]?.id,workerPool:workers.map(w=>w.id),assignmentMode:'auto',rules:[],allowFallback:true},policy:value.policy});
}
export const taskSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), title: z.string().min(1).max(160), instructions: z.string().min(1).max(12000), worker: z.string().min(1), dependsOn: z.array(z.string()).max(20), acceptance: z.array(z.string().min(1)).min(1).max(12) });
export const planSchema = z.object({ summary: z.string().min(1).max(12000), questions: z.array(z.string().min(1).max(2000)).max(8), tasks: z.array(taskSchema).min(1).max(16) });
export const auditSchema = z.object({ verdict: z.enum(['pass', 'revise', 'ask']), summary: z.string().min(1).max(16000), questions: z.array(z.string().min(1).max(2000)).max(8), revisions: z.array(z.object({ taskId: z.string(), instructions: z.string().min(1).max(12000), issueKey:z.string().trim().min(1).max(160), evidence:z.string().trim().min(1).max(4000), rationale:z.string().trim().min(1).max(4000) })).max(16) });
export const riskSchema = z.object({ decision: z.enum(['ask', 'deny']), reason: z.string().min(1).max(4000) });
export function validatePlan(value, workers) {
  const plan = planSchema.parse(value), ids = new Set(plan.tasks.map(t => t.id));
  if (ids.size !== plan.tasks.length) throw new Error('规划包含重复任务 ID');
  const done = new Set();
  for (const task of plan.tasks) {
    if (!workers.includes(task.worker)) throw new Error(`规划引用了未配置模型 ${task.worker}`);
    if (task.dependsOn.some(id => !ids.has(id) || id === task.id)) throw new Error('规划包含无效依赖');
  }
  while (done.size < ids.size) {
    const ready = plan.tasks.filter(t => !done.has(t.id) && t.dependsOn.every(d => done.has(d)));
    if (!ready.length) throw new Error('规划依赖存在循环');
    ready.forEach(t => done.add(t.id));
  }
  return plan;
}
export function jsonSchema(schema) { return z.toJSONSchema(schema, { target: 'draft-7' }); }
