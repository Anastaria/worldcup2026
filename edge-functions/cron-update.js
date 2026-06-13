/**
 * 2026 世界杯 · 比分自动更新（EdgeOne Pages Edge Function 版）
 *
 * 路由：/cron-update      （本文件位于 edge-functions 根目录，自动映射为该路径）
 * 作用：找出"已结束但尚未录入比分"的小组赛，从数据源抓比分，写入 KV 的 `results`，
 *      前端积分榜随之自动结算。与 Cloudflare 版 cron-worker 等价，但写 KV 而非 D1。
 *
 * 触发方式（EdgeOne 无内置 cron+KV 组合，二选一）：
 *   A. EdgeOne Pages「定时任务」若可用：定时 GET 本路由。
 *   B. 外部定时器（如 cron-job.org / 腾讯云 SCF 定时触发器）每 4 小时 GET：
 *        https://你的域名/cron-update?key=CRON_KEY
 *
 * 依赖（EdgeOne 项目配置）：
 *   - KV 命名空间绑定，运行时变量名 WC_KV（与后端一致）
 *   - 环境变量 CRON_KEY：调用口令（未设则回退用 ADMIN_SECRET）
 *   - 环境变量 SOURCE：'footballdata'（推荐）| 'baidu'，不填则有 token 用 footballdata 否则 baidu
 *   - 环境变量 FOOTBALL_DATA_TOKEN：用 footballdata 源时必填（football-data.org 免费 token）
 *
 * 说明：只处理小组赛（72 场，对阵固定）；不覆盖已有比分（含手动录入）；抓不到的下次重试。
 */

// ---------- 小组赛固定赛程（与前端 data.js 同源生成） ----------
const TEAM_LIST = [
  '墨西哥', '南非', '韩国', '捷克',
  '加拿大', '波黑', '卡塔尔', '瑞士',
  '巴西', '摩洛哥', '海地', '苏格兰',
  '美国', '巴拉圭', '澳大利亚', '土耳其',
  '德国', '库拉索', '科特迪瓦', '厄瓜多尔',
  '荷兰', '日本', '瑞典', '突尼斯',
  '比利时', '埃及', '伊朗', '新西兰',
  '西班牙', '佛得角', '沙特阿拉伯', '乌拉圭',
  '法国', '塞内加尔', '伊拉克', '挪威',
  '阿根廷', '阿尔及利亚', '奥地利', '约旦',
  '葡萄牙', '刚果(金)', '乌兹别克斯坦', '哥伦比亚',
  '英格兰', '克罗地亚', '加纳', '巴拿马',
];
const GROUP_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const SCHED = {
  A: [[['06-12', '03:00'], ['06-12', '10:00']], [['06-19', '09:00'], ['06-19', '00:00']], [['06-25', '09:00'], ['06-25', '09:00']]],
  B: [[['06-13', '03:00'], ['06-14', '03:00']], [['06-19', '06:00'], ['06-19', '03:00']], [['06-25', '03:00'], ['06-25', '03:00']]],
  C: [[['06-14', '06:00'], ['06-14', '09:00']], [['06-20', '08:30'], ['06-20', '06:00']], [['06-25', '06:00'], ['06-25', '06:00']]],
  D: [[['06-13', '09:00'], ['06-14', '12:00']], [['06-20', '03:00'], ['06-20', '11:00']], [['06-26', '10:00'], ['06-26', '10:00']]],
  E: [[['06-15', '01:00'], ['06-15', '07:00']], [['06-21', '04:00'], ['06-21', '08:00']], [['06-26', '04:00'], ['06-26', '04:00']]],
  F: [[['06-15', '04:00'], ['06-15', '10:00']], [['06-21', '01:00'], ['06-21', '12:00']], [['06-26', '07:00'], ['06-26', '07:00']]],
  G: [[['06-16', '03:00'], ['06-16', '09:00']], [['06-22', '03:00'], ['06-22', '09:00']], [['06-27', '11:00'], ['06-27', '11:00']]],
  H: [[['06-16', '00:00'], ['06-16', '06:00']], [['06-22', '00:00'], ['06-22', '06:00']], [['06-27', '08:00'], ['06-27', '08:00']]],
  I: [[['06-17', '03:00'], ['06-17', '06:00']], [['06-23', '05:00'], ['06-23', '08:00']], [['06-27', '03:00'], ['06-27', '03:00']]],
  J: [[['06-17', '09:00'], ['06-17', '12:00']], [['06-23', '01:00'], ['06-23', '11:00']], [['06-28', '10:00'], ['06-28', '10:00']]],
  K: [[['06-18', '01:00'], ['06-18', '10:00']], [['06-24', '01:00'], ['06-24', '10:00']], [['06-28', '07:30'], ['06-28', '07:30']]],
  L: [[['06-18', '04:00'], ['06-18', '07:00']], [['06-24', '04:00'], ['06-24', '07:00']], [['06-28', '05:00'], ['06-28', '05:00']]],
};

