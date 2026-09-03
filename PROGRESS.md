# PI WEB 部署项目进度（截至 2026-08-19）

## 项目概述
将 PI WEB（pi coding agent 官方 Web UI）部署到边缘/Serverless 平台。当前两个并行方向：
- **PI-edgeone**（已完成，运行中）：EdgeOne Makers 部署
- **PI-vercel**（设计中）：Vercel Sandbox + Functions 部署

---

## 一、PI-edgeone（EdgeOne Makers）—— 已完成 ✅

### 仓库
- GitHub: `Pandasweet7/PI-edgeone`
- 本地: `/root/pi-web-makers`
- 最新远程提交: `7d2f219`（HEAD = origin/main，干净）
- ⚠️ GitHub token 已失效，需要新 token 才能推送后续修改

### 已修复的所有问题

| # | 问题 | 根因 | 修复提交 |
|---|---|---|---|
| 1 | 模型选择器为空 | 网关 gzip 压缩 + 代理透传错误头，大响应损坏 | `ba06299` |
| 2 | 项目路径/工作区丢失 | `projects.json` 不在快照 | `7e9347f` |
| 3 | base64 解码器 bug | `indexOf('=')` 返回 -1，损坏填充目标 | `b398e3d` |
| 4 | SSE 不流式（对话结束后才显示） | SSE 路由用了浏览器 id 的 sidecar，与 REST 不同 | `ab8c2ab` |
| 5 | 上传的文件不保存 | `.pi-web` 同时被点目录/黑名单跳过 | `3094291` |
| 6 | 对话消失（跨浏览器） | `context.conversation_id` 按浏览器隔离 | `7d2f219` |
| 7 | Archived 会话丢失 | 归档目录不在快照 | `7d2f219` |
| 8 | 文件上传报错 | XHR 缺 `makers-conversation-id` 头 | `f42d6d2` |
| 9 | FREEAPI 模型警告 | 用户已手动删除（跳过） | — |

### 关键架构决策（已落地）
- **稳定 conversation id**：agent 端从 `SITE_USERNAME` 派生 FNV-1a 哈希，所有浏览器共享同一 conversation
- **快照持久化**：projects.json + archived-sessions + workspace files（含 .pi-web/uploads 二进制 base64）+ sessions（保留最新，丢最旧）
- **gzip 修复**：`accept-encoding: identity` 上游 + 干净响应头（不透传 content-encoding/connection）
- **XHR 包装**：bootstrap 里 hook XMLHttpRequest 添加 `makers-conversation-id` 头

### 验证结果（用户确认）
- `conversationIdentity`: 两个值都是 `uc738dfcf` → 稳定 id 生效
- `crossConversationStore`: skipped（request id == stable id）→ 中间件改写成功
- `persistenceFs.uploads`: `manifest.yml` (310 bytes) 已持久化
- 模型切换正常工作
- 跨浏览器会话共享正常

### 未推送的本地状态
- 本地 HEAD = `7d2f219` = origin/main（干净，无未推送提交）
- 之前有个 FREEAPI 清理提交已丢弃（用户自行删除了）

---

## 二、PI-vercel（Vercel Sandbox + Functions）—— M1 代码完成，待部署实测

### 仓库
- 本地: `/root/pi-vercel`（已 git init，初始提交 `0a55bec`）
- 尚未推送到 GitHub（需要新 token）

### 设计文档
- `/root/pi-vercel/docs/DESIGN.md` — 完整设计（架构/生命周期/风险/里程碑/版本策略，已同步 M1 实现状态）

### 核心架构洞察
Vercel Sandbox 是完整 Linux microVM（child_process/Docker/真文件系统/完整网络栈），pi-web 原样跑在里面。**不需要 EdgeOne 版那些补丁**（不 fork 客户端、不折叠代理、不 hook XHR、不手写快照——沙箱默认自动快照/恢复整个 32GB 盘）。

### 请求流
```
浏览器 → Vercel Function
   1. Basic Auth（同 EdgeOne 契约）
   2. fnv1a(SITE_USERNAME) → 沙箱名（每用户一个，天然跨浏览器）
   3. Sandbox.getOrCreate()  ← 冷则毫秒级从快照 resume（整盘还原）
   4. 幂等 BOOT_SCRIPT 拉起 pi-web-sessiond + pi-web-server + 就绪轮询
   5. 反代 HTTP/SSE → 沙箱 8504 端口（流式，accept-encoding: identity）
```

### 版本策略（已写入设计）
- Vercel 用 **stock pi-web**（不需要 fork），直接装 npm 最新版
- `@jmfederico/pi-web` = **1.202608.2**（当前最新）
- `@earendil-works/pi-coding-agent` = **0.84.4**（pi-web 自带，^0.84.1 解析到此）
- 版本常量集中在 `src/lib/versions.ts`
- **Sandbox SDK**：`@vercel/sandbox` **3.2.1**（^1.x 无命名沙箱/持久化 API，已核实不可用）

