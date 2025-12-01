
# PureProxy 纯净度扫描 (Cloudflare ProxyIP 版)

这是一个基于 **Cloudflare 生态系统** 构建的 **ProxyIP** 专用搜索引擎。
它可以自动扫描、验证并分类那些能够反向代理 Cloudflare 服务的优质 IP（优选反代 IP）。

---

## 📖 什么是 ProxyIP？

在 Cloudflare Workers 环境中，**ProxyIP** 特指那些能够成功代理连接到 Cloudflare 服务的第三方 IP 地址。

### 🔧 技术原理
Cloudflare Workers 存在限制，无法直接连接到 Cloudflare 自有的 IP 段（回环限制）。为了绕过此限制，我们需要寻找第三方服务器作为“跳板”：

`Cloudflare Workers` (发起请求) -> **`ProxyIP 服务器`** (第三方代理) -> `Cloudflare 服务` (目标)

✅ **有效 ProxyIP 特征**：
1.  **非 Cloudflare IP**: IP 本身不能属于 Cloudflare CDN 范围（如 104.16.x.x），否则 Workers 无法连接。
2.  **反向代理能力**: 当我们向其发送 `Host: speed.cloudflare.com` 请求时，它能正确转发并返回包含 `Server: cloudflare` 的响应头。

---

## 🚀 核心策略 (v8.0 - 并发批处理版)

本项目采用 **"并发验证 + 批量写入"** 的高性能架构，极大提升了免费版 Worker 的利用率：

1.  **并发批处理 (Concurrent Batching)**: 
    *   **并行验证**: 每次同时验证 20 个 IP，而非排队等待。
    *   **高吞吐**: 单次 Cron 任务可处理 200+ 个 IP，效率提升 6 倍。
2.  **D1 批量写入 (Batch Insert)**:
    *   使用 `env.DB.batch()` 技术，一次性将几十条有效数据写入数据库。
    *   避免了"查一个写一个"的高频 IO，保护数据库配额。
3.  **智能流控**:
    *   内置 Geo-IP API 速率限制保护，防止并发过高导致 IP 被封。
4.  **回环防御 (CIDR Filtering)**: 
    *   验证前自动剔除 Cloudflare 官方 IP 段，防止死锁。

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
    *   Cron expression: `*/2 * * * *` (建议每 2 分钟运行一次，因为并发版效率高，可以跑得更勤)
5.  点击 **Deploy**。

### 第三步：部署前端 Pages

1.  将代码推送到 GitHub。
2.  在 Cloudflare 创建 Pages 项目，连接 GitHub。
3.  **Build Settings**: Framework preset 选 **Vite**，Output directory 填 **dist**。
4.  **Environment variables**: 添加 `REACT_APP_API_URL`，值为你的 Worker URL。

---

## ❓ 常见问题排查

### 1. 为什么日志显示 "批次 1: 发现 0 个有效"?
这是正常的。我们是在从“垃圾堆”里找金子。原始列表中大部分 IP 是失效的，或者属于 Cloudflare 自己的 IP（被过滤了）。只要偶尔看到 "发现 X 个有效" 就是成功。

### 2. 数据库什么时候有数据？
第一次运行 Cron 可能需要几分钟。由于使用了批量写入，有效 IP 会在每次批处理结束时统一入库。

### 3. 如何验证？
在 Worker 的 Logs 中，如果您看到 `数据库写入成功！` 字样，说明流程完全通畅。