function buildGroupFixtures() {
  const out = [];
  GROUP_NAMES.forEach((gName, gi) => {
    const [t0, t1, t2, t3] = TEAM_LIST.slice(gi * 4, gi * 4 + 4);
    const rounds = [
      [[t0, t1], [t2, t3]],
      [[t0, t2], [t3, t1]],
      [[t0, t3], [t1, t2]],
    ];
    rounds.forEach((pairings, ri) => {
      pairings.forEach((pair, pi) => {
        const [date, time] = SCHED[gName][ri][pi];
        const [mm, dd] = date.split('-');
        out.push({
          id: `G${gName}-R${ri + 1}-${pi + 1}`,
          home: pair[0], away: pair[1],
          kickoffBeijing: `2026-${date}T${time}:00+08:00`,
          dateLabel: `${parseInt(mm, 10)}月${parseInt(dd, 10)}日`,
        });
      });
    });
  });
  return out;
}

// ---------- 队名中→英别名（API 返回英文名时匹配用） ----------
const EN_ALIASES = {
  '墨西哥': ['Mexico'], '南非': ['South Africa'], '韩国': ['Korea Republic', 'South Korea', 'Korea'],
  '捷克': ['Czechia', 'Czech Republic'], '加拿大': ['Canada'], '波黑': ['Bosnia and Herzegovina', 'Bosnia-Herzegovina', 'Bosnia'],
  '卡塔尔': ['Qatar'], '瑞士': ['Switzerland'], '巴西': ['Brazil'], '摩洛哥': ['Morocco'], '海地': ['Haiti'],
  '苏格兰': ['Scotland'], '美国': ['United States', 'USA', 'United States of America'], '巴拉圭': ['Paraguay'],
  '澳大利亚': ['Australia'], '土耳其': ['Turkiye', 'Türkiye', 'Turkey'], '德国': ['Germany'], '库拉索': ['Curacao', 'Curaçao'],
  '科特迪瓦': ['Cote d\'Ivoire', 'Côte d\'Ivoire', 'Ivory Coast'], '厄瓜多尔': ['Ecuador'], '荷兰': ['Netherlands', 'Holland'],
  '日本': ['Japan'], '瑞典': ['Sweden'], '突尼斯': ['Tunisia'], '比利时': ['Belgium'], '埃及': ['Egypt'],
  '伊朗': ['Iran', 'IR Iran'], '新西兰': ['New Zealand'], '西班牙': ['Spain'], '佛得角': ['Cape Verde', 'Cabo Verde'],
  '沙特阿拉伯': ['Saudi Arabia'], '乌拉圭': ['Uruguay'], '法国': ['France'], '塞内加尔': ['Senegal'], '伊拉克': ['Iraq'],
  '挪威': ['Norway'], '阿根廷': ['Argentina'], '阿尔及利亚': ['Algeria'], '奥地利': ['Austria'], '约旦': ['Jordan'],
  '葡萄牙': ['Portugal'], '刚果(金)': ['DR Congo', 'Congo DR', 'Democratic Republic of the Congo', 'Congo'],
  '乌兹别克斯坦': ['Uzbekistan'], '哥伦比亚': ['Colombia'], '英格兰': ['England'], '克罗地亚': ['Croatia'],
  '加纳': ['Ghana'], '巴拿马': ['Panama'],
};
function normName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function apiNameMatchesCn(apiName, cnName) {
  const aliases = EN_ALIASES[cnName];
  if (!aliases) return false;
  const a = normName(apiName);
  if (!a) return false;
  return aliases.some(al => { const n = normName(al); return a === n || a.includes(n) || n.includes(a); });
}

