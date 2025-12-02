
# PureProxy V22 (Dual-Mode Flagship)

兼容 Cloudflare 全栈架构 (React + Workers + D1) 的高级代理 IP 分析平台。
本项目复刻了 `proxyip` 和 `bestcf` 两大类网站的核心功能，提供双模采集与展示。

---

## 🚀 V22 核心特性 (双模引擎)

本项目在一个 Worker 中同时运行两套逻辑，数据分类存储：

### 1. ProxyIP 模式 (反代)
*   **目标**: 获取能反向代理 Cloudflare 的第三方 IP。
*   **源头**: `ymyuuu/IPDB/bestproxy.txt`
*   **逻辑**: **严格剔除 Cloudflare 官方 IP**。只保留 Oracle, Aliyun, DigitalOcean 等第三方 ISP。
*   **用途**: 适合 Worker 回源、隐藏源站 IP。

### 2. BestIP 模式 (优选/加速)
*   **目标**: 获取速度最快的 Cloudflare 边缘节点。
*   **源头**: `ymyuuu/IPDB/bestcf.txt`
*   **逻辑**: **保留 Cloudflare 官方 IP**。解析源文件中的线路备注（如“移动”、“电信”）。
*   **用途**: 适合自建 CDN、科学上网加速、SaaS 接入。

---

## 🛠️ 数据库升级 (必读)

V22 引入了 `type` 字段来区分两种模式。请务必在 Cloudflare D1 Console 执行以下 SQL 进行更新（这会重置旧数据）：

```sql
DROP TABLE IF EXISTS proxies;
CREATE TABLE proxies (
  id TEXT PRIMARY KEY,
  ip TEXT NOT NULL,
  port INTEGER NOT NULL,
  protocol TEXT,
  type TEXT DEFAULT 'proxy', -- 新增: 'proxy' or 'best'
  country TEXT,
  country_code TEXT,
  region TEXT,
  city TEXT,
  isp TEXT,
  is_residential INTEGER DEFAULT 0,
  anonymity TEXT,
  latency INTEGER,
  speed_info TEXT, -- 新增: 测速备注
  purity_score INTEGER,
  cf_pass_prob INTEGER,
  last_checked INTEGER,
  created_at INTEGER,
  UNIQUE(ip, port)
);
CREATE INDEX IF NOT EXISTS idx_type_score ON proxies(type, purity_score DESC);
```

---

## 📦 部署指南

1.  **Worker**: 将 `worker/index.ts` 代码部署到 Cloudflare Worker。绑定 D1 数据库为 `DB`。
2.  **Cron**: 保持 `*/3 * * * *` 的定时任务，Worker 会自动双线程采集。
3.  **Pages**: 部署前端代码，设置环境变量 `REACT_APP_API_URL` 指向 Worker 地址。

---

## 📊 界面说明

*   **ProxyIP 标签页**: 显示第三方反代 IP，关注 ISP 纯净度。
*   **CF 优选 IP 标签页**: 显示官方加速节点，关注“优选线路备注” (如 CMCC/CT/CU)。
