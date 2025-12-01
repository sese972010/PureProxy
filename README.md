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

本项目目前采用 **开源聚合 + CDN 加速 + 暴力解析** 的策略，彻底解决了单一数据源不稳定或格式解析失败的问题：

1.  **核心聚合源 (CDN 加速)**: 
    *   通过 `jsDelivr` CDN 镜像访问 `391040525/ProxyIP` 和 `ymyuuu/IPDB`，确保 100% 下载成功率。
2.  **暴力解析技术**:
    *   后端 Worker 使用全局正则扫描下载的内容，无论源文件是 Base64 编码、JSON 格式还是纯文本，均能强制提取出 IP 列表。
3.  **智能优选**:
    *   **家宽优先**: 自动识别 ISP，给予家庭宽带 (Residential) IP 更高权重。
    *   **地区加权**: 给予美国 (US) IP 额外加分，方便访问特定服务。

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
    *   Cron expression: `*/10 * * * *` (建议每10分钟运行一次)
5.  点击 **Deploy**。

### 第三步：部署前端 Pages

1.  将代码推送到 GitHub。
2.  在 Cloudflare 创建 Pages 项目，连接 GitHub。
3.  **Build Settings**: Framework preset 选 **Vite**，Output directory 填 **dist**。
4.  **Environment variables**: 添加 `REACT_APP_API_URL`，值为你的 Worker URL (例如 `https://pureproxy-backend.xxx.workers.dev`)。

---

## ❓ 常见问题排查

### 1. 日志显示 "暴力解析出 0 个 IP"
*   请确认您部署了最新版代码（使用了 `cdn.jsdelivr.net`）。
*   旧版直接连接 GitHub 会被限流。

### 2. 为什么扫描到的 IP 很少？
*   ProxyIP 的验证非常严格（必须能反代 Cloudflare）。市面上 99% 的普通代理都无法通过此验证。
*   为了防止 Worker 超时，每次任务只验证一小批随机抽取的 IP。随着时间推移，数据库中的有效 IP 会越来越多。

### 3. 如何验证部署成功？
*   在 Worker 的 Triggers 页面点击 "Test"。
*   在 Real-time Logs 中看到 `✅ [Valid] ...` 即表示成功抓取并入库。