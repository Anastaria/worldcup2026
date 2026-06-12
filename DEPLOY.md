# 部署指南 · 云端共享版

本应用已从「单机本地」升级为「云端共享」：所有人打开同一个网址，注册的账号、竞猜、积分榜都存在云端，大家在同一个积分榜里 PK。

技术栈：**Cloudflare Pages（静态前端）+ Pages Functions（后端 API）+ D1 数据库（云端 SQLite）**，全部免费，国内微信可直接打开。

---

## 一、整体流程（约 10 分钟）

1. 把代码推到 GitHub（已有仓库 `Anastaria/worldcup2026`）
2. 在 Cloudflare 创建 D1 数据库并建表
3. 创建 Pages 项目，连接 GitHub 仓库
4. 给 Pages 项目绑定 D1 + 设置管理员口令
5. 部署，拿到 `https://xxx.pages.dev` 网址发给好友

---

## 二、详细步骤

### 第 0 步：推送代码

```bash
git add -A
git commit -m "feat: 云端共享积分榜（Cloudflare Pages Functions + D1）"
git push
```

### 第 1 步：创建 D1 数据库

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)
2. 左侧菜单 **Storage & Databases → D1 SQL Database**（或 Workers & Pages → D1）
3. 点 **Create database**，名字填 `worldcup2026`，创建
4. 进入这个数据库，点 **Console**（控制台）标签
5. 把仓库根目录 `schema.sql` 的全部内容**粘贴进去执行一次**（建好 4 张表）

### 第 2 步：创建 Pages 项目并连接 GitHub

1. 左侧 **Workers & Pages → Create → Pages → Connect to Git**
2. 授权并选择仓库 `Anastaria/worldcup2026`
3. 构建配置（纯静态、无需构建）：
   - **Framework preset**：`None`
   - **Build command**：留空
   - **Build output directory**：填 `/`
4. 点 **Save and Deploy**（先部署一次，让项目生成）

> `functions/` 目录会被 Cloudflare 自动识别为后端 API，无需任何额外配置。

### 第 3 步：绑定 D1 数据库（关键）

1. 进入刚建好的 Pages 项目 → **Settings → Bindings**（旧版叫 Functions → D1 database bindings）
2. 点 **Add → D1 database**
   - **Variable name（变量名）**：必须填 `DB`（大写，代码里就是 `env.DB`）
   - **D1 database**：选 `worldcup2026`
3. 保存

### 第 4 步：设置管理员口令

1. 同样在 Pages 项目 → **Settings → Variables and Secrets**（环境变量）
2. 添加一条：
   - **Name**：`ADMIN_SECRET`
   - **Value**：自己设一个口令，比如 `wc2026admin`（只有你知道，用来录入真实比分）
   - 建议类型选 **Secret**（加密）
3. 保存

### 第 5 步：重新部署生效

绑定和环境变量改完后，需要**重新部署一次**才生效：
- Pages 项目 → **Deployments** → 最新一条右侧 **⋯ → Retry deployment**
- 或者直接再 `git push` 一次触发部署

完成后访问 `https://你的项目名.pages.dev`，把链接发到微信即可。

---

## 三、怎么用

- **好友**：打开网址 → 注册账号 → 关注球队、竞猜，自动进入共享积分榜
- **你（管理员）**：比赛结束后，进「我的 → 🛠️ 赛果录入」，第一次保存比分时会让你输入**管理员口令**（就是 `ADMIN_SECRET` 的值），口令会记在本机；录入真实比分后，所有人的积分自动结算更新
- **积分规则**：只有**录入了真实比分**的比赛才结算积分（官方已赛的 2 场揭幕日比赛已内置为真实结果）；模拟比分只用于展示淘汰赛对阵，不计分
- 「梅西铁粉、老王看球」等 5 个演示玩家是前端虚拟的，纯热闹用，不影响真实好友

---

## 四、本地调试（可选）

本地直接双击 `index.html` 打开会因为没有 `/api` 而无法登录/竞猜（会提示“无法连接服务器”，但赛程、球队榜仍可看）。要在本地完整测试需用 `wrangler`：

```bash
npm i -g wrangler
wrangler pages dev . --d1 DB=worldcup2026
```

并先用 `wrangler d1 execute worldcup2026 --local --file=schema.sql` 在本地库建表。

> 不调试也完全没关系，直接按上面的步骤部署到 Cloudflare 即可。

---

## 五、数据/隐私说明

- 密码在云端以「加盐 SHA-256 哈希」存储，不存明文；但这是个朋友间的娱乐应用，**请勿使用与其他重要账号相同的密码**。
- 所有竞猜数据存在你自己的 Cloudflare D1 数据库里，归你所有。
