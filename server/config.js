import fs from 'node:fs';
import path from 'node:path';
import { normalizeConfig } from './schema.js';

export function createConfig(root, dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'config.json');
  let current = normalizeConfig(JSON.parse(fs.readFileSync(fs.existsSync(file) ? file : path.join(root, 'config.example.json'), 'utf8')));
  const secretsFile = path.join(dataDir, 'secrets.json');
  let secrets = fs.existsSync(secretsFile) ? JSON.parse(fs.readFileSync(secretsFile, 'utf8')) : {};
  function key(env) { return secrets[env] || process.env[env] || ''; }
  return {
    get: () => structuredClone(current), key,
    public: () => ({ ...structuredClone(current), connections: current.connections.map(c => ({ ...c, configured: c.kind === 'subscription-cli' ? false : !!key(c.apiKeyEnv), credentialState: c.kind === 'subscription-cli' ? 'cli-login-required' : key(c.apiKeyEnv) ? 'key-present' : 'key-required' })) }),
    redact(value) {
      let result = String(value);
      for (const name of new Set([...Object.keys(secrets), ...current.connections.map(w => w.apiKeyEnv)])) {
        const secret = key(name); if (secret) result = result.split(secret).join('[REDACTED]');
      }
      return result.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
    },
    save(value) {
      const next = normalizeConfig(value);
      for (const [name, secret] of Object.entries(value.keys || {})) {
        if (!next.connections.some(w => w.kind !== 'subscription-cli' && w.apiKeyEnv === name) || typeof secret !== 'string' || secret.length > 4096) throw new Error('无效密钥字段');
        if (secret.trim()) secrets[name] = secret.trim();
      }
      fs.writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
      fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2)); fs.renameSync(file + '.tmp', file);
      current = next;
      return this.public();
    },
  };
}
