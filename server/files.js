import fs from 'node:fs/promises';
import path from 'node:path';

const blocked = /^(?:\.git|\.piagent|\.aws|\.ssh|node_modules|\.env(?:\..*)?|auth\.json|secrets\.json)$/i;
export async function confined(root, relative = '.', { write = false } = {}) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes(':') || relative.includes('\0')) throw new Error('仅支持工作区内的相对路径');
  const parts = relative.split(/[\\/]/).filter(v => v && v !== '.');
  // Win32 normalizes trailing spaces/dots and reserves device names; reject aliases before IO.
  if (parts.some(p => p === '..' || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(p) || blocked.test(p))) throw new Error('路径受保护或越出工作区');
  const realRoot = await fs.realpath(root);
  let target = realRoot;
  for (const part of parts) {
    target = path.join(target, part);
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) throw new Error('不允许访问符号链接或目录联接');
    } catch (error) { if (error.code !== 'ENOENT') throw error; if (!write) throw error; }
  }
  return target;
}
export async function listFiles(root, relative = '.') {
  const target = await confined(root, relative);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries.filter(e => !blocked.test(e.name) && !e.isSymbolicLink()).slice(0, 200).map(e => ({ name: e.name, directory: e.isDirectory() }));
}
export async function readText(root, relative) {
  const file = await confined(root, relative), stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 128000) throw new Error('只能读取不超过 128 KB 的文本文件');
  const value = await fs.readFile(file, 'utf8');
  if (value.includes('\0')) throw new Error('文件不是文本');
  return value;
}
export async function writeText(root, relative, content) {
  if (Buffer.byteLength(content) > 128000) throw new Error('单个文件不能超过 128 KB');
  const file = await confined(root, relative, { write: true });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, { flag: 'w' });
  return { path: relative.replaceAll('\\', '/'), bytes: Buffer.byteLength(content) };
}
