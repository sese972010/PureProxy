# PureProxy 纯净度扫描 (Cloudflare ProxyIP 版)

这是一个基于 **Cloudflare 生态系统** 构建的 **ProxyIP** 专用搜索引擎。
它可以自动扫描、验证并分类那些能够反向代理 Cloudflare 服务的优质 IP（优选反代 IP）。

---

## 📖 什么是 ProxyIP？

在 Cloudflare Workers 环境中，**ProxyIP** 特指那些能够成功代理连接到 Cloudflare 服务的第三方 IP 地址。

### 🔧 技术原理
Cloudflare Workers 存在限制，无法直接连接到 Cloudflare 自有的 IP 段。为了绕过此限制，我们需要寻找第三方服务器作为“跳板”：

`Cloudflare Workers` (发起请求) -> **`ProxyIP 服务器`** (第三方代理) -> `Cloudflare 服务` (目标)

✅ **有效 ProxyIP 特征**：
1.  **网络连通性**: 开放了 443 或 80 端口。
2.  **反向代理能力**: 当我们向其发送 `Host: speed.cloudflare.com` 请求时，它能正确转发并返回包含 `Server: cloudflare` 的响应头。

---

## 🚀 数据源与策略

本项目采用 **FOFA 定向扫描 + 开源聚合兜底** 的混合策略：

1.  **FOFA (VIP/免费版)**: 
    *   通过配置 API Key，直接从 FOFA 网络空间测绘引擎抓取。
    *   **搜索语法**: `server=="cloudflare" && port="443" && country="US"`
    *   **策略**: 优先抓取美国 IP。
2.  **开源聚合 (兜底)**:
    *   当 FOFA 配额耗尽或未配置时，自动切换至 **ymyuuu/IPDB** 等高质量开源列表。
    *   智能解析 Base64 订阅内容，提取 IP。

---

## 🛠️ 部署指南

### 第一步：创建 D1 数据库

1.  在 Cloudflare Dashboard 点击 **Workers & Pages** -> **D1 SQL Database** -> **Create**。
2.  数据库名称填写: `pureproxy-db`。
3.  创建后进入 **Console (控制台)** 标签页，**复制并执行以下 SQL 代码** (请先删除旧表)：

    ```sql
    DROP TABLE IF EXISTS proxies;
    CREATE TABLE proxies (
      id TEXT PRIMARY KEY,
      ip TEXT NOT NULL,
      port INTEGER NOT NULL,
      protocol TEXT,
      country TEXT,
      country_code TEXT,
      region TEXT,
      city TEXT,
      isp TEXT,
      is_residential INTEGER DEFAULT 0,
      anonymity TEXT,
      latency INTEGER,
      purity_score INTEGER,
      cf_pass_prob INTEGER,
      last_checked INTEGER,
      created_at INTEGER,
      UNIQUE(ip, port)
    );
    CREATE INDEX idx_proxies_purity ON proxies(purity_score DESC);
    CREATE INDEX idx_proxies_country ON proxies(country_code);
    CREATE INDEX idx_proxies_residential ON proxies(is_residential);
    ```

### 第二步：部署后端 Worker

1.  创建名为 `pureproxy-backend` 的 Worker。
2.  点击 **Edit code**，将 `worker/index.ts` 的内容复制粘贴进去。
3.  **配置 D1 绑定**: 
    *   Settings -> Bindings -> Add -> D1 Database
    *   Variable name: `DB`
    *   Database: `pureproxy-db`
4.  **配置定时任务**:
    *   Settings -> Triggers -> Cron Triggers -> Add Cron Trigger
    *   Cron expression: `*/30 * * * *` (每30分钟运行一次)
5.  **(强烈推荐) 配置 FOFA API**:
    *   Settings -> Bindings -> Environment Variables
    *   添加 `FOFA_EMAIL`: 你的注册邮箱
    *   添加 `FOFA_KEY`: 你的 API Key (在 fofa.info 个人中心查看)
    *   *注: 免费版 FOFA 每日有查询限额，请勿将 Cron 频率设置过高。*
6.  点击 **Deploy**。

### 第三步：部署前端 Pages

1.  将代码推送到 GitHub。
2.  在 Cloudflare 创建 Pages 项目，连接 GitHub。
3.  **Build Settings**: Framework preset 选 **Vite**，Output directory 填 **dist**。
4.  **Environment variables**: 添加 `REACT_APP_API_URL`，值为你的 Worker URL (例如 `https://pureproxy-backend.xxx.workers.dev`)。

---

## ❓ 常见问题排查

### 1. FOFA 日志报错
在 Worker -> Logs 中查看：
*   `[FOFA] API 错误: 820000: F-Coin is not enough` -> 积分不足。解决方法：等待第二天刷新或充值。Worker 会自动切换到公共源。
*   `[FOFA] API 错误: 40001: Account invalid` -> 邮箱未验证或 Key 错误。

### 2. 公共源只解析出 1 个 IP
*   这通常是因为源返回了 Base64 编码。最新版代码已修复此问题，支持自动 Base64 解码。

### 3. 为什么扫描到的 IP 很少？
*   ProxyIP 的验证非常严格（必须能反代 Cloudflare）。市面上 99% 的普通代理都无法通过此验证。
*   每次扫描任务限制了运行时间（防止超时），每次只新增 5-8 个有效 IP 是正常的。建议让定时任务多跑几天，数据库就会丰富起来。
