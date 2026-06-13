# 世界杯比分自动更新服务（Cloudflare Worker · 每 4 小时）

每 4 小时自动运行：找出「已结束但还没比分」的**小组赛**，从数据源抓取比分，写入与前端共享的 **D1 数据库 `results` 表**，前端积分榜随之自动结算。

- 运行在 Cloudflare 云端（有外网、电脑关机也跑）。
- 只处理小组赛 72 场（对阵固定）；淘汰赛对阵需出线后确定，仍走 App 内「赛果录入」手动录入。
- **不会覆盖**已存在的比分（包括管理员手动录入的）。

## 两个可切换的数据源（环境变量 `SOURCE`）

| 源 | 说明 | 需要 |
|---|---|---|
| `footballdata`（**推荐**） | [football-data.org](https://www.football-data.org/) 结构化 JSON，稳定可靠 | 免费 `FOOTBALL_DATA_TOKEN` |
| `baidu` | 百度搜索抓取，尽力而为、可能不稳定/被封 | 无 |

不设 `SOURCE` 时：有 `FOOTBALL_DATA_TOKEN` 就用 `footballdata`，否则退回 `baidu`。
抓不到的场次下次运行会自动重试，且**绝不写入错误数据**。

> 队名匹配：API 返回英文队名，已内置 48 队「中文→英文别名」表（`src/teamNames.js`）做宽松匹配；若某队名对不上，补一条别名即可。

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

### 3. 设置数据源密钥

**推荐：football-data.org（稳定）**
1. 去 https://www.football-data.org/client/register 免费注册，拿到 API Token。
2. 设置为 secret：

```bash
wrangler secret put FOOTBALL_DATA_TOKEN
# 粘贴你的 token
```

`wrangler.toml` 里已默认 `SOURCE = "footballdata"`。若想改用百度，把它改成 `"baidu"`（无需 token）。

（可选）设置手动触发口令：

```bash
wrangler secret put RUN_KEY
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
- **切换数据源**：改 `wrangler.toml` 的 `SOURCE`（`footballdata` / `baidu`）。
- **新增数据源**：在 `src/sources/` 下新建一个模块，导出 `id`、`available(env)`、`resolve(pending, env)`（返回 `{ results:[{id,home,away,info}], note }`），再在 `src/index.js` 的 `SOURCES` 里登记即可，其余逻辑不变。
