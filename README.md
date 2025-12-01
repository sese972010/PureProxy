# PureProxy 纯净度扫描 (全栈版)

这是一个基于 **Cloudflare 生态系统** 构建的现代化代理 IP 搜索引擎。
它演示了如何使用 Cloudflare 的全套无服务器组件构建应用：
*   **Frontend (前端)**: React + Tailwind CSS (托管在 Cloudflare Pages)
*   **Backend (后端)**: Cloudflare Workers (处理 API 和定时任务)
*   **Database (数据库)**: Cloudflare D1 (SQLite，存储经过验证的 IP)
*   **AI**: Google Gemini / OpenAI (智能分析)

---

## 🛠️ 部署指南 (纯图形化界面版)

本指南旨在让你**无需使用终端命令行 (CLI)**，仅通过浏览器即可在 Cloudflare Dashboard 上完成所有部署。

### 准备工作

1.  注册一个 [Cloudflare 账号](https://dash.cloudflare.com/)。
2.  下载本项目代码到本地，用记事本或代码编辑器打开备用。

---

### 第一步：创建 D1 数据库 (图形化)

1.  登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2.  在左侧菜单点击 **Workers & Pages**。
3.  在子菜单中点击 **D1 SQL Database**。
4.  点击 **Create** (创建) 按钮。
5.  **Database name** 输入: `pureproxy-db`。
6.  点击 **Create**。
7.  **初始化表结构 (重要)**:
    *   创建成功后，点击进入 `pureproxy-db` 详情页。
    *   点击 **Console** (控制台) 标签页。
    *   **复制以下 SQL 代码**，粘贴到网页的 SQL 输入框中：

    ```sql
    DROP TABLE IF EXISTS proxies;
    CREATE TABLE proxies (
      id TEXT PRIMARY KEY,
      ip TEXT NOT NULL,
      port INTEGER NOT NULL,
      protocol TEXT,
      country TEXT,
      country_code TEXT,
      isp TEXT,
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
    CREATE INDEX idx_proxies_protocol ON proxies(protocol);
    ```

    *   点击 **Execute** (执行)。
    *   *看到 "Success" 提示即表示数据库表已建立。*

---

### 第二步：创建并部署后端 Worker (图形化)

我们需要创建一个 Worker 来运行后端逻辑，并将其连接到刚才创建的数据库。

1.  **创建 Worker**:
    *   回到 **Workers & Pages** -> **Overview**。
    *   点击 **Create application** -> **Create Worker**。
    *   Name 输入: `pureproxy-backend`。
    *   点击 **Deploy** (先部署一个默认的 Hello World)。

2.  **绑定数据库**:
    *   部署完成后，点击 **Edit code** 旁边的 **Settings** (设置) 按钮（或者在列表页点击该 Worker 进入 Settings）。
    *   进入 **Settings** -> **Variables** 标签页。
    *   向下滚动到 **D1 Database Bindings** 部分。
    *   点击 **Add binding**。
    *   **Variable name**: 输入 `DB` (必须完全一致，因为代码里用了 `env.DB`)。
    *   **D1 database**: 选择刚才创建的 `pureproxy-db`。
    *   点击 **Deploy** (或 Save and deploy) 保存设置。

3.  **上传代码**:
    *   点击页面右上角的 **Edit code** (编辑代码) 按钮，进入在线编辑器。
    *   在左侧文件列表中，确保只有一个 `worker.ts` (或者 `index.js/ts`)。
    *   打开本地项目中的 `worker/index.ts` 文件，全选并复制内容。
    *   **清空** 在线编辑器中的默认代码，将复制的内容**粘贴**进去。
    *   *(注意：如果在线编辑器提示 `checkProxyConnection` 相关的类型错误，通常不影响部署，因为在线环境会自动处理。)*
    *   点击右上角的 **Deploy**。

4.  **设置定时任务 (Cron)**:
    *   为了让它自动抓取 IP，我们需要配置触发器。
    *   回到 Worker 的详情页 (退出编辑器)。
    *   点击 **Settings** -> **Triggers** 标签页。
    *   点击 **Add Cron Trigger**。
    *   输入频率: `*/30 * * * *` (意为每 30 分钟执行一次)。
    *   点击 **Add Trigger**。

5.  **获取后端地址**:
    *   在 Worker 详情页的顶部，你会看到 **Preview URL** (例如 `https://pureproxy-backend.你的用户名.workers.dev`)。
    *   ⚠️ **请复制这个 URL**，这是你的后端 API 地址。

---

### 第三步：部署前端 (Cloudflare Pages 图形化)

前端部署需要将代码构建后上传，或者连接 GitHub 自动构建。这里推荐 **连接 GitHub** 方式，最为省心。

1.  **准备 GitHub 仓库**:
    *   将本项目代码上传到你自己的 GitHub 仓库。

2.  **创建 Pages 项目**:
    *   回到 Cloudflare Dashboard 的 **Workers & Pages**。
    *   点击 **Create application**。
    *   点击 **Pages** 标签页，选择 **Connect to Git**。
    *   选择你刚才上传的仓库，点击 **Begin setup**。

3.  **构建配置 (Build settings)**:
    在配置页面填写以下信息：
    *   **Project name**: `pureproxy-web`
    *   **Framework preset**: 选择 `Create React App`。
    *   **Build command**: `npm run build` (默认)。
    *   **Output directory**: `build` (默认)。

4.  **配置环境变量 (连接后端)**:
    *   点击 **Environment variables** 展开设置。
    *   添加变量:
        *   **Variable name**: `REACT_APP_API_URL`
        *   **Value**: `https://pureproxy-backend.xxxx.workers.dev` (即第二步最后复制的 URL)。
    *   *(可选) 添加 AI Key*:
        *   `GEMINI_API_KEY`: 你的 Google Gemini Key。

5.  **部署**:
    *   点击 **Save and Deploy**。

---

### 🎉 验证与使用

1.  等待 Pages 构建完成（约 1-2 分钟），点击 Cloudflare 提供的 **Pages URL** 访问网站。
2.  **数据填充**:
    *   刚部署完数据库是空的。
    *   你可以去 Worker 控制台 -> **Settings** -> **Triggers** -> Cron Triggers 部分，点击 **Test** 按钮，手动触发一次抓取。
    *   稍等片刻，刷新网页，即可看到抓取到的真实代理 IP。

---

## 技术栈

*   **Runtime**: Cloudflare Workers
*   **Database**: Cloudflare D1
*   **Frontend**: React 18 + Tailwind CSS
*   **AI**: Google GenAI SDK