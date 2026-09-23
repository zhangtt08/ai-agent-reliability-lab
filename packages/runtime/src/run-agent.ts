import type { AgentVersion } from '@arl/shared';
import { createSimplePromptAgent } from './agents/simple-prompt-agent';
import { createToolCallingAgent } from './agents/tool-calling-agent';
import type { AgentRunResult, AgentRuntime, RuntimeInput } from './types';

export interface RuntimeRegistry {
  get(id: string): AgentRuntime;
  list(): { id: string; kind: AgentVersion['runtimeKind'] }[];
  register(runtime: AgentRuntime): void;
}

/**
 * AgentRuntime 注册表 —— Runtime 插件化。
 * 未来接外部 Agent（HTTP / CLI）时，实现 `AgentRuntime` 接口再 register 即可，
 * 评测流水线、Trace、指标全部无需改动。
 */
export function createRuntimeRegistry(): RuntimeRegistry {
  const runtimes = new Map<string, AgentRuntime>();
  const toolCalling = createToolCallingAgent();
  const simplePrompt = createSimplePromptAgent();
  runtimes.set(toolCalling.id, toolCalling);
  runtimes.set(simplePrompt.id, simplePrompt);

  return {
    get(id) {
      const runtime = runtimes.get(id);
      if (!runtime) throw new Error(`runtime "${id}" 未注册。可用：${[...runtimes.keys()].join(', ')}`);
      return runtime;
    },
    list: () => [...runtimes.values()].map((r) => ({ id: r.id, kind: r.kind })),
    register(runtime) {
      runtimes.set(runtime.id, runtime);
    },
  };
}

/**
 * 按 AgentVersion 解析运行时。
 * 注意：`fixture` 类 agent **不是**绕过 runtime 的假结果 ——
 * 它们用的是真实的 tool-calling 循环，只是"大脑"由 MockModelProvider 的确定性脚本扮演。
 */
export function resolveRuntime(version: AgentVersion, registry: RuntimeRegistry): AgentRuntime {
  switch (version.runtimeKind) {
    case 'simple-prompt':
      return registry.get('simple-prompt-agent');
    case 'tool-calling':
    case 'fixture':
      return registry.get('tool-calling-agent');
    default: {
      const exhaustive: never = version.runtimeKind;
      throw new Error(`未知 runtimeKind: ${String(exhaustive)}`);
    }
  }
}

/** 硬超时：即使 runtime 内部逻辑卡住（例如工具不返回），评测也不会挂死 */
export async function runWithHardTimeout(
  runtime: AgentRuntime,
  input: RuntimeInput,
  timeoutMs: number,
): Promise<AgentRunResult> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<AgentRunResult>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        status: 'timeout',
        stopReason: 'timeout',
        finalOutput: '',
        outputJson: null,
        bundle: {
          trace: {
            id: `tr_timeout_${input.testCase.id}`,
            caseRunId: input.testCase.id,
            status: 'incomplete',
            stepCount: 0,
            totalDurationMs: timeoutMs,
            redactionPolicy: input.version.runtimeConfig.promptPrivacy,
            createdAt: new Date().toISOString(),
          },
          steps: [],
          modelCalls: [],
          toolCalls: [],
          retrievals: [],
        },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: null, costSource: 'unknown' },
        durationMs: timeoutMs,
        modelLatencyMs: 0,
        toolLatencyMs: 0,
        retrievalLatencyMs: 0,
        error: `硬超时：超过 ${timeoutMs}ms 未返回`,
        observations: [],
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([runtime.run(input), guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
