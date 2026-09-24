/**
 * Dogfooding：用平台自己的 Fixture Agents 跑通整条评测链，验证「平台真的能发现问题」。
 *
 * 运行：node --import tsx scripts/dogfood.ts   （或 npx tsx scripts/dogfood.ts）
 * 输出：每个 fixture × 数据集的通过情况 + 失败分类 + 回归 + 门禁结论
 */
import { openStore } from '@arl/persistence';
import { createMockModelProvider } from '@arl/providers';
import { executeEvaluationRun, analyzeRun } from '../apps/server/src/services/run-pipeline';
import { seedDemoData } from '../apps/server/src/services/seed';

const jsonOutput = process.argv.includes('--json');

async function main() {
  const store = openStore({ memory: true });
  const summary = seedDemoData(store);
  const provider = createMockModelProvider({ latencyScale: 0.05, baseLatencyMs: 1 });

  const fullSet = store.evaluatorSets.findByName('Full（发布门禁评测）');
  if (!fullSet) throw new Error('种子数据缺少 Full 评测集');

  const rows: {
    fixture: string;
    dataset: string;
    runId: string;
    passed: number;
    total: number;
    verdicts: string;
    categories: string;
    gate: string;
  }[] = [];

  const toolCallingDataset = summary.datasets.find((d) => d.name === 'Tool Calling')!;
  const supportDataset = summary.datasets.find((d) => d.name === 'Customer Support')!;
  const knowledgeDataset = summary.datasets.find((d) => d.name === 'Knowledge QA')!;

  const plan: { fixture: string; datasetId: string }[] = [];
  for (const dataset of summary.datasets) {
    for (const agent of summary.agents) {
      // 回归演示只需要在 Customer Support 上跑两个版本即可，避免重复
      if (agent.fixtureId === 'regression-v2-agent') continue; // 只在回归演示里跑（避免重复）
      if (agent.fixtureId === 'slow-agent' && dataset.name === 'Tool Calling') continue;
      plan.push({ fixture: agent.fixtureId, datasetId: dataset.id });
    }
  }

  for (const item of plan) {
    const agent = summary.agents.find((a) => a.fixtureId === item.fixture)!;
    const dataset = summary.datasets.find((d) => d.id === item.datasetId)!;
    const result = await executeEvaluationRun(store, {
      agentVersionId: agent.versionId,
      datasetVersionId: dataset.versionId,
      evaluatorSetId: fullSet.id,
      provider,
      runConfig: { concurrency: 4, timeoutMs: 20000, retries: 0, mode: 'full', seed: 42, promptPrivacy: 'store_full', smokeLimit: 5 },
      triggeredBy: 'dogfood',
    });

    const verdicts = result.caseRuns.map((c) => `${c.testCaseName}=${c.status}`).join(' | ');
    const categories = result.failures.map((f) => f.category).join(',');
    rows.push({
      fixture: item.fixture,
      dataset: dataset.name,
      runId: result.run.id,
      passed: result.caseRuns.filter((c) => c.status === 'passed').length,
      total: result.caseRuns.length,
      verdicts,
      categories: categories || '-',
      gate: result.gateDecision ? `${result.gateDecision.result}（${result.gateDecision.blockingFailures} 阻断）` : 'n/a',
    });

    // 回归演示：把 stable 的第一次 run 标为 baseline，再跑 V2
    if (item.fixture === 'stable-agent' && dataset.name === 'Customer Support') {
      store.runs.setBaseline(result.run.id, true);
      const v2 = summary.agents.find((a) => a.fixtureId === 'regression-v2-agent')!;
      const v2Run = await executeEvaluationRun(store, {
        agentVersionId: v2.versionId,
        datasetVersionId: dataset.versionId,
        evaluatorSetId: fullSet.id,
        provider,
        runConfig: { concurrency: 4, timeoutMs: 20000, retries: 0, mode: 'full', seed: 42, promptPrivacy: 'store_full', smokeLimit: 5 },
        triggeredBy: 'dogfood-regression',
        baselineRunId: result.run.id,
      });
      const regressions = store.regressions.listByRun(v2Run.run.id);
      rows.push({
        fixture: 'regression-v2-agent',
        dataset: `${dataset.name}（vs baseline）`,
        runId: v2Run.run.id,
        passed: v2Run.caseRuns.filter((c) => c.status === 'passed').length,
        total: v2Run.caseRuns.length,
        verdicts: v2Run.caseRuns.map((c) => `${c.testCaseName}=${c.status}`).join(' | '),
        categories: v2Run.failures.map((f) => f.category).join(',') || '-',
        gate: v2Run.gateDecision ? `${v2Run.gateDecision.result}（${v2Run.gateDecision.blockingFailures} 阻断）` : 'n/a',
      });
      const strictGate = store.gates.listGates(agent.id).find((g) => g.name.startsWith('Strict'));
      if (strictGate) {
        const strict = analyzeRun(store, v2Run.run.id, { gateId: strictGate.id, baselineRunId: result.run.id, generateSuggestions: false });
        console.log(
          `\n[回归] baseline=stable-agent  V2=${v2Run.caseRuns.filter((c) => c.status === 'passed').length}/${v2Run.caseRuns.length}  ` +
            `检出回归 ${regressions.length} 条 → ${regressions.map((r) => r.description).join('; ') || '无'}`,
        );
        console.log(`[严格门禁 95%] ${strict.gateDecision?.result} —— ${strict.gateDecision?.explanation}`);
      }
    }
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ rows }, null, 2));
  } else {
    console.log('\n═══ Dogfood 结果矩阵 ═══');
    const width = 24;
    for (const row of rows) {
      const flag = row.passed === row.total ? '✅' : '❌';
      console.log(
        `${flag} ${row.fixture.padEnd(width)} ${row.dataset.padEnd(30)} ${row.passed}/${row.total}  失败类型: ${row.categories}  门禁: ${row.gate}`,
      );
    }

    const detail = process.argv.includes('--detail');
    if (detail) {
      for (const row of rows) {
        console.log(`\n--- ${row.fixture} @ ${row.dataset} ---`);
        const caseRuns = store.runs.listCaseRuns(row.runId, { limit: 100 });
        for (const c of caseRuns) {
          console.log(`  ${c.status === 'passed' ? '✓' : '✗'} ${c.testCaseName} [${c.status}] ${c.failureCategory ?? ''}`);
          if (c.status !== 'passed') {
            const results = store.evalResults.listByCaseRun(c.id).filter((r) => r.status === 'fail' || r.status === 'partial');
            for (const r of results) console.log(`      · ${r.evaluatorKey}: ${r.message.slice(0, 160)}`);
            const failures = store.failures.listByCaseRun(c.id);
            for (const f of failures) console.log(`      → 归因 ${f.category}（置信 ${f.confidence}）: ${f.explanation.slice(0, 180)}`);
          }
        }
      }
    }

    const suggestions = store.suggestions.listAll(20);
    console.log('\n═══ 优化建议（Top 5）═══');
    for (const s of suggestions.slice(0, 5)) {
      console.log(`- [${s.category}] ${s.title}`);
      console.log(`  证据 ${s.evidence.length} 条，影响用例 ${s.affectedCases.length} 个`);
    }
  }

  store.close();
  void toolCallingDataset;
  void supportDataset;
  void knowledgeDataset;
}

main().catch((err) => {
  console.error('dogfood 失败：', err);
  process.exit(1);
});
