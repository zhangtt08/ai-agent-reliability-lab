/**
 * 本地开发编排：同时起 API（8787）与 Vite（5173）。
 * 注意：本文件必须是纯 JavaScript（.mjs 由 node 直接执行，不经 tsx）。
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const children = [];

function run(name, args, color) {
  const child = spawn(node, args, {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const tag = `${color}[${name}]`;
  child.stdout.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) console.log(`${tag} ${line}`);
  });
  child.stderr.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) console.error(`${tag} ${line}`);
  });
  child.on('exit', (code) => {
    console.log(`${tag} exited with ${code}`);
    // 任一子进程异常退出时整体退出，避免"半死不活"的开发环境
    if (code !== 0 && code !== null) shutdown(code);
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('[dev] starting api (http://localhost:8787) + web (http://localhost:5173)');
run('api', [tsxCli, 'apps/server/src/main.ts'], '\x1b[36m');
run('web', [viteBin, '--config', 'apps/web/vite.config.ts'], '\x1b[35m');
