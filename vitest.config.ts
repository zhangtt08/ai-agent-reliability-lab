import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@arl/shared': resolve(root, 'packages/shared/src/index.ts'),
      '@arl/persistence': resolve(root, 'packages/persistence/src/index.ts'),
      '@arl/providers': resolve(root, 'packages/providers/src/index.ts'),
      '@arl/runtime': resolve(root, 'packages/runtime/src/index.ts'),
      '@arl/evaluation': resolve(root, 'packages/evaluation/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    /**
     * 必须串行执行测试文件。
     * 本机实测：vitest 2.1 的文件级并发会让它在模块加载时并发写 `<tmpdir>/<id>/ssr/<hash>`
     * 缓存文件，触发 EPERM 并导致部分测试文件被静默跳过（收集不完整 = 假绿）。
     * 串行后 122/122 稳定通过。若在其它环境追求速度，可临时用 CLI 覆盖。
     */
    fileParallelism: false,
    reporters: ['default'],
  },
});
