/**
 * 2026 世界杯竞猜 · 云端共享后端（Cloudflare Pages Functions 版）
 * 统一处理 /api/* 请求。
 *
 * 依赖绑定（在 Cloudflare Pages 项目设置中配置）：
 *   - D1 数据库绑定，变量名：DB
 *   - 环境变量：ADMIN_SECRET（管理员口令，用于录入真实比分）
 *
 * 表结构见仓库根目录 schema.sql。
 * 每个用户的全部竞猜（胜平负 / 比分 / 总进球 / 冠军）与关注，统一以 JSON 存在 users.data 列。
 */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function err(message, status = 400) {
  return json({ error: message }, status);
}

async function hashPwd(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

// 规范化竞猜数据，过滤非法字段
function normalizeData(d) {
  d = d || {};
  return {
    followed: Array.isArray(d.followed) ? d.followed.filter(x => typeof x === 'string') : [],
    bets: (d.bets && typeof d.bets === 'object') ? d.bets : {},
    scoreBets: (d.scoreBets && typeof d.scoreBets === 'object') ? d.scoreBets : {},
    goalBets: (d.goalBets && typeof d.goalBets === 'object') ? d.goalBets : {},
    championBet: typeof d.championBet === 'string' ? d.championBet : null,
  };
}
function publicUser(username, dataObj) {
  return { username, ...normalizeData(dataObj) };
}
function parseData(text) {
  try { return normalizeData(JSON.parse(text || '{}')); } catch { return normalizeData(null); }
}

async function userFromToken(env, token) {
  if (!token) return null;
  const row = await env.DB.prepare('SELECT username FROM sessions WHERE token = ?').bind(token).first();
  return row ? row.username : null;
}

// ---------- 各接口 ----------

async function handleRegister(env, body) {
  const username = (body.username || '').trim();
  const password = body.password || '';
  if (username.length < 2 || username.length > 12) return err('用户名需 2~12 个字符');
  if (password.length < 6) return err('密码至少 6 位');

  const exists = await env.DB.prepare('SELECT username FROM users WHERE username = ?').bind(username).first();
  if (exists) return err('该用户名已被注册');

  const salt = crypto.randomUUID();
  const pwdHash = await hashPwd(password, salt);
  const now = Date.now();
  const data = normalizeData(null);
  await env.DB.prepare('INSERT INTO users (username, pwd_hash, salt, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(username, pwdHash, salt, JSON.stringify(data), now).run();

  const token = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)')
    .bind(token, username, now).run();

  return json({ token, user: publicUser(username, data) });
}

async function handleLogin(env, body) {
  const username = (body.username || '').trim();
  const password = body.password || '';
  const u = await env.DB.prepare('SELECT username, pwd_hash, salt, data FROM users WHERE username = ?')
    .bind(username).first();
  if (!u) return err('用户不存在，请先注册');
  const pwdHash = await hashPwd(password, u.salt);
  if (pwdHash !== u.pwd_hash) return err('密码不正确');

  const token = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)')
    .bind(token, username, Date.now()).run();

  return json({ token, user: publicUser(username, parseData(u.data)) });
}

async function handleLogout(env, body) {
  if (body.token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(body.token).run();
  }
  return json({ ok: true });
}

// 聚合状态：真实比分 + 全部玩家 + 当前登录者
async function handleState(env, token) {
  const resRows = await env.DB.prepare('SELECT match_id, home, away FROM results').all();
  const results = {};
  (resRows.results || []).forEach(r => { results[r.match_id] = { home: r.home, away: r.away }; });

  const userRows = await env.DB.prepare('SELECT username, data FROM users').all();
  const players = (userRows.results || []).map(u => publicUser(u.username, parseData(u.data)));

  let me = null;
  const username = await userFromToken(env, token);
  if (username) {
    const urow = (userRows.results || []).find(u => u.username === username);
    me = urow ? publicUser(username, parseData(urow.data)) : null;
  }

  return json({ results, players, me });
}

// 覆盖保存当前用户的全部竞猜与关注
async function handleSave(env, body) {
  const username = await userFromToken(env, body.token);
  if (!username) return err('请先登录', 401);
  const data = normalizeData(body.data);
  const r = await env.DB.prepare('UPDATE users SET data = ? WHERE username = ?')
    .bind(JSON.stringify(data), username).run();
  return json({ ok: true });
}

async function handleResult(env, body) {
  if (!env.ADMIN_SECRET || body.secret !== env.ADMIN_SECRET) return err('管理员口令错误', 403);
  const matchId = body.matchId;
  if (!matchId) return err('缺少比赛编号');
  if (body.clear) {
    await env.DB.prepare('DELETE FROM results WHERE match_id = ?').bind(matchId).run();
    return json({ ok: true });
  }
  const home = parseInt(body.home, 10);
  const away = parseInt(body.away, 10);
  if (isNaN(home) || isNaN(away) || home < 0 || away < 0 || home > 99 || away > 99) {
    return err('请输入有效比分');
  }
  await env.DB.prepare(
    'INSERT INTO results (match_id, home, away, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(match_id) DO UPDATE SET home = excluded.home, away = excluded.away, updated_at = excluded.updated_at'
  ).bind(matchId, home, away, Date.now()).run();
  return json({ ok: true });
}

// ---------- 路由分发 ----------
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const method = request.method.toUpperCase();

  if (!env.DB) return err('服务器未配置数据库（DB 绑定缺失）', 500);

  try {
    if (method === 'GET' && path === 'state') {
      return await handleState(env, url.searchParams.get('token'));
    }
    if (method === 'POST') {
      const body = await readBody(request);
      switch (path) {
        case 'register': return await handleRegister(env, body);
        case 'login': return await handleLogin(env, body);
        case 'logout': return await handleLogout(env, body);
        case 'save': return await handleSave(env, body);
        case 'result': return await handleResult(env, body);
      }
    }
    return err('接口不存在', 404);
  } catch (e) {
    return err('服务器内部错误：' + (e && e.message ? e.message : String(e)), 500);
  }
}
