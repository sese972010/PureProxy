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

## 🚀 数据源与策略 (v5.0 终极版)

本项目采用 **"暴力解析 + 智能回退"** 策略，彻底解决了 GitHub 源格式混乱和访问受限的问题：

1.  **数据源组合**: 
    *   **391040525/ProxyIP**: 采用原始 GitHub 链接 + User-Agent 伪装，确保获取最新的活跃 IP。
    *   **ymyuuu/IPDB**: 采用 jsDelivr CDN 加速，支持 Base64 解码。
    *   **vfarid/cf-ip-scanner**: 支持无端口纯 IP 列表解析（自动补全 443 端口）。
2.  **暴力解析技术**:
    *   后端 Worker 使用全局正则 `/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g` 扫描下载的内容。
    *   无论源文件是 Base64、JSON 还是纯文本，也无论是否带端口，均能强制提取。
3.  **智能优选**:
    *   **家宽优先**: 自动识别 ISP，给予家庭宽带 (Residential) IP 更高权重（基础分 +20）。
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
5.  **可选 AI 配置**: 添加 `GEMINI_API_KEY` 或 `OPENAI_API_KEY` 以启用智能分析功能。

---

## ❓ 常见问题排查

### 1. 为什么 Worker 日志里还是 "0 个 IP"?
*   请确认您已经部署了 **v5.0 版本** 的代码（`worker/index.ts` 里包含 `extractIPs` 函数且正则支持可选端口）。
*   旧代码不支持无端口 IP 列表，会导致 `vfarid` 源解析失败。

### 2. 验证成功率很低？
*   这是正常的。由于我们扫描的是 **"能反代 Cloudflare 的 IP"**，验证条件极其苛刻（必须返回 `Server: cloudflare`）。
*   通常 1000 个公共代理里只有 1-5 个符合此条件。但一旦找到，质量极高。

### 3. 如何验证部署成功？
*   在 Worker 的 Triggers 页面点击 "Test"。
*   在 Real-time Logs 中看到 `✅ [Valid] ...` 即表示成功抓取并入库。