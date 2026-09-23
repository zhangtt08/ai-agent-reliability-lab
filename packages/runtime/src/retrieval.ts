import { round, type KnowledgeDocument, type RetrievedDocument } from '@arl/shared';

/**
 * 检索实现（确定性，可复现）。
 * 两种模式：
 *  - keyword：BM25 风格词频打分（CJK 二元切分 + 拉丁词）
 *  - mock-vector：字符 trigram 哈希伪向量 + 余弦相似度
 * 都不依赖外部 embedding 服务，但**排名与分数是真实计算的**，不是编造的。
 */

export type RetrievalMode = 'keyword' | 'mock-vector';

export interface RetrievalOptions {
  topK: number;
  mode: RetrievalMode;
  scoreThreshold: number;
  /** 伪造检索耗时（真实落进 trace 的 latency） */
  simulatedLatencyMs?: number;
}

export interface RetrievalOutcome {
  documents: RetrievedDocument[];
  selectedChunks: string[];
  status: 'ok' | 'empty' | 'error';
  mode: RetrievalMode;
}

const STOPWORDS = new Set([
  '请问',
  '我的',
  '一下',
  '为什么',
  '怎么办',
  '怎么',
  '如何',
  '是否',
  '可以',
  '请',
  '帮',
  '我',
  '的',
  '了',
  '呢',
  '吗',
  '这个',
  '那个',
]);

/** 关键词/同义词扩展表：宽口径召回，避免字面匹配漏召回 */
const SYNONYMS: { re: RegExp; terms: string[] }[] = [
  { re: /(重复扣款|多扣|扣了两次|扣款两次)/, terms: ['重复扣款', '退款', '订单', '流水'] },
  { re: /(退款)/, terms: ['退款', '原路退回', '政策'] },
  { re: /(订单|ord-\d+)/i, terms: ['订单', '订单号', '状态'] },
  { re: /(余额)/, terms: ['余额', '账户', '充值'] },
  { re: /(会员|等级)/, terms: ['会员', '等级', '权益'] },
  { re: /(运费|价格|多少钱|报价)/, terms: ['价格', '运费', '包邮'] },
  { re: /(工单|客服|人工)/, terms: ['工单', '人工客服', '升级'] },
];

/** 查询改写：去口语化 + 同义扩展。结果会原样记录进 RetrievalEvent.rewrittenQuery。 */
export function rewriteQuery(query: string): string {
  const cleaned = query
    .replace(/[，。！？、；：""''（）()\[\]{}]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .join(' ')
    .trim();
  const extra = new Set<string>();
  for (const rule of SYNONYMS) {
    if (rule.re.test(query)) rule.terms.forEach((t) => extra.add(t));
  }
  return [cleaned, ...extra].join(' ').replace(/\s+/g, ' ').trim();
}

/** CJK 二元切分 + 拉丁单词：对中文检索比空格切词靠谱得多 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  for (const word of lower.match(/[a-z0-9][a-z0-9_.-]*/g) ?? []) tokens.push(word);
  const cjkOnly = lower.replace(/[^\u4e00-\u9fff]+/g, ' ');
  for (const run of cjkOnly.split(/\s+/)) {
    if (run.length === 1) tokens.push(run);
    for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

export function keywordScore(query: string, doc: KnowledgeDocument, corpus: KnowledgeDocument[]): number {
  const qTokens = new Set(tokenize(rewriteQuery(query)));
  if (qTokens.size === 0) return 0;
  const docTokens = tokenize(`${doc.title} ${doc.content} ${doc.tags.join(' ')}`);
  const tf = termFrequency(docTokens);
  const N = corpus.length || 1;

  let score = 0;
  for (const term of qTokens) {
    const freq = tf.get(term) ?? 0;
    if (freq === 0) continue;
    const docsWithTerm = corpus.filter((d) => tokenize(`${d.title} ${d.content}`).includes(term)).length || 1;
    const idf = Math.log(1 + (N - docsWithTerm + 0.5) / (docsWithTerm + 0.5));
    // BM25 简化式（k1=1.2, b=0.75，平均长度按语料估算）
    const avgLen = 60;
    const lenNorm = 1 - 0.75 + (0.75 * docTokens.length) / avgLen;
    score += idf * ((freq * 2.2) / (freq + 1.2 * lenNorm)) * 2;
  }
  // 标题命中额外加权：标题往往是最强的相关性信号
  for (const term of qTokens) {
    if (doc.title.toLowerCase().includes(term)) score += 1.5;
  }
  return round(score, 4);
}

/** 字符 trigram 哈希伪向量（64 维），完全确定性 */
function embed(text: string, dims = 64): number[] {
  const vec = new Array<number>(dims).fill(0);
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  for (let i = 0; i < normalized.length; i += 1) {
    const tri = normalized.slice(i, i + 3);
    if (tri.length < 3) break;
    let h = 2166136261;
    for (const ch of tri) {
      h ^= ch.codePointAt(0) ?? 0;
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i]! * b[i]!;
  return dot;
}

export function vectorScore(query: string, doc: KnowledgeDocument): number {
  return round(cosine(embed(rewriteQuery(query)), embed(`${doc.title} ${doc.content}`)), 4);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？.!?])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4);
}

function selectChunks(query: string, doc: KnowledgeDocument, limit = 2): string[] {
  const qTokens = new Set(tokenize(rewriteQuery(query)));
  const scored = splitSentences(doc.content).map((sentence) => {
    const tokens = tokenize(sentence);
    const hit = tokens.filter((t) => qTokens.has(t)).length;
    return { sentence, score: hit / (tokens.length || 1) + hit * 0.1 };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.sentence);
}

export function retrieve(
  query: string,
  documents: KnowledgeDocument[],
  options: RetrievalOptions,
): RetrievalOutcome {
  if (documents.length === 0) {
    return { documents: [], selectedChunks: [], status: 'empty', mode: options.mode };
  }
  const rewritten = rewriteQuery(query);
  const ranked = documents
    .map((doc) => {
      const score = options.mode === 'keyword' ? keywordScore(query, doc, documents) : vectorScore(query, doc);
      return { doc, score };
    })
    .filter((r) => r.score > options.scoreThreshold)
    .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
    .slice(0, options.topK)
    .map((r, index): RetrievedDocument => {
      const chunks = selectChunks(query, r.doc);
      return {
        id: r.doc.id,
        title: r.doc.title,
        source: r.doc.source,
        score: r.score,
        rank: index + 1,
        selected: true,
        selectedChunk: chunks[0] ?? r.doc.content.slice(0, 160),
      };
    });

  const selectedChunks = ranked.flatMap((d) => (d.selectedChunk ? [d.selectedChunk] : []));
  return {
    documents: ranked,
    selectedChunks,
    status: ranked.length === 0 ? 'empty' : 'ok',
    mode: options.mode,
  };
}

/** 检索质量指标（Recall@K / Hit@K）：有 ground truth 时可用 */
export function recallAtK(retrievedIds: string[], expectedIds: string[]): number | null {
  if (expectedIds.length === 0) return null;
  const hit = expectedIds.filter((id) => retrievedIds.includes(id)).length;
  return round(hit / expectedIds.length, 4);
}

export function hitAtK(retrievedIds: string[], expectedIds: string[]): number | null {
  if (expectedIds.length === 0) return null;
  return expectedIds.some((id) => retrievedIds.includes(id)) ? 1 : 0;
}

export { splitSentences };
