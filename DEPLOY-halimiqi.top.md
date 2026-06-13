# 部署到 halimiqi.top（腾讯云 EdgeOne Pages + DNSPod 解析）

针对你的真实域名信息定制：

| 项 | 值 |
|---|---|
| 域名 | `halimiqi.top` |
| 注册商 | 阿里云（HiChina / 万网） |
| 当前 DNS 托管 | **DNSPod（腾讯云）**：`grape.dnspod.net` / `narcissus.dnspod.net` |
| 部署平台 | 腾讯云 EdgeOne Pages（中国大陆/全球区域，国内快） |
| 后端 | `edge-functions/` + KV 存储（EdgeOne 自动识别） |

> 说明：阿里云控制台提示"把 DNS 改成 `ns1/ns2.alidns.com`"是阿里云想把解析切回它家。你**当前生效的解析在 DNSPod**，所以下面所有解析记录都在 **DNSPod 控制台**操作，**不要**改 NS。

---

## ⚠️ 第 0 步（硬前提）：ICP 备案

EdgeOne 选「中国大陆 / 全球」区域时，绑定自有域名 **必须先完成 ICP 备案**，否则无法绑定、访问会被拦截。

- 用平台分配的默认域名（形如 `xxx.edgeone.app`）**无需备案**，可先用它把功能跑起来。
- 绑 `halimiqi.top` 前，去 [腾讯云备案控制台](https://console.cloud.tencent.com/beian) 办理，**接入商选腾讯云**，约 1–2 周。
- 备案通过后再回来做第 6、7 步绑定域名。

---

## 第 1–5 步：先把项目部署到 EdgeOne（拿到默认域名）

完整细节见 `DEPLOY-edgeone.md`，要点：

1. 代码已在 GitHub `Anastaria/worldcup2026`（已推送）。
2. [EdgeOne Pages 控制台](https://pages.edgeone.ai/) → 创建项目 → 导入该仓库；构建命令留空，输出目录 `/`，加速区域选 **中国大陆 / 全球**。
3. 存储 → KV → 开通 → 创建命名空间 `worldcup2026`。
4. 项目 → KV 存储 → 绑定命名空间，**运行时变量名必须为 `WC_KV`**。
5. 项目 → 环境变量 → 新增 `ADMIN_SECRET`（管理员录比分口令）→ 重新部署。

完成后会有一个默认域名（如 `worldcup2026.edgeone.app`），先用它确认登录/竞猜/积分榜都正常。

---

## 第 6 步：在 EdgeOne 添加自定义域名（备案通过后）

1. 进入 EdgeOne Pages 项目 → **域名管理 / 自定义域名** → **添加域名**。
2. 填 `halimiqi.top`，按需再加一个 `www.halimiqi.top`。
3. EdgeOne 会给出一个 **CNAME 目标值**（形如 `xxxx.eo.dnse.com` 之类，以控制台显示为准）。**把它复制下来**，第 7 步要用。
4. 证书：EdgeOne 会为绑定的域名**自动签发并续期 HTTPS 证书**，无需手动操作。

---

## 第 7 步：在 DNSPod 添加解析记录

进入 [DNSPod 控制台](https://console.dnspod.cn/) → 选择 `halimiqi.top` → 添加记录：

| 主机记录 | 记录类型 | 记录值 | 说明 |
|---|---|---|---|
| `@` | CNAME | 第 6 步 EdgeOne 给的 CNAME 目标 | 根域名 `halimiqi.top` |
| `www` | CNAME | 同上 | `www.halimiqi.top`（如添加了 www） |

注意：
- 主机记录 `@` 表示根域名本身；DNSPod 支持给 `@` 配 CNAME。
- 若 `@` 处已有其它 A / CNAME 记录（比如旧站点），先删掉冲突记录再加。
- TTL 用默认（600）即可。
- 解析生效一般几分钟，最长可能十几分钟。

生效后访问 `https://halimiqi.top` 即为你的应用，把链接发到微信即可。

---

## ✅ 验证清单

- [ ] 默认 `*.edgeone.app` 域名能正常注册/登录/竞猜
- [ ] ICP 备案通过（接入商=腾讯云）
- [ ] EdgeOne 已添加自定义域名 `halimiqi.top`，状态正常、证书已签发
- [ ] DNSPod 已加 `@`（及 `www`）的 CNAME，指向 EdgeOne 给的值
- [ ] 浏览器访问 `https://halimiqi.top` 显示应用，HTTPS 锁正常

---

## ⚠️ 关于"每 4 小时自动更新比分"

`cron-worker/` 那套是 **Cloudflare 专用**（Cloudflare D1 + Cloudflare Cron）。

- 你前端部署在 **EdgeOne（用 KV，不是 D1）**，所以那个 Worker **不会**更新 EdgeOne 上的比分数据 —— 两边数据存储不互通。
- 在 EdgeOne 方案下，比分有两种办法：
  1. **手动录入**：进「我的 → 🛠️ 赛果录入」，输入 `ADMIN_SECRET` 后录入（默认可用）。
  2. **自动更新（需另做）**：为 EdgeOne 单独写一套定时更新（EdgeOne 定时触发 + 写 KV + football-data.org/百度抓分）。需要的话告诉我，我来做 EdgeOne 版。