### 已创建/实现的文件
```
PI-vercel/
├─ docs/DESIGN.md           ★ 完整设计文档（已同步 M1）
├─ src/lib/
│  ├─ stableId.ts         ✅ fnv1a(用户名) → 沙箱名
│  ├─ auth.ts             ✅ Basic Auth
│  ├─ config.ts           ✅ env 读取（含 SANDBOX_* 字段）
│  ├─ versions.ts         ✅ 版本常量（pi-web 1.202608.2, pi 0.84.4）
│  ├─ sandbox.ts          ✅ M1：getOrCreate + BOOT_SCRIPT + waitForStatus + keepAlive
│  └─ proxy.ts            ✅ M1：HTTP/SSE 流式反代（identity 编码；WS 待 M3）
├─ api/proxy/index.ts + [...path].ts ✅ M1：auth→沙箱→反代 主入口（仓库根 api/）
├─ vercel.json              ✅ rewrites + functions 配置（maxDuration 300）
├─ package.json             ✅ @vercel/sandbox 3.2.1
├─ tsconfig.json            ✅ strict + Bundler resolution
└─ .env.example             ✅ 完整 env 契约
```

### M1 关键实现决策
- ❗ **`package.json` 必须保留 `"type": "module"`**：`@vercel/node` 输出的是 **ESM 语法**的 JS（不转成 require），没有该字段 Node 会把 `.js` 当 CJS 加载，报 "Cannot use import statement outside a module"（实际踩过）。同时**所有相对导入必须带 `.js` 扩展名**（Node ESM 解析器要求），否则 `ERR_MODULE_NOT_FOUND`（也踩过）。正确组合：`type: module` + 相对导入全写 `.js` 后缀。已用 `/var/task` 布局本地 ESM 冒烟测试验证（401/501/502 均符合预期）。
- ❗ **不能用 `functions` 块配 maxDuration**：文件名的 `[[...path]]` 在 glob 里是字符类，键匹配不上会直接构建失败（"doesn't match any Serverless Functions"）；而 Hobby 默认 maxDuration 本就是 300s（上限也是 300s），该配置零收益。已删除 `functions` 块。
- ❗ **路由入口**：不能用可选 catch-all 文件名 `[[...path]]` —— legacy `api/` 目录路由不认双括号（Next.js 的约定），会直接 404。改成两个明确入口：`api/proxy/index.ts`（根路径）+ `api/proxy/[...path].ts`（其余，单括号 catch-all），vercel.json 用两条 rewrite 分别路由 `/` 和 `/((?!api/proxy/).*)`。
- **SDK 3.2.1**：`getOrCreate({name, resume, region, image?, resources:{vcpus}, timeout, ports, persistent, snapshotExpiration, keepLastSnapshots:{count}, env, onCreate, onResume})`；`domain(port)` 同步返回公网 origin；`runCommand` 返回 `CommandFinished`（异步 stdout()/stderr()）。
- **幂等启动**：`onResume` 在沙箱已运行时不触发，故 getOrCreate 之后无条件跑 BOOT_SCRIPT（pidfile + kill -0 防重复；node fetch 探测 HTTP，不依赖 pgrep/curl）。
- **两个进程**：`pi-web-sessiond`（先）→ `pi-web-server`（后），与官方 Docker 一致。
- **密钥安全**：API key 只在 runCommand 的 per-command env 注入，不写进 `env:`（避免入快照）；models.json 用 `$AI_GATEWAY_API_KEY` 占位（pi 启动时按 env 展开）。
- **反代**：`accept-encoding: identity` 上游 + 删响应 content-encoding/content-length + `cache-control: no-store`（防 gzip 缓冲 SSE，同 EdgeOne bug #1）。
- **路径还原**：根路径由 `index.ts`（空 segments）落到 `/`；其余由 `[...path].ts` 落到 `/` + 各段。
- **typecheck**：`npm run typecheck` 通过。

### 4 个决策点（已确认 ✅）
1. WS：先 Function WS beta 反代，跑不通再退 WS→SSE 桥。
2. 镜像：v1 托管镜像+开机安装 → v2 VCR 自定义镜像。
3. 区域：默认 iad1。
4. 安全：所有流量只经 Function，不下发沙箱 URL。

### 里程碑
| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 设计确认 | ✅ 完成 |
| M1 | Function 层骨架：auth + sandbox + HTTP/SSE 反代 | ✅ 代码完成 + typecheck 通过；待部署实测 |
| M2 | 持久化验证 | ⏳ 待 M1 部署后验证 |
| M3 | WebSocket（终端 + 事件流） | ⏳ 未开始（当前 501） |
| M4 | 自定义镜像（VCR）优化冷启动 | ⏳ 未开始 |
| M5 | 上线 + 部署按钮 + README | ⏳ 未开始 |

