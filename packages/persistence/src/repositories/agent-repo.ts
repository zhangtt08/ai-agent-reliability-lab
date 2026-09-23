import {
  AgentVersionSchema,
  AgentSchema,
  PromptVersionSchema,
  contentHash,
  ids,
  nowIso,
  type Agent,
  type AgentVersion,
  type AgentVersionStatus,
  type KnowledgeConfigInput,
  type ModelConfigInput,
  type PromptVariable,
  type PromptVersion,
  type RuntimeConfigInput,
  type ToolDefinitionInput,
} from '@arl/shared';
import type { SqlDriver } from '../driver';
import { and, countRows, insertInto, selectAll, selectOne, updateById } from '../repo-utils';

export interface CreateAgentInput {
  name: string;
  description?: string;
  tags?: string[];
  status?: Agent['status'];
}

export interface CreatePromptVersionInput {
  agentId: string;
  systemPrompt: string;
  taskPromptTemplate: string;
  variables?: PromptVariable[];
  label?: string;
  notes?: string;
  createdBy?: string;
}

export interface CreateAgentVersionInput {
  agentId: string;
  promptVersionId: string;
  modelConfig: ModelConfigInput;
  runtimeConfig: RuntimeConfigInput;
  tools?: ToolDefinitionInput[];
  knowledge?: KnowledgeConfigInput | null;
  runtimeKind?: AgentVersion['runtimeKind'];
  fixtureId?: string;
  label?: string;
  notes?: string;
  status?: AgentVersionStatus;
  createdBy?: string;
}

export function createAgentRepository(driver: SqlDriver) {
  const TABLE = 'agents';

  return {
    create(input: CreateAgentInput): Agent {
      const now = nowIso();
      const agent: Agent = AgentSchema.parse({
        id: ids.agent(),
        name: input.name,
        description: input.description ?? '',
        status: input.status ?? 'active',
        tags: input.tags ?? [],
        createdAt: now,
        updatedAt: now,
      });
      insertInto(driver, TABLE, agent);
      return agent;
    },

    get(id: string): Agent | undefined {
      return selectOne<Agent>(driver, TABLE, { where: 'id = ?', params: [id] });
    },

    list(options: { status?: string; limit?: number; offset?: number } = {}): Agent[] {
      return selectAll<Agent>(driver, TABLE, {
        where: options.status ? 'status = ?' : undefined,
        params: options.status ? [options.status] : [],
        orderBy: 'created_at DESC',
        limit: options.limit,
        offset: options.offset,
      });
    },

    count(): number {
      return countRows(driver, TABLE);
    },

    update(id: string, patch: Partial<Pick<Agent, 'name' | 'description' | 'tags' | 'status'>>): number {
      return updateById(driver, TABLE, id, { ...patch, updatedAt: nowIso() });
    },
  };
}

export function createPromptRepository(driver: SqlDriver) {
  const TABLE = 'prompt_versions';

  return {
    /** Prompt 正文哈希自动计算；同内容重复创建会得到相同 hash，便于断言「只改 Prompt」 */
    create(input: CreatePromptVersionInput): PromptVersion {
      const existing = selectAll<PromptVersion>(driver, TABLE, {
        where: 'agent_id = ?',
        params: [input.agentId],
        orderBy: 'version DESC',
        limit: 1,
      });
      const version = (existing[0]?.version ?? 0) + 1;
      const hash = contentHash(`${input.systemPrompt}\u0000${input.taskPromptTemplate}`);
      const prompt: PromptVersion = PromptVersionSchema.parse({
        id: ids.promptVersion(),
        agentId: input.agentId,
        version,
        label: input.label ?? `v${version}`,
        systemPrompt: input.systemPrompt,
        taskPromptTemplate: input.taskPromptTemplate,
        variables: input.variables ?? [],
        hash,
        notes: input.notes ?? '',
        createdBy: input.createdBy ?? 'system',
        createdAt: nowIso(),
      });
      insertInto(driver, TABLE, prompt);
      return prompt;
    },

    get(id: string): PromptVersion | undefined {
      return selectOne<PromptVersion>(driver, TABLE, { where: 'id = ?', params: [id] });
    },

    listByAgent(agentId: string): PromptVersion[] {
      return selectAll<PromptVersion>(driver, TABLE, {
        where: 'agent_id = ?',
        params: [agentId],
        orderBy: 'version DESC',
      });
    },

    latest(agentId: string): PromptVersion | undefined {
      return selectAll<PromptVersion>(driver, TABLE, {
        where: 'agent_id = ?',
        params: [agentId],
        orderBy: 'version DESC',
        limit: 1,
      })[0];
    },

    /** 只允许改 label/notes —— 正文有数据库触发器兜底 */
    updateMeta(id: string, patch: { label?: string; notes?: string }): number {
      return updateById(driver, TABLE, id, patch);
    },
  };
}

export function createAgentVersionRepository(driver: SqlDriver) {
  const TABLE = 'agent_versions';

  return {
    create(input: CreateAgentVersionInput): AgentVersion {
      const previous = selectAll<AgentVersion>(driver, TABLE, {
        where: 'agent_id = ?',
        params: [input.agentId],
        orderBy: 'version DESC',
        limit: 1,
      });
      const version = (previous[0]?.version ?? 0) + 1;
      const record: AgentVersion = AgentVersionSchema.parse({
        id: ids.agentVersion(),
        agentId: input.agentId,
        version,
        label: input.label ?? `v${version}.0`,
        status: input.status ?? 'draft',
        promptVersionId: input.promptVersionId,
        modelConfig: input.modelConfig,
        tools: input.tools ?? [],
        knowledge: input.knowledge ?? null,
        runtimeConfig: input.runtimeConfig,
        runtimeKind: input.runtimeKind ?? 'tool-calling',
        fixtureId: input.fixtureId ?? '',
        notes: input.notes ?? '',
        createdBy: input.createdBy ?? 'system',
        createdAt: nowIso(),
      });
      insertInto(driver, TABLE, record);
      return record;
    },

    get(id: string): AgentVersion | undefined {
      return selectOne<AgentVersion>(driver, TABLE, { where: 'id = ?', params: [id] });
    },

    listByAgent(agentId: string): AgentVersion[] {
      return selectAll<AgentVersion>(driver, TABLE, {
        where: 'agent_id = ?',
        params: [agentId],
        orderBy: 'version DESC',
      });
    },

    latest(agentId: string): AgentVersion | undefined {
      return selectAll<AgentVersion>(driver, TABLE, {
        where: 'agent_id = ?',
        params: [agentId],
        orderBy: 'version DESC',
        limit: 1,
      })[0];
    },

    find(agentId: string, version: number): AgentVersion | undefined {
      return selectOne<AgentVersion>(driver, TABLE, {
        where: and('agent_id = ?', 'version = ?'),
        params: [agentId, version],
      });
    },

    /** 仅状态/标签/备注可变；配置变更会被数据库触发器拒绝 */
    setStatus(id: string, status: AgentVersionStatus, patch: { label?: string; notes?: string } = {}): number {
      return updateById(driver, TABLE, id, { status, ...patch });
    },

    count(): number {
      return countRows(driver, TABLE);
    },
  };
}
