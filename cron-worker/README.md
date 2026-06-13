# 世界杯比分自动更新服务（Cloudflare Worker · 每 4 小时）

每 4 小时自动运行：找出「已结束但还没比分」的**小组赛**，从百度搜索抓取比分，写入与前端共享的 **D1 数据库 `results` 表**，前端积分榜随之自动结算。

- 运行在 Cloudflare 云端（有外网、电脑关机也跑）。
- 只处理小组赛 72 场（对阵固定）；淘汰赛对阵需出线后确定，仍走 App 内「赛果录入」手动录入。
- **不会覆盖**已存在的比分（包括管理员手动录入的）。

> ⚠️ 百度搜索页是反爬动态 HTML，比分解析为「尽力而为」，不保证每场都成功；抓不到的场次下次运行会重试，不会写错误数据。如需更稳定可改接足球数据 API（改 `src/index.js` 里的 `fetchScoreFromBaidu` 即可）。

---

## 部署步骤（约 5 分钟）

前提：已按根目录 `DEPLOY.md` 建好 D1 数据库 `worldcup2026` 并部署了 Pages 前端。

### 1. 安装 wrangler 并登录

```bash
cd cron-worker
npm i -g wrangler
wrangler login
```

### 2. 填入 D1 database id

打开 `wrangler.toml`，把 `database_id` 改成你的真实 id：

```bash
wrangler d1 list        # 列出你的 D1 数据库，复制 worldcup2026 的 id
```

把 id 粘贴到 `wrangler.toml` 的 `database_id = "..."`。

### 3.（可选）设置手动触发口令

```bash
wrangler secret put RUN_KEY
# 按提示输入一个口令，用于手动触发 /run
```

### 4. 部署

```bash
wrangler deploy
```

部署成功后：
- **定时任务**：每 4 小时（UTC 0/4/8/12/16/20 点）自动运行，无需干预。
- **手动测试**：浏览器或 curl 访问 `https://worldcup2026-score-cron.<你的子域>.workers.dev/run?key=你的RUN_KEY`，会立即跑一次并返回本次抓取/写入的明细 JSON。
- **看日志**：`wrangler tail` 实时查看每次 cron 的运行结果。

---

## 调整

- **改频率**：编辑 `wrangler.toml` 的 `crons`，例如每 2 小时 `["0 */2 * * *"]`。
- **单次抓取上限**：`src/index.js` 的 `MAX_FETCH_PER_RUN`（默认 25，规避频率/子请求限制）。
- **比赛结束判定缓冲**：`MATCH_END_BUFFER_MS`（默认开球后 2 小时 10 分）。
- **换数据源**：替换 `fetchScoreFromBaidu`，返回 `{ ok:true, score:{home,away} }` 即可，其余逻辑不变。
