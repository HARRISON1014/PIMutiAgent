import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { jsonSchema } from './schema.js';

export function capture(binary, args, { signal, cwd, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, windowsHide: true, shell: false, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('命令超时')); }, timeout);
    child.stdout.on('data', b => { output = (output + b).slice(-12000); });
    child.stderr.on('data', b => { output = (output + b).slice(-12000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, output }); });
  });
}

export async function codexRequest({ config, prompt, schema, cwd, dataDir, signal, onEvent, spawnProcess = spawn, checkLogin = capture }) {
  signal.throwIfAborted();
  const binary = process.env.CODEX_BIN || config.binary;
  const login = await checkLogin(binary, ['login', 'status'], { signal });
  if (login.code !== 0 || !/ChatGPT/i.test(login.output)) throw new Error('Codex 当前没有使用 ChatGPT 订阅登录。请先运行 codex login；系统不会自动改用付费 API。');
  const schemaPath = path.join(dataDir, `schema-${randomUUID()}.json`);
  await fs.writeFile(schemaPath, JSON.stringify(jsonSchema(schema)));
  try {
    return await new Promise((resolve, reject) => {
      // Reuse CLI ChatGPT login. Never extract, copy, or expose OAuth credentials.
      const env = { ...process.env };
      delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY; delete env.OPENAI_BASE_URL;
      const args = ['exec', '--json', '--color', 'never', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--output-schema', schemaPath, '-C', cwd];
      if (config.transport === 'https') args.push('-c', 'model_provider="piagent_chatgpt"', '-c', 'model_providers.piagent_chatgpt.name="PIagent ChatGPT"', '-c', 'model_providers.piagent_chatgpt.wire_api="responses"', '-c', 'model_providers.piagent_chatgpt.requires_openai_auth=true', '-c', 'model_providers.piagent_chatgpt.supports_websockets=false');
      else args.push('-c', 'model_provider="openai"');
      if (config.model) args.push('--model', config.model);
      args.push('-');
      const child = spawnProcess(binary, args, { cwd, env, windowsHide: true, shell: false, signal, stdio: ['pipe', 'pipe', 'pipe'] });
      let final = '', stderr = '', failure = '', diagnostic = '', completed = false, usage;
      const timer = setTimeout(() => { child.kill(); failure = 'Codex 响应超时，请检查登录、网络或额度后重试'; }, config.timeoutMs);
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        try {
          const event = JSON.parse(line);
          if (event.type === 'turn.completed') { completed = true; usage = event.usage; }
          if (event.type === 'error') { diagnostic = event.message || 'Codex 连接异常'; onEvent?.({ type: 'activity', text: diagnostic }); }
          if (event.type === 'turn.failed') failure = event.message || event.error?.message || 'Codex 请求失败';
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') final = event.item.text || '';
          if (event.type === 'item.started' && event.item?.type === 'command_execution') onEvent?.({ type: 'activity', text: 'Codex 正在只读检查工作目录' });
        } catch { /* stdout can include CLI diagnostics; only parsed events are trusted */ }
      });
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-6000); });
      child.on('error', error => { clearTimeout(timer); lines.close(); reject(error); });
      child.on('close', code => {
        clearTimeout(timer); lines.close();
        if (signal.aborted) return reject(signal.reason || new Error('任务已取消'));
        if (code !== 0 || failure || !completed || !final) return reject(new Error(failure || `Codex 未完成请求 (${code})：${diagnostic || stderr.slice(-1600)}`));
        try {
          const result = schema.parse(JSON.parse(final));
          onEvent?.({ type: 'usage', usage: { input: usage?.input_tokens || 0, output: usage?.output_tokens || 0, cached: usage?.cached_input_tokens || 0, source: 'codex-subscription' } });
          resolve(result);
        } catch (error) { reject(new Error(`Codex 返回的结构化结果无效：${error.message}`)); }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(prompt);
    });
  } finally { await fs.unlink(schemaPath).catch(() => {}); }
}
