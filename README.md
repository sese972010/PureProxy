
# PureProxy 纯净度分析台 (Manual Analysis Mode)

这是一个基于 Cloudflare 全栈架构 (React + Workers + D1) 的 ProxyIP 纯净度分析工具。
由于全自动抓取 IP 在 Cloudflare 环境下存在诸多网络限制，本项目已转型为 **“辅助分析工具”**。

用户可以手动粘贴来自其他来源（如 `proxyip.chatkg.qzz.io`）的 IP 列表，本工具将利用 Worker 后端进行：
1.  **实时 Geo-IP 查询**: 获取国家、城市、ISP 等信息。
2.  **纯净度打分**: 识别是否为家庭宽带、是否为优质云厂商 (Oracle/Aliyun)。
3.  **风险评估**: 结合 Gemini AI 对 IP 进行深度风控分析。

---

## 🚀 核心功能

1.  **手动导入**: 支持粘贴 `IP:Port` 列表，后端并发分析。
2.  **ISP 识别**: 自动标记 **家宽 (Residential)** 和 **数据中心 (Datacenter)**。
3.  **评分系统**:
    *   家宽 +30分
    *   热门地区 (US/SG/JP) +10分
    *   Cloudflare 官方 IP -10分 (因无法反代 CF 自身)
4.  **数据持久化**: 分析过的 IP 会自动存入 Cloudflare D1 数据库，形成个人的优选库。

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
    ```

### 第二步：部署后端 Worker (图形化)

1.  **Edit code**: 将 `worker/index.ts` 的代码复制粘贴到 Cloudflare 编辑器。
2.  **Bindings**: Settings -> Bindings -> Add -> D1 Database -> 绑定变量名 `DB` 到 `pureproxy-db`。
3.  **Deploy**: 点击部署。
4.  **获取 URL**: 复制部署后的 Worker URL (如 `https://pureproxy-backend.xxx.workers.dev`)。

### 第三步：部署前端 Pages

1.  将代码推送到 GitHub。
2.  在 Cloudflare 创建 Pages 项目，连接 GitHub。
3.  **Build Settings**: Framework preset 选 **Vite**，Output directory 填 **dist**。
4.  **Environment variables**: 
    *   `REACT_APP_API_URL`: 填入你的 Worker URL。
    *   `API_KEY` (可选): 填入 Gemini API Key 用于 AI 分析。

---

## ❓ 使用方法

1.  打开部署好的前端网页。
2.  在文本框中粘贴 IP 列表（每行一个 `IP:端口`）。
3.  点击 **“开始分析纯净度”**。
4.  等待几秒，列表将自动刷新，显示详细的 ISP、位置和评分信息。
