/**
 * 2026 世界杯竞猜 · 云端共享后端（腾讯云 EdgeOne Pages 版）
 * 部署在 EdgeOne Edge Functions，统一处理 /api/* 请求。
 *
 * 需要在 EdgeOne Pages 控制台配置：
 *   - KV 命名空间，绑定到本项目，运行时变量名：WC_KV（全局注入，直接使用）
 *   - 环境变量：ADMIN_SECRET（管理员口令，用于录入真实比分）
 *
 * 与 Cloudflare 版（functions/api/[[path]].js）功能一致，前端无需改动。
 *
 * KV 限制：key 仅允许「数字 / 字母 / 下划线」，故对中文用户名、含连字符的 token 做十六进制编码。
 *
 * KV 数据结构：
 *   results              -> { matchId: {home, away} }  管理员录入的真实比分（单 key）
 *   user_<hex(用户名)>    -> { username, pwdHash, salt, followed, bets, scoreBets, goalBets, championBet }
 *   session_<hex(token)> -> 用户名（字符串）
 */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function err(message, status = 400) {
  return json({ error: message }, status);
}

function kvStore() {
  // eslint-disable-next-line no-undef
  if (typeof WC_KV !== 'undefined' && WC_KV) return WC_KV; // eslint-disable-line no-undef
  throw new Error('KV 未绑定：请在 EdgeOne 项目中绑定命名空间，运行时变量名设为 WC_KV');
}

function toHex(str) {
  const bytes = new TextEncoder().encode(str);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}
const kUser = u => 'user_' + toHex(u);
const kSession = t => 'session_' + toHex(t);
const K_RESULTS = 'results';

async function getJSON(key, def) {
  const v = await kvStore().get(key, 'json');
  return (v === null || v === undefined) ? def : v;
}
async function putJSON(key, val) {
  await kvStore().put(key, JSON.stringify(val));
}

async function hashPwd(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

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
function publicUser(rec) {
  return { username: rec.username, ...normalizeData(rec) };
}

async function userFromToken(token) {
  if (!token) return null;
  const name = await kvStore().get(kSession(token));
  return name || null;
}

async function listAllPlayers() {
  const players = [];
  let cursor;
  for (let guard = 0; guard < 1000; guard++) {
    const r = await kvStore().list({ prefix: 'user_', limit: 256, cursor });
    for (const it of (r.keys || [])) {
      const rec = await kvStore().get(it.key, 'json');
      if (rec && rec.username) players.push(publicUser(rec));
    }
    if (r.complete) break;
    cursor = r.cursor;
    if (!cursor) break;
  }
  return players;
}

// ---------- 各接口 ----------

async function handleRegister(body) {
  const username = (body.username || '').trim();
  const password = body.password || '';
  if (username.length < 2 || username.length > 12) return err('用户名需 2~12 个字符');
  if (password.length < 6) return err('密码至少 6 位');

  const exists = await getJSON(kUser(username), null);
  if (exists) return err('该用户名已被注册');

  const salt = crypto.randomUUID();
  const pwdHash = await hashPwd(password, salt);
  const rec = { username, pwdHash, salt, ...normalizeData(null) };
  await putJSON(kUser(username), rec);

  const token = crypto.randomUUID();
  await kvStore().put(kSession(token), username);
  return json({ token, user: publicUser(rec) });
}

async function handleLogin(body) {
  const username = (body.username || '').trim();
  const password = body.password || '';
  const rec = await getJSON(kUser(username), null);
  if (!rec) return err('用户不存在，请先注册');
  const pwdHash = await hashPwd(password, rec.salt);
  if (pwdHash !== rec.pwdHash) return err('密码不正确');

  const token = crypto.randomUUID();
  await kvStore().put(kSession(token), username);
  return json({ token, user: publicUser(rec) });
}

async function handleLogout(body) {
  if (body.token) await kvStore().delete(kSession(body.token));
  return json({ ok: true });
}

async function handleState(token) {
  const results = await getJSON(K_RESULTS, {});
  const players = await listAllPlayers();
  let me = null;
  const username = await userFromToken(token);
  if (username) {
    const rec = await getJSON(kUser(username), null);
    me = rec ? publicUser(rec) : null;
  }
  return json({ results, players, me });
}

async function handleSave(body) {
  const username = await userFromToken(body.token);
  if (!username) return err('请先登录', 401);
  const rec = await getJSON(kUser(username), null);
  if (!rec) return err('用户不存在', 404);
  const data = normalizeData(body.data);
  const updated = { username: rec.username, pwdHash: rec.pwdHash, salt: rec.salt, ...data };
  await putJSON(kUser(username), updated);
  return json({ ok: true });
}

async function handleResult(env, body) {
  const adminSecret = env && env.ADMIN_SECRET;
  if (!adminSecret || body.secret !== adminSecret) return err('管理员口令错误', 403);
  const matchId = body.matchId;
  if (!matchId) return err('缺少比赛编号');
  const results = await getJSON(K_RESULTS, {});
  if (body.clear) {
    delete results[matchId];
    await putJSON(K_RESULTS, results);
    return json({ ok: true });
  }
  const home = parseInt(body.home, 10);
  const away = parseInt(body.away, 10);
  if (isNaN(home) || isNaN(away) || home < 0 || away < 0 || home > 99 || away > 99) {
    return err('请输入有效比分');
  }
  results[matchId] = { home, away };
  await putJSON(K_RESULTS, results);
  return json({ ok: true });
}

// ---------- 路由分发 ----------
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const method = request.method.toUpperCase();

  try {
    if (method === 'GET' && path === 'state') {
      return await handleState(url.searchParams.get('token'));
    }
    if (method === 'POST') {
      const body = await readBody(request);
      switch (path) {
        case 'register': return await handleRegister(body);
        case 'login': return await handleLogin(body);
        case 'logout': return await handleLogout(body);
        case 'save': return await handleSave(body);
        case 'result': return await handleResult(env, body);
      }
    }
    return err('接口不存在', 404);
  } catch (e) {
    return err('服务器内部错误：' + (e && e.message ? e.message : String(e)), 500);
  }
}
