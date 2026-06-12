-- 2026 世界杯竞猜 · Cloudflare D1 数据库建表
-- 在 Cloudflare 后台的 D1 控制台粘贴执行一次即可。

-- 每个用户一行；data 列以 JSON 保存全部竞猜与关注：
--   { followed:[], bets:{matchId:'home'|'draw'|'away'},
--     scoreBets:{matchId:{home,away}}, goalBets:{matchId:0..6}, championBet:'队名' }
CREATE TABLE IF NOT EXISTS users (
  username   TEXT PRIMARY KEY,
  pwd_hash   TEXT NOT NULL,
  salt       TEXT NOT NULL,
  data       TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

-- 管理员录入的真实比分
CREATE TABLE IF NOT EXISTS results (
  match_id   TEXT PRIMARY KEY,
  home       INTEGER NOT NULL,
  away       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 登录会话
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions (username);
