import type { ProviderInfo } from '@arl/shared';
import { createMockModelProvider, type MockModelProvider } from './mock-provider';
import { createOpenAiCompatibleProvider } from './openai-compatible';
import type { ModelProvider } from './types';

export interface ProviderRegistry {
  get(id: string): ModelProvider;
  list(): ProviderInfo[];
  register(provider: ModelProvider): void;
  has(id: string): boolean;
  /** 默认 provider：无 API Key 时必定是 mock */
  defaultProvider(): ModelProvider;
}

export interface CreateRegistryOptions {
  mock?: MockModelProvider;
  /** 预留：真实 provider 只在配置了凭据时才注册为 available */
  openAiCompatible?: { baseUrl: string; apiKey?: string; models?: string[] };
  env?: NodeJS.ProcessEnv;
}

/**
 * Provider 注册表 —— Provider 插件化的落地。
 * 新增一个 provider 只需实现 `ModelProvider` 并 register，核心系统无需改动。
 */
export function createProviderRegistry(options: CreateRegistryOptions = {}): ProviderRegistry {
  const env = options.env ?? process.env;
  const providers = new Map<string, ModelProvider>();

  const mock = options.mock ?? createMockModelProvider();
  providers.set(mock.id, mock);

  const baseUrl = options.openAiCompatible?.baseUrl ?? env['ARL_OPENAI_BASE_URL'];
  const apiKey = options.openAiCompatible?.apiKey ?? env['ARL_OPENAI_API_KEY'];
  if (baseUrl) {
    const provider = createOpenAiCompatibleProvider({
      id: 'openai-compatible',
      baseUrl,
      apiKey,
      models: options.openAiCompatible?.models,
    });
    providers.set(provider.id, provider);
  }

  /**
   * 未配置凭据的 provider 也会登记 info（available=false），
   * 让 UI 能如实展示「有哪些 provider、为什么不可用」，而不是假装什么都没有。
   */
  const declared: ProviderInfo[] = [
    { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', available: false, requiresApiKey: true, isMock: false, models: ['claude-sonnet-4-5'], note: '未接入：需要 ARL_ANTHROPIC_API_KEY（P2）' },
    { id: 'openai', name: 'OpenAI', kind: 'openai', available: false, requiresApiKey: true, isMock: false, models: ['gpt-4o-mini'], note: '未接入：可通过 openai-compatible + ARL_OPENAI_BASE_URL 使用（P2）' },
    { id: 'gemini', name: 'Google Gemini', kind: 'gemini', available: false, requiresApiKey: true, isMock: false, models: ['gemini-2.0-flash'], note: '未接入（P2）' },
    { id: 'local', name: 'Local Model (Ollama/LM Studio)', kind: 'local', available: false, requiresApiKey: false, isMock: false, models: [], note: '未接入：可用 openai-compatible 指向本地端点（P2）' },
  ];

  return {
    get(id) {
      const provider = providers.get(id);
      if (!provider) {
        throw new Error(`provider "${id}" 未注册。可用：${[...providers.keys()].join(', ')}`);
      }
      return provider;
    },
    list() {
      const registered = [...providers.values()].map((p) => p.info);
      const declaredMissing = declared.filter((d) => !providers.has(d.id));
      return [...registered, ...declaredMissing];
    },
    register(provider) {
      providers.set(provider.id, provider);
    },
    has(id) {
      return providers.has(id);
    },
    defaultProvider() {
      return providers.get('mock')!;
    },
  };
}

/** 按 ModelConfig 选 provider：找不到就明确报错，绝不静默降级到 mock */
export function resolveProvider(registry: ProviderRegistry, providerId: string): ModelProvider {
  if (!registry.has(providerId)) {
    const info = registry.list().find((p) => p.id === providerId);
    if (info && !info.available) {
      throw new Error(`provider "${providerId}" 已声明但不可用：${info.note}`);
    }
    throw new Error(`provider "${providerId}" 未注册`);
  }
  return registry.get(providerId);
}
