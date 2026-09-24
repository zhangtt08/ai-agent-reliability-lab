/**
 * E2E 主流程（规格 §90）。
 *
 * 铁律（用户红线）：绝不执行 `playwright install` —— 那会静默删除本机已有的浏览器。
 * 这里只复用 %LOCALAPPDATA%\ms-playwright 下已存在的 Chromium；找不到就明确报错退出（exit 2）。
 *
 * 运行：npm run test:e2e
 * 页面交互用的 id 全部先从 API 取真实值，避免选择器与渲染顺序耦合。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env['ARL_E2E_PORT'] ?? 8799);
const base = `http://127.0.0.1:${PORT}`;
const screenshots = join(root, 'e2e', 'screenshots');
mkdirSync(screenshots, { recursive: true });

function findChromium() {
  if (process.env['ARL_CHROMIUM_PATH'] && existsSync(process.env['ARL_CHROMIUM_PATH'])) {
    return process.env['ARL_CHROMIUM_PATH'];
  }
  const baseDir = join(process.env['LOCALAPPDATA'] ?? '', 'ms-playwright');
  if (!existsSync(baseDir)) return null;
  const candidates = readdirSync(baseDir)
    .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const dir of candidates) {
    for (const sub of ['chrome-win64', 'chrome-win']) {
      const exe = join(baseDir, dir, sub, 'chrome.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

async function waitForServer(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/overview`);
      if (res.ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server 未在 ${timeoutMs}ms 内就绪`);
}

const apiGet = async (path) => (await fetch(`${base}/api${path}`)).json();
const apiPost = async (path, body) =>
  (
    await fetch(`${base}/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  ).json();

const results = [];
function record(step, status, detail = '') {
  results.push({ step, status, detail });
  console.log(`${status === 'PASS' ? '✓' : '✗'} ${step}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const executablePath = findChromium();
  if (!executablePath) {
    console.error('[e2e] 未找到本机 Chromium。设置 ARL_CHROMIUM_PATH 或准备 Playwright 浏览器（不要运行 playwright install）。');
    process.exit(2);
  }
  console.log(`[e2e] chromium: ${executablePath}`);

  const dbPath = join(root, 'e2e', 'e2e.sqlite');
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
  const server = spawn(process.execPath, [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'apps/server/src/main.ts'], {
    cwd: root,
    env: { ...process.env, ARL_DB_PATH: dbPath, ARL_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (c) => console.log(`[api] ${String(c).trim()}`));
  server.stderr.on('data', (c) => console.error(`[api:err] ${String(c).trim()}`));

  let browser;
  try {
    await waitForServer();
    record('启动被测系统', 'PASS', `fresh db + web dist @ ${base}`);

    // 预取真实 id
    const agents = (await apiGet('/agents')).data;
    const stable = agents.find((a) => a.name === 'Support Agent');
    const v1Id = stable.versions.find((v) => v.version === 1).id;
    const v2Id = stable.versions.find((v) => v.version === 2).id;
    const datasets = (await apiGet('/datasets')).data;
    const toolCalling = datasets.find((d) => d.name === 'Tool Calling');
    const toolCallingVersionId = toolCalling.latestVersion.id;
    const customerSupport = datasets.find((d) => d.name === 'Customer Support');
    const customerSupportVersionId = customerSupport.latestVersion.id;
    const sets = (await apiGet('/evaluator-sets')).data;
    const fullSetId = sets.find((s) => s.name.startsWith('Full')).id;

    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(30_000);

    // ── Dashboard ─────────────────────────────────────────────
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Agent Reliability Lab');
    record('1. 打开 Dashboard', 'PASS');
    await page.screenshot({ path: join(screenshots, '01-dashboard.png'), fullPage: true });

    // ── Agent 详情 ────────────────────────────────────────────
    await page.click('nav >> text=Agents');
    await page.waitForSelector('text=Support Agent');
    await page.click('text=Support Agent');
    await page.waitForSelector('text=版本（不可覆盖，只能新增）');
    record('2. 打开 Agent 详情（版本 / Prompt / 门禁 / 历史）', 'PASS');
    await page.screenshot({ path: join(screenshots, '02-agent-detail.png'), fullPage: true });

    // ── Dataset 详情 ──────────────────────────────────────────
    await page.click('nav >> text=Datasets');
    await page.waitForSelector('text=Tool Calling');
    await page.click('text=Tool Calling');
    await page.waitForSelector('text=/用例（\\d+）/');
    record('3. 打开 Dataset 详情（用例表 + 冻结/Fork）', 'PASS');
    await page.screenshot({ path: join(screenshots, '03-dataset.png'), fullPage: true });

    // ── 启动两次真实评测（V1 与 V2）────────────────────────────
    async function waitForOption(index, value) {
      await page.waitForFunction(
        ({ idx, val }) => {
          const select = document.querySelectorAll('.card select')[idx];
          return select && Array.from(select.options).some((o) => o.value === val);
        },
        { idx: index, val: value },
        { timeout: 20_000 },
      );
    }

    async function startRunAndWait(versionId, label, datasetVersionId = toolCallingVersionId) {
      await page.click('nav >> text=Runs');
      await page.waitForSelector('text=启动评测');
      await waitForOption(0, versionId);
      await waitForOption(1, datasetVersionId);
      await waitForOption(2, fullSetId);
      const selects = page.locator('.card select');
      await selects.nth(0).selectOption(versionId);
      await selects.nth(1).selectOption(datasetVersionId);
      await selects.nth(2).selectOption(fullSetId);
      await page.click('button:has-text("启动评测")');
      await page.waitForSelector('text=评测已启动');
      await page.waitForSelector('table >> text=completed', { timeout: 90_000 });
      record(`4. 启动并完成评测（${label}）`, 'PASS');
    }
    await startRunAndWait(v1Id, 'Support Agent v1');
    await page.screenshot({ path: join(screenshots, '04-runs.png'), fullPage: true });
    // V2 跑 Customer Support：回归只发生在「为什么重复扣款」意图上（Tool Calling 数据集上 V2 与 V1 行为一致）
    await startRunAndWait(v2Id, 'Support Agent v2（回归）', customerSupportVersionId);

    // ── Run 详情 ──────────────────────────────────────────────
    const runs = (await apiGet('/runs?limit=2')).data;
    await page.goto(`${base}/runs/${runs[0].id}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(screenshots, '05-run-detail.png'), fullPage: true });
    await page.waitForSelector('text=Release Gate');
    await page.waitForSelector('text=/通过率/');
    record('5. 打开 Run 详情（指标 + 门禁 + 可复现性快照）', 'PASS');
    await page.screenshot({ path: join(screenshots, '05-run-detail.png'), fullPage: true });

    // ── 失败用例 + Trace Viewer ───────────────────────────────
    await page.click('nav >> text=Failure Center');
    await page.waitForSelector('text=归因说明');
    const failureRows = await page.locator('table tbody tr').count();
    expectGreater(failureRows, 0, 'Failure Center 应有 V2 的失败用例');
    await page.locator('table tbody tr').first().locator('a:has-text("查看")').click();
    await page.waitForSelector('text=/Trace（\\d+ 步/');
    await page.locator('text=/^\\d+$/').first().click().catch(() => undefined);
    record('6. 打开失败用例与 Trace Viewer（按时间序展开）', 'PASS', `${failureRows} 条失败`);
    await page.screenshot({ path: join(screenshots, '06-case-trace.png'), fullPage: true });

    // ── 版本对比（V2 vs V1）────────────────────────────────────
    await page.goto(`${base}/compare?base=${runs[1].id}&target=${runs[0].id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=指标差异');
    await page.waitForSelector('text=/回归用例（\\d+）/');
    record('7. 版本对比（指标差异 + 回归用例）', 'PASS');
    await page.screenshot({ path: join(screenshots, '07-compare.png'), fullPage: true });

    // ── Release Center ────────────────────────────────────────
    await page.click('nav >> text=Release Center');
    await page.waitForSelector('text=决策历史（只增不改）');
    record('8. 打开 Release Center（门禁规则 + 决策历史）', 'PASS');
    await page.screenshot({ path: join(screenshots, '08-release.png'), fullPage: true });

    // ── Review Queue ──────────────────────────────────────────
    await page.click('nav >> text=Review Queue');
    await page.waitForSelector('text=/人工 vs 机器一致性/');
    record('9. 打开 Human Review Queue', 'PASS');
    await page.screenshot({ path: join(screenshots, '09-reviews.png'), fullPage: true });

    // ── 搜索 ──────────────────────────────────────────────────
    await page.click('nav >> text=Search');
    await page.fill('input[placeholder*="搜索"]', '重复扣款');
    await page.waitForSelector('text=/Agent|数据集|Case Run|用例|Run/');
    record('10. 全文搜索（中文 trigram）', 'PASS');
    await page.screenshot({ path: join(screenshots, '10-search.png'), fullPage: true });
  } catch (err) {
    let bodySnapshot = '';
    try {
      if (page) bodySnapshot = (await page.innerText('body').catch(() => '')).slice(0, 600);
    } catch { /* ignore */ }
    record('E2E 中断', 'FAIL', `${err instanceof Error ? err.message : String(err)} | 页面内容: ${bodySnapshot.replace(/\s+/g, ' ')}`);
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    server.kill();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    chromium: executablePath,
    results,
    passed: results.filter((r) => r.status === 'PASS').length,
    failed: results.filter((r) => r.status === 'FAIL').length,
  };
  writeFileSync(join(root, 'e2e', 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\n[e2e] ${report.passed} passed, ${report.failed} failed → e2e/report.json`);
  if (report.failed > 0) process.exit(1);
}

function expectGreater(actual, minimum, message) {
  if (actual <= minimum) throw new Error(`${message}（实际 ${actual}）`);
}

main().catch((err) => {
  console.error('[e2e] fatal:', err);
  process.exit(1);
});
