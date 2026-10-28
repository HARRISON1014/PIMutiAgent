import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConfig } from './config.js';
import { Store } from './store.js';
import { Orchestrator } from './orchestrator.js';
import { z } from 'zod';
import { catalog, supportNotes } from './catalog.js';
import { probeConnection } from './cli.js';
import { listConnectionModels } from './api-models.js';
import { readText } from './files.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 262144) throw new Error('请求内容过大'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export async function createApp({ dataDir = process.env.PIAGENT_DATA_DIR || path.join(root, '.piagent'), appRoot = root } = {}) {
  const config = createConfig(appRoot, dataDir), store = new Store(dataDir);
  store.recover();
  const clients = new Set();
  const verification = new Map();
  const runner = new Orchestrator({ store, config, dataDir, emit: event => {
    for (const client of clients) {
      const prefix=Number.isInteger(event.seq)?`id: ${event.seq}\n`:'';
      if (!client.write(`${prefix}data: ${JSON.stringify(event)}\n\n`)) { client.end(); clients.delete(client); }
    }
  } });
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(config.redact(JSON.stringify(value))); };
    try {
      const host = req.headers.host || '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return send({ error: '只允许本机访问' }, 403);
      const url = new URL(req.url, `http://${host}`), parts = url.pathname.split('/').filter(Boolean);
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return send({ error: '拒绝跨站请求' }, 403);
      if (url.pathname === '/api/info' && req.method === 'GET') return send({ name:packageInfo.name,version:packageInfo.version });
      if (!['GET', 'HEAD'].includes(req.method) && (req.headers['x-piagent'] !== '1' || !req.headers['content-type']?.startsWith('application/json'))) return send({ error: '请求缺少本机客户端验证头' }, 403);
      if (url.pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        // Always refresh from durable state on reconnect, so dropped events cannot corrupt UI state.
        res.write(`event: sync\ndata: ${JSON.stringify({ connected: true })}\n\n`); clients.add(res);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
        req.on('close', () => { clearInterval(heartbeat); clients.delete(res); }); return;
      }
      if (url.pathname === '/api/state' && req.method === 'GET') {
        const runs=store.list().map(r=>runner.get(r.id));
        return send({ runs:runs.filter(r=>!r.archivedAt), archivedRuns:runs.filter(r=>r.archivedAt), config:config.public(), projectPath:appRoot, verification:Object.fromEntries(verification) });
      }
      if (url.pathname === '/api/catalog' && req.method === 'GET')return send({catalog,supportNotes});
      if (url.pathname === '/api/config' && req.method === 'PUT') {
        if (runner.live.size) throw new Error('请在当前任务结束或取消后修改模型设置');
        const next=config.save(await body(req));verification.clear();return send(next);
      }
      if (url.pathname === '/api/health' && req.method === 'GET') {
        return send({connections:config.public().connections.map(c=>({id:c.id,state:verification.get(c.id)?.state || c.credentialState}))});
      }
      if(parts[0]==='api' && parts[1]==='connections' && parts[2] && parts.length===4 && req.method==='POST') {
        const c=runner.runtime.connection(parts[2]);
        if(parts[3]==='probe') {const result=await probeConnection(c);verification.set(c.id,{...result,at:new Date().toISOString()});return send(result);}
        if(parts[3]==='test') {
          const usage=[];
          try {
            await runner.runtime.structured({connection:c,prompt:'PIagent connection check. Do not use tools. Return {"ok":true}.',schema:z.object({ok:z.literal(true)}),signal:AbortSignal.timeout(Math.min(c.timeoutMs,180000)),onEvent:e=>{if(e.type==='usage')usage.push(e.usage);}});
            const result={state:'inference-verified',at:new Date().toISOString(),message:'所选连接已完成真实结构化推理。订阅或计费权益由对应账号方案管理。',usage};
            verification.set(c.id,result);return send(result);
          } catch(error) {const result={state:'failed',at:new Date().toISOString(),message:config.redact(error.message)};verification.set(c.id,result);throw error;}
        }
      }
      if (parts[0] === 'api' && parts[1] === 'models' && parts.length === 3 && req.method === 'GET') {
        const worker = config.get().connections.find(w => w.id === parts[2]);
        if (!worker || !config.key(worker.apiKeyEnv)) throw new Error('请先保存 API Key');
        if(worker.kind==='subscription-cli')throw new Error('订阅模型 ID 由官方 CLI 账号可用列表决定，请手动填写或留空使用 CLI 默认值');
        return send({models:await listConnectionModels(worker,config.key(worker.apiKeyEnv))});
      }
      if (url.pathname === '/api/runs' && req.method === 'POST') return send(await runner.create(await body(req)), 201);
      if (parts[0] === 'api' && parts[1] === 'runs' && parts[2]) {
        const run = runner.get(parts[2]); if (!run) return send({ error: '任务不存在' }, 404);
        if (parts.length === 3 && req.method === 'GET') return send(run);
        if (parts.length === 3 && req.method === 'DELETE') { runner.deleteRun(run.id); return send({ ok:true }); }
        if (parts.length === 4 && parts[3] === 'archive' && req.method === 'POST') return send(runner.archive(run.id,(await body(req)).archived));
        if (parts[3] === 'events' && req.method === 'GET') return send(store.events(run.id, Number(url.searchParams.get('after')) || 0));
        if (parts[3] === 'cancel' && req.method === 'POST') { runner.cancel(run.id); return send({ ok: true }); }
        if (parts[3] === 'retry' && req.method === 'POST') return send(await runner.retry(run.id));
        if (parts[3] === 'followup' && req.method === 'POST') {const input=await body(req);return send(await runner.followup(run.id,input.text,input),201);}
        if(parts[3]==='plan' && req.method==='POST') {const input=await body(req);if(!Number.isInteger(input.version)||input.version<0)throw new Error('缺少计划版本，请刷新页面');runner.confirmPlan(run.id,input.tasks,input.version);return send({ok:true});}
        if(parts[3]==='tasks' && parts[4] && parts[5]==='assign' && req.method==='POST')return send(runner.assignTask(run.id,parts[4],await body(req)));
        if (parts[3] === 'messages' && req.method === 'POST') { runner.addMessage(run.id, (await body(req)).text); return send({ ok: true }); }
        if (parts[3] === 'approvals' && parts[4] && req.method === 'POST') { runner.resolveApproval(run.id, parts[4], await body(req)); return send({ ok: true }); }
        if (parts[3] === 'artifact' && req.method === 'GET') {
          const taskId = url.searchParams.get('taskId'), file = url.searchParams.get('path');
          const artifact = run.artifacts.find(a => a.taskId === taskId && a.path === file);
          if (!artifact) return send({ error: '产物不存在' }, 404);
          const content = config.redact(await readText(runner.taskDir(run, taskId), file));
          if (url.searchParams.get('download') === '1') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}` }); res.end(content); return;
          }
          return send({ ...artifact, content });
        }
      }
      if (url.pathname.startsWith('/api/')) return send({ error: '接口不存在' }, 404);
      if (req.method !== 'GET') return send({ error: '方法不支持' }, 405);
      const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!['index.html', 'app.js', 'settings.js', 'dashboard.js', 'sessions.js', 'style.css', 'icon.svg'].includes(filename)) return send({ error: '文件不存在' }, 404);
      const content = await fs.readFile(path.join(appRoot, 'public', filename));
      res.writeHead(200, { 'Content-Type': types[path.extname(filename)] }); res.end(content);
    } catch (error) { if (!res.headersSent) send({ error: error.name === 'ZodError' ? '配置或请求格式无效：' + error.message : error.message }, 400); else res.end(); }
  });
  return { server, runner, config, store, close: async () => { for (const client of clients) client.end(); await runner.shutdown(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = await createApp();
  const port = Number(process.env.PORT || 4317);
  app.server.listen(port, '127.0.0.1', () => process.stdout.write(`PIagent Mission Control → http://127.0.0.1:${port}\n`));
  app.server.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
