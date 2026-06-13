/**
 * 2026 世界杯 · 比分自动更新 Worker（Cloudflare Cron Trigger）
 *
 * 每 4 小时运行：找出"已结束但尚未录入比分"的小组赛，从数据源抓取比分，
 * 写入与前端共享的 D1 数据库 results 表，前端积分榜随之自动结算。
 *
 * 数据源可切换（环境变量 SOURCE）：
 *   - 'footballdata'（推荐，稳定）：需 FOOTBALL_DATA_TOKEN
 *   - 'baidu'（尽力而为，可能不稳定）
 *   未设置 SOURCE 时：有 FOOTBALL_DATA_TOKEN 则用 footballdata，否则用 baidu。
 *
 * 绑定（见 wrangler.toml）：
 *   - D1 数据库绑定 DB（与 Pages 项目同一个 worldcup2026 库）
 *   - FOOTBALL_DATA_TOKEN（用 footballdata 源时）
 *   - RUN_KEY（可选，手动触发 /run 的口令）
 *
 * 说明：只处理小组赛（72 场，对阵固定）；淘汰赛对阵需出线后确定，仍走手动录入。
 *      不会覆盖已存在的比分（含管理员手动录入）。
 */

import { buildGroupFixtures } from './fixtures.js';
import * as footballData from './sources/footballData.js';
import * as baidu from './sources/baidu.js';

const SOURCES = { footballdata: footballData, baidu };

const MATCH_END_BUFFER_MS = 130 * 60 * 1000; // 开球后约 2 小时 10 分视为已结束
const MAX_PER_RUN = 25;                       // 单次运行最多处理场次（规避限频/子请求限制）

function pickSource(env) {
  const want = (env.SOURCE || '').toLowerCase();
  if (want && SOURCES[want]) return SOURCES[want];
  if (footballData.available(env)) return footballData; // 有 token 优先用稳定源
  return baidu;
}

function kickoffMs(fx) { return Date.parse(fx.kickoffBeijing); }
function isFinished(fx) { return Date.now() >= kickoffMs(fx) + MATCH_END_BUFFER_MS; }

async function existingResultIds(env) {
  const rows = await env.DB.prepare('SELECT match_id FROM results').all();
  return new Set((rows.results || []).map(r => r.match_id));
}

async function upsertResult(env, id, home, away) {
  await env.DB.prepare(
    'INSERT INTO results (match_id, home, away, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(match_id) DO UPDATE SET home = excluded.home, away = excluded.away, updated_at = excluded.updated_at'
  ).bind(id, home, away, Date.now()).run();
}

async function runUpdate(env) {
  const source = pickSource(env);
  const fixtures = buildGroupFixtures();
  const existing = await existingResultIds(env);

  const pending = fixtures
    .filter(fx => isFinished(fx) && !existing.has(fx.id))
    .sort((a, b) => kickoffMs(a) - kickoffMs(b))
    .slice(0, MAX_PER_RUN);

  const summary = { source: source.id, pending: pending.length, updated: 0, details: [] };
  if (pending.length === 0) { summary.ranAt = new Date().toISOString(); return summary; }

  let resolved;
  try {
    resolved = await source.resolve(pending, env);
  } catch (e) {
    summary.error = 'source_error:' + (e && e.message);
    summary.ranAt = new Date().toISOString();
    return summary;
  }
  summary.note = resolved.note;

  for (const r of (resolved.results || [])) {
    await upsertResult(env, r.id, r.home, r.away);
    summary.updated++;
    summary.details.push(r.info || r.id);
  }
  summary.failed = pending.length - summary.updated;
  summary.ranAt = new Date().toISOString();
  return summary;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runUpdate(env)
        .then(s => console.log('[cron]', JSON.stringify(s)))
        .catch(e => console.error('[cron] error', e && e.message))
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      if (env.RUN_KEY && url.searchParams.get('key') !== env.RUN_KEY) {
        return new Response('forbidden', { status: 403 });
      }
      if (!env.DB) return new Response('DB binding missing', { status: 500 });
      const s = await runUpdate(env);
      return new Response(JSON.stringify(s, null, 2), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    return new Response(
      '2026 世界杯比分自动更新 Worker 已运行。\n' +
      '手动触发：GET /run?key=你设置的RUN_KEY\n' +
      '定时任务：每 4 小时自动抓取小组赛比分并写入 D1。',
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  },
};
