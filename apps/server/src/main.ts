import express from 'express';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './api/routes';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env['ARL_PORT'] ?? 8787);

const { app, store, seeded } = createApp({
  dbPath: process.env['ARL_DB_PATH'] ?? join(here, '../../../data/arl.sqlite'),
});

// 生产模式：直接伺服 web 构建产物
const webDist = join(here, '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (_req, res) => {
    res.sendFile(join(webDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`[ARL] AI Agent Reliability Lab API`);
  console.log(`[ARL] http://localhost:${PORT}`);
  console.log(`[ARL] sqlite: ${store.driver.path}`);
  if (seeded) {
    console.log(`[ARL] 已注入种子数据：${seeded.agents.length} agents / ${seeded.datasets.length} datasets / ${seeded.gates.length} gates`);
  }
});

process.on('SIGINT', () => {
  store.close();
  process.exit(0);
});