// ---------- 数据源 ----------
async function resolveFootballData(pending, env) {
  const out = [];
  if (!env.FOOTBALL_DATA_TOKEN) return { results: out, note: 'FOOTBALL_DATA_TOKEN 未配置' };
  let data;
  try {
    const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': env.FOOTBALL_DATA_TOKEN },
    });
    if (!res.ok) return { results: out, note: 'http_' + res.status };
    data = await res.json();
  } catch (e) { return { results: out, note: 'fetch_error:' + (e && e.message) }; }

  const finished = (data.matches || []).filter(m =>
    m.status === 'FINISHED' && m.score && m.score.fullTime &&
    m.score.fullTime.home != null && m.score.fullTime.away != null);

  for (const fx of pending) {
    const hit = finished.find(m => {
      const hn = m.homeTeam && m.homeTeam.name, an = m.awayTeam && m.awayTeam.name;
      return (apiNameMatchesCn(hn, fx.home) && apiNameMatchesCn(an, fx.away)) ||
             (apiNameMatchesCn(hn, fx.away) && apiNameMatchesCn(an, fx.home));
    });
    if (!hit) continue;
    const apiHomeIsOurHome = apiNameMatchesCn(hit.homeTeam.name, fx.home);
    const home = apiHomeIsOurHome ? hit.score.fullTime.home : hit.score.fullTime.away;
    const away = apiHomeIsOurHome ? hit.score.fullTime.away : hit.score.fullTime.home;
    out.push({ id: fx.id, home, away, info: `${fx.home} ${home}:${away} ${fx.away}` });
  }
  return { results: out, note: `api_finished=${finished.length}` };
}

function parseBaiduScore(html, home, away) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const re = /(\d{1,2})\s*[:：\-–]\s*(\d{1,2})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const ctx = text.slice(Math.max(0, m.index - 70), m.index + 70);
    const hi = ctx.indexOf(home), ai = ctx.indexOf(away);
    if (hi >= 0 && ai >= 0) {
      const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a >= 0 && a <= 20 && b >= 0 && b <= 20) return hi <= ai ? { home: a, away: b } : { home: b, away: a };
    }
  }
  return null;
}
async function resolveBaidu(pending) {
  const out = [];
  for (const fx of pending) {
    try {
      const url = `https://www.baidu.com/s?wd=${encodeURIComponent(`${fx.home} ${fx.away} 世界杯 比分 ${fx.dateLabel}`)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      });
      if (res.ok) {
        const score = parseBaiduScore(await res.text(), fx.home, fx.away);
        if (score) out.push({ id: fx.id, home: score.home, away: score.away, info: `${fx.home} ${score.home}:${score.away} ${fx.away}` });
      }
    } catch (e) { /* 跳过该场，下次重试 */ }
    await new Promise(s => setTimeout(s, 200));
  }
  return { results: out, note: `baidu_try=${pending.length}` };
}

// ---------- KV ----------
const K_RESULTS = 'results';
const MATCH_END_BUFFER_MS = 130 * 60 * 1000;
const MAX_PER_RUN = 25;

function kvStore() {
  // eslint-disable-next-line no-undef
  if (typeof WC_KV !== 'undefined' && WC_KV) return WC_KV; // eslint-disable-line no-undef
  throw new Error('KV 未绑定：请在 EdgeOne 项目绑定命名空间，运行时变量名设为 WC_KV');
}

async function runUpdate(env) {
  const results = (await kvStore().get(K_RESULTS, 'json')) || {};
  const fixtures = buildGroupFixtures();
  const pending = fixtures
    .filter(fx => Date.now() >= Date.parse(fx.kickoffBeijing) + MATCH_END_BUFFER_MS && !results[fx.id])
    .sort((a, b) => Date.parse(a.kickoffBeijing) - Date.parse(b.kickoffBeijing))
    .slice(0, MAX_PER_RUN);

  const summary = { pending: pending.length, updated: 0, details: [] };
  if (pending.length === 0) { summary.ranAt = new Date().toISOString(); return summary; }

  const want = (env.SOURCE || '').toLowerCase();
  const useFootball = want === 'footballdata' || (!want && !!env.FOOTBALL_DATA_TOKEN);
  summary.source = useFootball ? 'footballdata' : 'baidu';

  const resolved = useFootball ? await resolveFootballData(pending, env) : await resolveBaidu(pending);
  summary.note = resolved.note;

  let changed = false;
  for (const r of (resolved.results || [])) {
    results[r.id] = { home: r.home, away: r.away };
    changed = true;
    summary.updated++;
    summary.details.push(r.info || r.id);
  }
  if (changed) await kvStore().put(K_RESULTS, JSON.stringify(results));
  summary.failed = pending.length - summary.updated;
  summary.ranAt = new Date().toISOString();
  return summary;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  const expected = env.CRON_KEY || env.ADMIN_SECRET;
  if (expected && key !== expected) {
    return new Response('forbidden', { status: 403 });
  }
  try {
    const summary = await runUpdate(env);
    return new Response(JSON.stringify(summary, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e && e.message) || String(e) }), {
      status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
