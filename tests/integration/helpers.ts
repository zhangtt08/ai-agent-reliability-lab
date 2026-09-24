import type { RunConfigInput } from '@arl/shared';

/** 集成测试统一使用低延迟 mock + 小并发，保证速度与确定性 */
export const RUN_CONFIG: RunConfigInput = {
  concurrency: 3,
  timeoutMs: 20_000,
  retries: 0,
  mode: 'full',
  seed: 42,
  promptPrivacy: 'store_full',
  smokeLimit: 5,
};
