import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { codexRequest } from './codex.js';
import { jsonSchema } from './schema.js';

export async function resolveCommand(binary) {
  const search = path.isAbsolute(binary) || /[\\/]/.test(binary) ? [path.resolve(binary)] : (process.env.PATH || '').split(path.delimiter).map(dir=>path.join(dir,binary));
  for (const candidate of search) for (const suffix of process.platform === 'win32' ? ['', '.exe','.cmd','.ps1'] : ['']) {
    const file = candidate+suffix;
    try {
      if (!(await fs.stat(file)).isFile()) continue;
      if (/\.(?:cmd|ps1)$/i.test(file)) {
        // Resolve standard npm shims to their JS entry point. Never feed user text into cmd.exe.
        const text = await fs.readFile(file,'utf8');
        const match = text.match(/(?:%dp0%|\$basedir)[\\/]([^"\r\n]*?\.(?:m?js|cjs))/i);
        if (!match) continue;
        const entry = path.resolve(path.dirname(file),match[1]);
        if ((await fs.stat(entry)).isFile()) return {file:process.execPath,prefix:[entry]};
      } else if (/\.(?:m?js|cjs)$/i.test(file)) return {file:process.execPath,prefix:[file]};
      else return {file,prefix:[]};
    } catch(error) { if (!['ENOENT','ENOTDIR','EACCES'].includes(error.code)) throw error; }
  }
  throw new Error(`未找到可启动的 CLI：${binary}。请安装官方 CLI，或填写 .exe / JS 入口的绝对路径。`);
}
export async function runCli(binary,args,{input='',cwd,env=process.env,signal,timeoutMs=300000}={}) {
  const command = await resolveCommand(binary);
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child = spawn(command.file,[...command.prefix,...args],{cwd,env,signal,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',timedOut=false,overflow=false;
    const timer = setTimeout(()=>{timedOut=true;child.kill();},timeoutMs);
    child.stdout.on('data',data=>{stdout+=data; if (stdout.length>2000000) {overflow=true;child.kill();}});
    child.stderr.on('data',data=>{stderr=(stderr+data).slice(-8000);});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer); if(signal?.aborted)return reject(signal.reason); if(timedOut)return reject(new Error('订阅 CLI 请求超时')); if(overflow)return reject(new Error('CLI 输出超出上限')); resolve({code,stdout,stderr});});
    child.stdin.on('error',()=>{}); child.stdin.end(input);
  });
}
export function parseJsonText(text) { return JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/,'$1')); }
export function parseCliResult(adapter,stdout) {
  if (adapter === 'kimi' || adapter === 'copilot') return {value:parseJsonText(stdout),usage:null};
  let record = JSON.parse(stdout);
  if (Array.isArray(record)) record = record.findLast(v=>v.type === 'result');
  if (!record || record.is_error || record.error || (record.subtype && record.subtype !== 'success')) throw new Error(record?.error?.message || record?.result || 'CLI 返回失败或缺少完成结果');
  if (adapter === 'gemini') {
    const models = Object.values(record.stats?.models || {});
    const usage = models.some(m=>typeof (m.tokens?.prompt??m.tokens?.input)==='number') ? models.reduce((u,m)=>({input:u.input+(m.tokens?.prompt??m.tokens?.input??0),output:u.output+(m.tokens?.candidates || 0),cached:u.cached+(m.tokens?.cached || 0)}),{input:0,output:0,cached:0}) : null;
    return {value:parseJsonText(record.response),usage};
  }
  const usage = record.usage ? {input:(record.usage.input_tokens||0)+(record.usage.cache_read_input_tokens||0)+(record.usage.cache_creation_input_tokens||0),output:record.usage.output_tokens||0,cached:record.usage.cache_read_input_tokens||0} : null;
  return {value:record.structured_output || (typeof record.result==='string'?parseJsonText(record.result):record.result),usage};
}
export async function cliStructured({connection,prompt,schema,dataDir,signal,onEvent,execute=runCli,readAuthSettings=async()=>fs.readFile(path.join(os.homedir(),'.qwen','settings.json'),'utf8').then(JSON.parse).catch(()=>null)}) {
  if (connection.adapter === 'codex') return codexRequest({config:connection,prompt,schema,cwd:dataDir,dataDir,signal,onEvent});
  const cwd = path.join(dataDir,'cli',randomUUID()); await fs.mkdir(cwd,{recursive:true});
  const env = {...process.env};
  // The official CLI owns its account credentials. API-key environment variables must not select paid APIs silently.
  for (const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_GENAI_USE_VERTEXAI','OPENAI_API_KEY','OPENAI_BASE_URL','DASHSCOPE_API_KEY','QWEN_API_KEY','MOONSHOT_API_KEY','KIMI_API_KEY','COPILOT_ALLOW_ALL','COPILOT_ASSISTED_APPROVAL']) delete env[key];
  const input = `${prompt}\n\nReturn only JSON matching this schema. Do not use native CLI tools to carry out tasks; tools represented in the input are executed by PIagent.\n${JSON.stringify(jsonSchema(schema))}`;
  let args, stdin=input;
  const binary = connection.binary || connection.adapter;
  if (connection.adapter === 'claude') {
    const auth = await execute(binary,['auth','status'],{cwd,env,signal,timeoutMs:15000});
    let value; try {value=JSON.parse(auth.stdout);} catch {throw new Error('无法确认 Claude Code 订阅登录，请运行 claude auth login');}
    if(auth.code !== 0 || !['claude.ai','oauth_token'].includes(value.authMethod))throw new Error('Claude Code 当前未使用账号 OAuth 登录，请运行 claude auth login');
    args=['-p','--safe-mode','--tools','','--disallowedTools','mcp__*','--output-format','json','--json-schema',JSON.stringify(jsonSchema(schema))];
  } else if (connection.adapter === 'gemini') {
    const settings=path.join(cwd,'settings.json'), policy=path.join(cwd,'deny-tools.toml');
    await fs.writeFile(policy,'[[rule]]\ndecision = "deny"\npriority = 999\n');
    await fs.writeFile(settings,JSON.stringify({security:{auth:{selectedType:'oauth-personal',enforcedType:'oauth-personal'}},tools:{core:['__piagent_no_native_tools__']},hooks:{enabled:false},mcp:{allowed:[]},general:{enableAutoUpdate:false}}));
    env.GEMINI_CLI_SYSTEM_SETTINGS_PATH=settings;
    args=['-p','Return the requested JSON from the piped input.','--output-format','json','--approval-mode','plan','--policy',policy];
  } else if (connection.adapter === 'qwen') {
    const settings=await readAuthSettings();
    const type=settings?.security?.auth?.selectedType || settings?.selectedAuthType;
    if(type && type !== 'qwen-oauth')throw new Error('Qwen Code 当前认证不是 Qwen OAuth，请运行 qwen /auth 选择账号登录');
    args=['-p','Return the requested JSON from the piped input.','--safe-mode','--max-tool-calls','0','--exclude-tools','agent','--max-session-turns','3','--output-format','json','--json-schema',JSON.stringify(jsonSchema(schema))];
  } else if (connection.adapter === 'kimi') {
    await fs.writeFile(path.join(cwd,'system.md'),'Return only the requested JSON. Native tools are disabled.');
    await fs.writeFile(path.join(cwd,'agent.yaml'),'version: 1\nagent:\n  name: piagent-bridge\n  system_prompt_path: ./system.md\n  tools: []\n');
    args=['--quiet','--agent-file',path.join(cwd,'agent.yaml')];
  } else if (connection.adapter === 'copilot') {
    await fs.writeFile(path.join(cwd,'request.md'),input);
    stdin='';
    args=['-p','Read request.md in the working directory and return only its requested JSON. Do not execute tasks or other tools.','--silent','--available-tools=view','--deny-tool=shell,write,url,memory','--disable-builtin-mcps','--no-custom-instructions'];
  } else throw new Error('不支持的订阅 CLI');
  if (connection.model) args.push('--model',connection.model);
  onEvent?.({type:'activity',text:`${connection.name} 正在通过官方 CLI 处理请求`});
  try {
    const result=await execute(binary,args,{input:stdin,cwd,env,signal,timeoutMs:connection.timeoutMs});
    if(result.code !== 0)throw new Error(`${connection.name} 请求失败（${result.code}）：${result.stderr.slice(-1800) || result.stdout.slice(-1800)}`);
    const parsed=parseCliResult(connection.adapter,result.stdout);
    if(parsed.usage)onEvent?.({type:'usage',usage:{...parsed.usage,source:connection.id}});
    else onEvent?.({type:'usage_unavailable',text:`${connection.name} 本次 CLI 未返回可核实的 token 用量`});
    return schema.parse(parsed.value);
  } finally {
    // Clear only the known files from this request; never remove a computed directory tree.
    for(const file of ['request.md','agent.yaml','system.md','settings.json','deny-tools.toml'])await fs.unlink(path.join(cwd,file)).catch(()=>{});
    await fs.rmdir(cwd).catch(()=>{});
  }
}
export async function probeConnection(c) {
  if(c.kind !== 'subscription-cli')return {state:'needs-inference-test',message:'密钥存在状态与推理可用性分别显示；请运行推理测试。'};
  try {
    const binary=c.adapter === 'codex' ? process.env.CODEX_BIN || c.binary || 'codex' : c.binary || c.adapter;
    const version=await runCli(binary,['--version'],{timeoutMs:12000});
    if(version.code !== 0)return {state:'cli-error',message:'CLI 启动失败，请检查安装与版本'};
    if(c.adapter === 'codex') {
      const auth=await runCli(binary,['login','status'],{timeoutMs:12000});
      return /ChatGPT/i.test(auth.stdout+auth.stderr) && auth.code === 0 ? {state:'login-detected',message:'检测到 ChatGPT 订阅登录；所选模型仍需推理测试'} : {state:'needs-login',message:'请运行 codex login 使用 ChatGPT 登录'};
    }
    if(c.adapter === 'claude') {
      const auth=await runCli(binary,['auth','status'],{timeoutMs:12000});
      let a;try{a=JSON.parse(auth.stdout);}catch{}
      return auth.code===0 && ['claude.ai','oauth_token'].includes(a?.authMethod) ? {state:'login-detected',message:'检测到 Claude Code OAuth 登录；模型权限需推理测试'} : {state:'needs-login',message:'请运行 claude auth login 使用 Claude 账号登录'};
    }
    return {state:'installed',message:'CLI 已安装；请完成对应账号登录，再运行推理测试确认模型权限。'};
  } catch(error) {return {state:'needs-install',message:error.message};}
}
