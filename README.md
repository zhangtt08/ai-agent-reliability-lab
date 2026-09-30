# AI Agent Reliability Lab

[English](README.md) | [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Language](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node.js%20%E2%89%A522.5-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React%2018%20%2B%20Vite-61DAFB?logo=react&logoColor=black)
![Tests](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)
![Data](https://img.shields.io/badge/storage-SQLite%20(local)-003B57?logo=sqlite&logoColor=white)

> **A local-first engineering platform to test, evaluate, compare, diagnose, and gate the release of AI agents — deterministic evaluators first, every result backed by trace evidence.**
>
> **一个 local-first 的 AI 智能体测试 / 评估 / 对比 / 诊断 / 发布管控工程平台——确定性 Evaluator 优先，每个结果都带 Trace 证据。**

## The problem it solves

An agent that runs in a demo tells you nothing about reliability. What's the pass rate? Where exactly does it fail — retrieval, tool call, or generation? Is the new prompt a regression? Can this version ship? ARL turns those questions into a reproducible evaluation loop: versioned agents and datasets → batch runs with full traces → deterministic evaluators → failure attribution → regression detection → a release gate that explains its verdict, rule by rule.

It is not a prompt playground or a one-off chat scorer — it is the engineering loop:

```
Create Agent → Create Agent Version (prompt/model/tools/RAG)
→ Create Dataset (versioned) → define structured ExpectedOutcome
→ batch Run (bounded concurrency, per-case isolation) → capture full Trace
→ deterministic Evaluators → RuleJudge → LLM Judge (optional)
→ failure attribution → metric aggregation → version comparison
→ regression detection → Release Gate → suggestions → new version → rerun
```

## ✨ Features

- **Deterministic-first evaluation** — anything decidable by rules is *never* left to an LLM: tool called/not called, call counts, argument correctness, valid JSON, schema satisfaction, keyword presence, loops — all 19 built-in evaluators are deterministic, each with unit-tested positive and negative cases. The optional LLM Judge must emit Zod-validated structured output; parse failure is a loud error, never a silent pass.
- **Versioned, unfalsifiable history** — agent versions and prompts are immutable (enforced by database triggers), datasets are versioned with golden/frozen protection (SHA-256 content fingerprint), and every run records a reproducibility snapshot (prompt hash, dataset version + fingerprint, evaluator versions, model config, seed).
- **Structured ExpectedOutcome** — expectedText / mustContain / mustNotContain / expectedSchema / expectedTools / forbiddenTools / expectedToolArgs / maxToolCalls / expectedCallOrder / requiredEvidence / expectedClassification / customRules.
- **Full-trace observability with redaction** — six step types (model_call / tool_call / retrieval / decision / output / error) in sequence order; every credential shape (OpenAI/Anthropic keys, Bearer, JWT, AWS, PEM, connection strings) is regex-redacted before persistence, with three prompt-privacy tiers.
- **Evidence everywhere** — every failed check carries an `EvidenceReference` (trace step / tool call / retrieved document / output span); every metric carries its `definition`. No mystery AI scores.
- **14-class failure taxonomy with deterministic attribution** — the attributor walks evidence in descending strength and reports a class with confidence and evidence.
- **Regression detection** — case-level (Pass→Fail), metric-level (pass-rate drop), latency (P95), and cost regressions against a baseline; regressions on critical cases are graded critical.
- **Release Gate that explains itself** — threshold rules with scope (overall / critical / tag / category) and blocking flags; verdicts are PASS / FAIL / **BLOCKED** (missing metric — never a silent pass) / UNKNOWN, each rule showing actual value / threshold / sample size / affected cases.
- **Actionable, evidence-backed suggestions** — e.g. "1 of 2 failing cases calls `getOrder` without `orderId`"; prompt candidates never overwrite production prompts automatically. Human review (pass/fail/partial + notes) coexists with machine verdicts, never overwriting them.
- **Honest agent runtime** — runtime never sees the expected outcome; tool arguments pass JSON Schema validation before execution; RAG retrieval (auto + `searchKnowledge` tool) records structured RetrievalEvents; retries only absorb infrastructure faults, never wrong answers.
- **Demo mode with zero API keys** — 10 fixture agents (stable / regression / wrong-tool / wrong-args / bad-format / rag-failure / loop / hallucination / flaky-provider / slow) run real tool-calling loops against 3 golden datasets; `npm run dogfood` proves the platform catches every seeded defect.

## 🚀 Quick Start

Requires Node.js ≥ 22.5 (`node:sqlite`). No API key needed to start.

```bash
git clone https://github.com/zhangtt08/ai-agent-reliability-lab.git
cd ai-agent-reliability-lab
npm install --prefer-offline --no-audit --no-fund --ignore-scripts
npm run dev
# API      http://localhost:8787
# Web UI   http://localhost:5173
```

First launch creates the database, runs migrations, and seeds demo data automatically.

```bash
npm run seed              # seed manually (--force rebuilds the demo DB)
npm run dogfood           # prove the platform catches seeded defects (--detail for per-case output)
npm run build             # typecheck + frontend build
npm test                  # all unit + integration tests
npm run test:e2e          # browser E2E (reuses local Chromium, never downloads)
```

To use a real model (defaults to a deterministic offline Mock Provider):

```bash
# OpenAI-compatible: OpenAI / DeepSeek / local Ollama / LM Studio ...
ARL_OPENAI_BASE_URL=https://api.openai.com/v1
ARL_OPENAI_API_KEY=sk-xxx
```

Unconfigured providers are shown as unavailable in the UI — the platform never fakes real calls with the mock, and cost stays `unknown` (never invented) when no price table is configured.

## 🏗️ Architecture / How it works

TypeScript monorepo (npm workspaces), Express API + React/Vite web UI, SQLite persistence, Vitest tests:

```
apps/web              React 18 + Vite + Tailwind + Zustand
                      (Dashboard / Agents / Datasets / Runs / Trace Viewer / Compare
                       / Failure Center / Review Queue / Release Center / Search)
apps/server           Express API + run pipeline + task queue + seed data
packages/evaluation   19 evaluators / RuleJudge / 18 versioned metrics / failure
                      classifier / regression / gate / LLM judge / suggestions
packages/runtime      AgentRuntime (tool-calling loop) / tool executor /
                      RAG retrieval (BM25 + trigram) / trace collector
packages/providers    ModelProvider abstraction + MockModelProvider (first-class)
                      + OpenAI-compatible provider + registry
packages/persistence  node:sqlite driver + migrations + immutability triggers
                      + typed repositories + FTS5 search
packages/shared       Zod domain models / failure taxonomy / JSON-Schema subset
                      validation / TraceRedactor / dataset IO
```

Four pluggable interfaces — `ModelProvider`, `AgentRuntime`, `Evaluator`, `ToolExecutor` — so new implementations require no core changes.

**One run, step by step:** record a reproducibility snapshot → execute cases in a bounded-concurrency pool with per-case error boundaries → persist redacted traces in one transaction → run every evaluator, synthesize via RuleJudge (skipped checks never count toward passing; blocking failures fail immediately) → attribute failures deterministically → aggregate metrics → compare against baseline → evaluate the Release Gate → generate evidence-backed suggestions.

**Known limits, stated honestly:** `node:sqlite` is experimental on Node 22 (isolated to a single adapter file); mock-provider token usage is estimated; RAG is a local BM25 + trigram implementation, not real embeddings; semantic failure clustering and external agent adapters (HTTP/CLI) are on the roadmap. Full list in [简体中文](README.zh-CN.md#known-limitations).

## 📄 License

[MIT](LICENSE) © 2026 zhangtt08
