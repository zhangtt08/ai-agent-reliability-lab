import { createHash, randomUUID } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** 单调递增计数器，保证同毫秒内 id 也可排序 */
let lastTime = 0;
let counter = 0;

/**
 * 生成可排序、无歧义前缀的 id：`<prefix>_<time36><counter36><rand>`。
 * 示例：`ag_kq2f1b7x9d3a`
 */
export function newId(prefix: string): string {
  const now = Date.now();
  if (now === lastTime) {
    counter += 1;
  } else {
    lastTime = now;
    counter = 0;
  }
  let rand = '';
  const bytes = randomUUID().replace(/-/g, '');
  for (let i = 0; i < 6; i += 1) {
    rand += ALPHABET[Number.parseInt(bytes.slice(i * 2, i * 2 + 2), 16) % ALPHABET.length];
  }
  const time = now.toString(36);
  const cnt = counter.toString(36).padStart(2, '0');
  return `${prefix}_${time}${cnt}${rand}`;
}

export const ids = {
  agent: () => newId('ag'),
  agentVersion: () => newId('agv'),
  promptVersion: () => newId('pv'),
  toolDefinition: () => newId('tool'),
  knowledge: () => newId('kb'),
  dataset: () => newId('ds'),
  datasetVersion: () => newId('dsv'),
  testCase: () => newId('tc'),
  evaluatorSet: () => newId('eset'),
  run: () => newId('run'),
  caseRun: () => newId('cr'),
  trace: () => newId('tr'),
  traceStep: () => newId('st'),
  modelCall: () => newId('mc'),
  toolCall: () => newId('tcl'),
  retrieval: () => newId('rtv'),
  evaluationResult: () => newId('eres'),
  metric: () => newId('met'),
  failure: () => newId('fail'),
  humanReview: () => newId('hr'),
  gate: () => newId('gate'),
  regression: () => newId('reg'),
  decision: () => newId('dec'),
  suggestion: () => newId('sug'),
  job: () => newId('job'),
  artifact: () => newId('art'),
  experiment: () => newId('exp'),
  baseline: () => newId('base'),
  comparison: () => newId('cmp'),
  rubric: () => newId('rub'),
  promptCandidate: () => newId('pcand'),
};

export function nowIso(): string {
  return new Date().toISOString();
}

/** 稳定哈希（SHA-256 前 16 hex），用于 Prompt / Dataset 内容指纹 */
export function contentHash(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16);
}
