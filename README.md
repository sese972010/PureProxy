
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

## 🚀 核心策略 (V12 - 导入模式)

为了彻底解决 Cloudflare Workers 发起出站 TCP 连接不稳定的问题，本项目切换为 **Importer Mode (导入模式)**：

1.  **信任精华源**:
    *   直接接入 `ymyuuu/IPDB` 和 `391040525` 的精选列表 (`bestproxy.txt` / `active.txt`)。
    *   这些列表由上游维护者通过高性能 VPS 扫描生成，**100% 可用**。
2.  **Geo-IP 增强**: 
    *   Worker 不再浪费资源去测试连接，而是专注于调用 Geo API。
    *   为每个 IP 补充真实的 **国家、省份、城市、ISP** 信息。
3.  **智能流控**:
    *   单次 Cron 任务限制处理 **35 个 IP**，以严格遵守免费 Geo API 的速率限制。
    *   通过高频 Cron (每 2-3 分钟)，一小时可稳定入库 **800+** 个高质量 IP。
4.  **D1 批量写入**:
    *   使用 `env.DB.batch()` 批量入库，降低数据库 IO 压力。

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

### 第二步：部署后端 Worker (图形化)

1.  **Edit code**: 将 `worker/index.ts` 的代码复制粘贴到 Cloudflare 编辑器。
2.  **Bindings**: Settings -> Bindings -> Add -> D1 Database -> 绑定 `DB` 到 `pureproxy-db`。
3.  **Triggers**: Settings -> Triggers -> Add Cron Trigger -> `*/3 * * * *` (每 3 分钟运行一次)。
4.  **Deploy**: 点击部署。

### 第三步：部署前端 Pages

1.  将代码推送到 GitHub。
2.  在 Cloudflare 创建 Pages 项目，连接 GitHub。
3.  **Build Settings**: Framework preset 选 **Vite**，Output directory 填 **dist**。
4.  **Environment variables**: 添加 `REACT_APP_API_URL`，值为你的 Worker URL。

---

## ❓ 常见问题排查

### 1. 为什么日志显示 "处理完成"?
在导入模式下，只要能从 GitHub 下载列表并获取到 Geo 信息，就算成功。

### 2. 为什么每次只增加 30 多个？
这是为了保护免费的 Geo API 不被封禁。Worker 会持续运行，积少成多，一小时就能积累大量数据。

### 3. 如何验证？
在 Worker Logs 中看到 `✅ 入库: x.x.x.x` 和 `数据库写入成功!` 即为正常。