### 本地验证（已做）
- `npm run typecheck` 通过；额外用 CommonJS 配置编译一遍，产物可被 Node 直接 `require`。
- 模拟 `/var/task` 布局做运行时冒烟测试（模拟 Lambda 目录结构）：
  - 无凭据 → **401** + `WWW-Authenticate: Basic realm="PI WEB"` ✅
  - 错误密码 → **401** ✅
  - WS 升级 → **501**（M3 未实现，预期）✅
  - 正确凭据 → 进到沙箱调用，本地无 OIDC 时报 502 带 SDK 提示 ✅

### 下一步（M1 部署实测）
- [ ] 获取新 GitHub token，创建 `Pandasweet7/PI-vercel` 并推送
- [ ] 本地 `vercel link` + 配置 env（SITE_USERNAME/PASSWORD、AI_GATEWAY_*）
- [ ] `vercel dev` 本地验证路由（可选 catch-all 根路径 + 反代）
- [ ] 部署到 Vercel，验证：首页能出、SSE 流式、Basic Auth 生效
- [ ] 验证沙箱公网 URL 不泄露（浏览器只接触 vercel.app）

### Vercel 平台关键限制
- Hobby: 单 session 最长 45min（Pro 24h），10 并发沙箱，5h CPU/月，420 GB-hr 内存/月
- 磁盘 32GB NVMe（比 EdgeOne 的 512MB 大得多）
- 持久化默认开启（自动快照/恢复），快照默认 30 天过期（已设 0=永不过期）
- 仅美欧区域（iad1/sfo1/cle1/cdg1），无亚太
- 沙箱暴露端口公网可达（已确认安全原则：仅经 Function 反代）
- 预估单用户月费 ≈ $3-6（Hobby 免费额度内可覆盖）

---

## 三、两个仓库的关系

- **代码几乎不共享**（架构差异大：EdgeOne 需要 fork + 折叠代理 + bootstrap hook；Vercel 用 stock pi-web 原样跑）
- 共享的是：`stableId` 算法、env 契约、pi-web 镜像
- 建议独立仓库（`PI-edgeone` + `PI-vercel`），各自部署
- 两个版本可同时在线，用户按域名/入口选择

---

## 四、待处理事项

### PI-edgeone
- [ ] 获取新 GitHub token（旧的已失效）推送后续修改
- [ ] 用户测试：跨浏览器会话共享、归档持久、上传持久、SSE 流式
- [ ] 清理 debug 端点（生产环境应移除 `/api/debug`）

### PI-vercel
- [ ] 获取新 GitHub token（旧的已失效）推送后续修改
- [ ] M1 部署实测：`vercel link` + 配 env + 部署验证（首页/SSE/Basic Auth/URL 不泄露）
- [ ] M2 持久化验证（停止→恢复后数据仍在）
- [ ] M3 WebSocket（终端 + 事件流）
- [ ] 创建 GitHub 仓库 `Pandasweet7/PI-vercel`

### 通用
- [ ] EdgeOne 版和 Vercel 版的 README 各自写部署按钮
- [ ] 考虑是否合并成 monorepo（目前建议独立仓库）

---

## 五、关键文件路径速查

| 文件 | 位置 | 说明 |
|---|---|---|
| ❗ 函数目录 | `api/`（仓库根） | 不能用 `src/api/`，入口用 `index.ts`+`[...path].ts`（不能用 `[[...path]]`） |
| EdgeOne 仓库 | `/root/pi-web-makers` | 已完成，HEAD=7d2f219 |
| EdgeOne pi-web 源码 | `/root/pi-web-src` | fork 基底，用于重建 SPA |
| Vercel 仓库 | `/root/pi-vercel` | M1 代码完成，HEAD=0a55bec |
| 设计文档 | `/root/pi-vercel/docs/DESIGN.md` | 完整设计（已同步 M1） |
| Sandbox 生命周期 | `/root/pi-vercel/src/lib/sandbox.ts` | getOrCreate + BOOT_SCRIPT + keepAlive |
| 反代 | `/root/pi-vercel/src/lib/proxy.ts` | HTTP/SSE 流式，identity 编码 |
| 入口 handler | `/root/pi-vercel/api/proxy/index.ts` + `[...path].ts` | auth→沙箱→反代（仓库根 api/） |
| 版本常量 | `/root/pi-vercel/src/lib/versions.ts` | pi-web 1.202608.2, pi 0.84.4 |
| 稳定 ID 算法 | `/root/pi-vercel/src/lib/stableId.ts` | fnv1a，与 EdgeOne 版同算法 |
| env 契约 | `/root/pi-vercel/.env.example` | 与 EdgeOne 版对称 + SANDBOX_* |
