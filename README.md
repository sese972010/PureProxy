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

## 🚀 数据源

本项目采用 **FOFA 定向扫描 + 开源聚合兜底** 的混合策略：

1.  **FOFA (推荐)**: 
    *   通过配置 API Key，直接从 FOFA 网络空间测绘引擎抓取。
    *   **策略**: 锁定 `Country="US"` (美国) + `Server="Cloudflare"`，优先获取家宽 IP。
2.  **开源聚合 (兜底)**:
    *   当 FOFA 配额耗尽或未配置时，自动切换至 **ymyuuu/IPDB** 等高质量开源列表。

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
5.  **(可选) 配置 FOFA API**:
    *   Settings -> Bindings -> Environment Variables
    *   添加 `FOFA_EMAIL`: 你的注册邮箱
    *   添加 `FOFA_KEY`: 你的 API Key (在 fofa.info 个人中心查看)
    *   *注: 免费版 FOFA Key 每日/每月有查询限额，Worker 已设置为每次只查 40 条以节省配额。*
6.  点击 **Deploy**。

### 第三步：部署前端 Pages

1.  将代码推送到 GitHub。
2.  在 Cloudflare 创建 Pages 项目，连接 GitHub。
3.  **Build Settings**: Framework preset 选 **Vite**，Output directory 填 **dist**。
4.  **Environment variables**: 添加 `REACT_APP_API_URL`，值为你的 Worker URL (例如 `https://pureproxy-backend.xxx.workers.dev`)。

---

### 🎉 验证与使用

1.  **手动触发抓取**: 去 Worker 的 **Triggers** 页面点击 **Test**。
2.  **查看日志**:
    *   如果配置了 FOFA: `[FOFA] 成功获取 xx 个美国节点`。
    *   如果没配置: `[Source] FOFA 数据不足，切换到公共聚合源...`。
3.  **前端查看**:
    *   刷新网页，列表默认会优先显示 **美国 (US)** 的 **家宽 (Residential)** IP（如果有抓取到）。
    *   家宽 IP 会有独特的绿色标签和较高的纯净度评分。