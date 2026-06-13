/**
 * 2026 世界杯 · 比分自动更新 Worker（Cloudflare Cron Trigger）
 *
 * 作用：每 4 小时运行一次，找出"已结束但尚未录入比分"的小组赛，
 *      从百度搜索抓取比分，写入与前端共享的 D1 数据库 results 表，
 *      前端积分榜随之自动结算更新。
 *
 * 绑定（见 wrangler.toml）：
 *   - D1 数据库绑定，变量名 DB（与 Pages 项目同一个 worldcup2026 库）
 *   - 可选环境变量 RUN_KEY：手动触发 /run 时的口令
 *
 * 重要说明：
 *   - 百度搜索页为反爬动态 HTML，解析比分为"尽力而为"，不保证成功；
 *     失败的场次会在下次运行重试，不会写入错误数据。
 *   - 只处理小组赛（72 场，对阵固定）。淘汰赛对阵需出线后确定，仍走手动录入。
 *   - 已存在的比分（含管理员手动录入）不会被覆盖。
 */

import { buildGroupFixtures } from './fixtures.js';

const MATCH_END_BUFFER_MS = 130 * 60 * 1000; // 开球后约 2 小时 10 分视为已结束
const MAX_FETCH_PER_RUN = 25;                 // 单次运行最多抓取场次（规避 Baidu/子请求限制）

function nowMs() { return Date.now(); }

function kickoffMs(fx) {
  return Date.parse(fx.kickoffBeijing); // 带 +08:00，跨时区安全
}
function isFinished(fx) {
  return nowMs() >= kickoffMs(fx) + MATCH_END_BUFFER_MS;
}

async function existingResultIds(env) {
  const rows = await env.DB.prepare('SELECT match_id FROM results').all();
  return new Set((rows.results || []).map(r => r.match_id));
}

async function upsertResult(env, id, home, away) {
  await env.DB.prepare(
    'INSERT INTO results (match_id, home, away, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(match_id) DO UPDATE SET home = excluded.home, away = excluded.away, updated_at = excluded.updated_at'
  ).bind(id, home, away, nowMs()).run();
}

// 从百度搜索 HTML 中尽力解析出 home:away 比分
function parseScore(html, home, away) {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
  // 比分形态：1:0 / 1：0 / 1-0 / 1 : 0 等
  const re = /(\d{1,2})\s*[:：\-–]\s*(\d{1,2})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const idx = m.index;
    const ctx = text.slice(Math.max(0, idx - 70), idx + 70);
    const hi = ctx.indexOf(home);
    const ai = ctx.indexOf(away);
    if (hi >= 0 && ai >= 0) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (a >= 0 && a <= 20 && b >= 0 && b <= 20) {
        // 按队名在上下文中的先后顺序决定主客归属
        return hi <= ai ? { home: a, away: b } : { home: b, away: a };
      }
    }
  }
  return null;
}

async function fetchScoreFromBaidu(fx) {
  const query = `${fx.home} ${fx.away} 世界杯 比分 ${fx.dateLabel}`;
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      cf: { cacheTtl: 0 },
    });
  } catch (e) {
    return { ok: false, reason: 'fetch_error:' + (e && e.message) };
  }
  if (!res.ok) return { ok: false, reason: 'http_' + res.status };
  const html = await res.text();
  const score = parseScore(html, fx.home, fx.away);
  if (!score) return { ok: false, reason: 'no_score_parsed' };
  return { ok: true, score };
}

async function runUpdate(env) {
  const fixtures = buildGroupFixtures();
  const existing = await existingResultIds(env);

  const pending = fixtures
    .filter(fx => isFinished(fx) && !existing.has(fx.id))
    .sort((a, b) => kickoffMs(a) - kickoffMs(b))
    .slice(0, MAX_FETCH_PER_RUN);

  const summary = { checked: pending.length, updated: 0, failed: 0, details: [] };
  for (const fx of pending) {
    const r = await fetchScoreFromBaidu(fx);
    if (r.ok) {
      await upsertResult(env, fx.id, r.score.home, r.score.away);
      summary.updated++;
      summary.details.push(`${fx.id} ${fx.home} ${r.score.home}:${r.score.away} ${fx.away} ✅`);
    } else {
      summary.failed++;
      summary.details.push(`${fx.id} ${fx.home} vs ${fx.away} ✗ ${r.reason}`);
    }
    // 轻微间隔，降低被限频概率
    await new Promise(s => setTimeout(s, 300));
  }
  summary.ranAt = new Date().toISOString();
  return summary;
}

export default {
  // 定时触发（wrangler.toml 中配置每 4 小时）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runUpdate(env).then(s => console.log('[cron] ', JSON.stringify(s)))
        .catch(e => console.error('[cron] error', e && e.message))
    );
  },

  // 手动触发 / 健康检查：GET /run?key=RUN_KEY
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
