import path from 'node:path';
import fs from 'node:fs/promises';
import { createConfig } from '../server/config.js';
import { probeConnection } from '../server/cli.js';
import { ModelRuntime } from '../server/runtime.js';
import { riskSchema } from '../server/schema.js';

const root = path.resolve(import.meta.dirname,'..'), dataDir = path.join(root,'.piagent');
const config = createConfig(root,dataDir);
try {
  const cfg=config.get(),id=process.argv.find(a=>a.startsWith('--connection='))?.slice(13) || cfg.workflow.planner;
  const connection=cfg.connections.find(c=>c.id===id);if(!connection)throw new Error('Connection not found: '+id);
  console.log('Selected connection:',connection.name,connection.kind);
  console.log('Probe:',JSON.stringify(await probeConnection(connection)));
  console.log('Roles:',JSON.stringify(cfg.workflow));
  if (process.argv.includes('--inference')) {
    const cwd = path.join(dataDir,'connection-check'); await fs.mkdir(cwd,{recursive:true});
    const runtime=new ModelRuntime({config,dataDir});
    const result = await runtime.structured({connection,signal:AbortSignal.timeout(180000),schema:riskSchema,
      prompt:'This is a bounded PIagent model connection check. Do not call tools or read any files. Return exactly a JSON object with decision "ask" and reason "PIagent model connection verified".',
      onEvent:event => { if (event.type === 'usage') console.log('Reported usage:',JSON.stringify(event.usage)); }});
    console.log('Structured inference:',JSON.stringify(result));
  }
} catch(error) { console.error(config.redact(error.message)); process.exitCode = 1; }
