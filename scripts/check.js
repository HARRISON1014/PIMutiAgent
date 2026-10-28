import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
let failed = false;
for (const dir of ['server', 'public', 'scripts', 'test']) {
  for (const file of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(dir, file)], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) { failed = true; process.stderr.write(result.stderr || result.error?.message || 'check failed'); }
  }
}
if (failed) process.exit(1);
process.stdout.write('All JavaScript syntax checks passed.\n');
