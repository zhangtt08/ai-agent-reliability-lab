import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 本地开发编排：同时起 API（8787）与 Vite（5173）。
 * 不引入 concurrently 这类依赖 —— 用 child_process 就够了。
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const children: ChildProcess[] = [];

function run(name: string, args: string[], color: string) {
  const child = spawn(node, args, {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  const tag = `${color}[${name}]`;
  child.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) console.log(`${tag} ${line}`);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) console.error(`${tag} ${line}`);
  });
  child.on('exit', (code) => {
    console.log(`${tag} exited with ${code}`);
    if (code !== 0 && code !== null) {
      shutdown(code);
    }
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
