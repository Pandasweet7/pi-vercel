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

## 二、PI-vercel（Vercel Sandbox + Functions）—— M1 部署完成 ✅

### 仓库 / 部署
- GitHub: `Pandasweet7/pi-vercel`（小写，Vercel 项目名也须小写），本地 `/root/pi-vercel`，分支 `main`
- Vercel 项目 `pi-vercel`，生产域名 **https://pi-vercel-mu.vercel.app**
- 最新远程提交 `afa18f6`，生产部署 READY/PROMOTED
- 环境变量已在 Vercel 配置：SITE_USERNAME/SITE_PASSWORD（生产+预览）、BYOK 等

### 生产验证结果（2026-09-03 实测通过）
- 无凭据 `/` → **401** "Authentication required" ✅
- 正确凭据 `/` → **200** `<title>PI WEB</title>`（沙箱内 pi-web 1.202608.2 渲染）✅
- `/api/pi-web/status` 经反代 → **200** 完整 JSON（installedVersion/runtimeVersion/piVersion 全对齐）✅
- 任意未知路径（SPA fallback）→ 200 UI ✅
- 沙箱公网 URL（sb-*.vercel.run）不出现在任何响应中 ✅
- 首冷启动全链路（创建→装工具链→npm 装 pi-web→chmod→sessiond→server）≈ 2.5 分钟；warm 后 ≈ 1.5s ✅

### 部署期踩坑全记录（按发现顺序，均已在代码/文档固化）

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| 1 | `Function Runtimes must have a valid version` | `functions.runtime` 填裸 `@vercel/node` | 删除 functions 块（Hobby maxDuration 默认/上限就是 300s） |
| 2 | 函数不注册，全路径 404 | 函数在 `src/api/`，Vercel 只认根 `api/` | 移到 `api/proxy/` |
| 3 | `ERR_MODULE_NOT_FOUND /var/task/src/lib/config` | ESM 相对导入缺 `.js` | 所有相对导入带 `.js`，保留 `"type": "module"` |
| 4 | `Cannot use import statement outside a module` | 删掉 `type: module` 后 `@vercel/node` 仍输出 ESM 语法 | 恢复 `type: module`（与 #3 配套） |
| 5 | `[[...path]]` 路由 404 | legacy api/ 路由不认可选 catch-all | 改 `index.ts` + `[...path].ts` |
| 6 | `[...path]` 只吃**一段**（`/api/proxy/a/b` 404） | legacy 路由把 `[...path]` 当单段参数 | rewrite 全部非函数路径到 `/api/proxy` index，函数内用 `req.url` 重建原始路径 |
| 7 | rewrite 嵌套捕获组 `(a|b)` 被拒 | `invalid_rewrite: ... invalid source pattern` | lookahead 改为链式 `(?!a)(?!b)`；诊断路径删除后只剩一条 `(?!api/proxy/)` |
| 8 | 函数无限挂起（0 字节响应） | `export default` 被 `@vercel/node` 当 legacy `(req,res)`，返回值被丢弃 | 改用 **named route-handle 导出** `export const GET/POST/...`（运行时日志明说："export a fetch function or a named HTTP method"） |
| 9 | `req.url` 是相对路径 → `ERR_INVALID_URL` | Vercel web handler 给 `req.url = /api/proxy` | `new URL(req.url, 'http://vercel.internal')` 防御 |
| 10 | `keepLastSnapshots` 400 | 诊断端点把 4 字段投影对象当完整 cfg 传入（`count: undefined` 被 JSON 丢弃） | probe 传完整 AppConfig（真实路径无此 bug） |
| 11 | npm install 失败：node-pty | 无 linux prebuild + 沙箱缺 make/g++ + 非 root 用户 | 失败后 `sudo: true` 的 `apt-get install make g++` 再重试；npm 缓存使重试很快 |
| 12 | `sessiond: socket never appeared` | npm 生成的 `/usr/local/bin/pi-web-*` 符号链接指向无 +x 的 dist .js（shebang 没执行位） | 每次 attach 后 `chmod +x` 三个 dist bin |

### 调试基建（已删除，勿在生产恢复）
- 无鉴权的诊断端点（`/api/exec` 可执行任意沙箱命令）已全部删除；历史记录保留在 git log
- 教训：任何诊断端点都要 Basic Auth 或临时环境变量门控

### 待办
- [ ] 用户浏览器实测：对话 + SSE 流式 + 终端（WS 是 M3，当前 501）
- [ ] `AI_GATEWAY_*` 环境变量目前**未配置**（runtime 报告 gatewayKey=false）——对话功能需要用户配置网关或 BYOK
- [ ] M2：停止/恢复后快照持久化验证（快照已设永不过期，keepLastSnapshots=2）
- [ ] M3：WebSocket 反代或 WS→SSE 桥（终端 + 事件流）
- [ ] M4：VCR 自定义镜像（预装 pi-web + 工具链），把冷启动从 ~2.5min 降到 ~10s
- [x] README + 一键部署按钮（M5）

### 关键架构决策（已落地）
- 用 stock pi-web（`@jmfederico/pi-web@1.202608.2`，pi 0.84.4），不做 fork
- 每用户一个持久沙箱：`fnv1a(SITE_USERNAME)` → 沙箱名；snapshotExpiration=0（永不过期）
- 密钥不进沙箱定义/快照：API key 只经 runCommand per-command env 注入；models.json 用 `$AI_GATEWAY_API_KEY` 占位
- 幂等自愈启动：install 标记文件 + 无条件 BOOT_SCRIPT（pidfile + kill -0）；覆盖 创建/恢复/已运行/中断安装
- 反代流式：`accept-encoding: identity` 上游；删 content-encoding/content-length；cache-control no-store
- 路径重建：legacy 路由下用 req.url 还原原始路径（相对 URL 防御）
- 函数签名：named HTTP-method 导出（GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD 全量）

### 里程碑
| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 设计确认 | ✅ 完成 |
| M1 | Function 层：auth + sandbox + HTTP/SSE 反代 | ✅ **部署完成，端到端验证通过** |
| M2 | 持久化验证 | ⏳ 待浏览器实测后确认 |
| M3 | WebSocket（终端 + 事件流） | ✅ **中继上线（experimental_upgradeWebSocket + ws 桥）** |
| M4 | 自定义镜像（VCR）优化冷启动 | ⏳ 未开始（预估 2.5min → ~10s） |
| M5 | 上线 + README + 一键部署按钮 | ✅ 完成（README 含 Vercel Deploy 按钮 + env 表） |


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
- [x] GitHub 仓库 `Pandasweet7/pi-vercel` 已建并推送（main）
- [x] Vercel 项目 `pi-vercel` 已连，生产域名 pi-vercel-mu.vercel.app
- [x] M1 部署实测：Basic Auth/首页/反代/URL 不泄露 全部验证通过
- [x] 用户浏览器实测：对话已通（WS M3 修复延迟渲染）
- [ ] 继续实测：流式渲染 / 终端 / 长会话
- [x] 模型可用（BYOK NVIDIA）；用户决定改走 pi 内置供应商 → 需按需增删 Vercel env key
- [ ] M2 持久化验证（停止→恢复后数据仍在）— 用户浏览器实测确认中
- [x] M3 WebSocket 中继（experimental_upgradeWebSocket + ws 桥，已实测 101 + 双向消息）
- [ ] 浏览器实测 WS 体验（Hobby WS 连接最长 300s，客户端会自动重连）
- [ ] M4 VCR 自定义镜像（冷启动 2.5min → ~10s）

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
| Vercel 仓库 | `/root/pi-vercel` | M1 部署完成，HEAD=afa18f6，生产 https://pi-vercel-mu.vercel.app |
| 设计文档 | `/root/pi-vercel/docs/DESIGN.md` | 完整设计（已同步 M1） |
| Sandbox 生命周期 | `/root/pi-vercel/src/lib/sandbox.ts` | getOrCreate + BOOT_SCRIPT + keepAlive |
| 反代 | `/root/pi-vercel/src/lib/proxy.ts` | HTTP/SSE 流式，identity 编码 |
| 入口 handler | `/root/pi-vercel/api/proxy/index.ts` + `[...path].ts` | auth→沙箱→反代（仓库根 api/） |
| 版本常量 | `/root/pi-vercel/src/lib/versions.ts` | pi-web 1.202608.2, pi 0.84.4 |
| 稳定 ID 算法 | `/root/pi-vercel/src/lib/stableId.ts` | fnv1a，与 EdgeOne 版同算法 |
| env 契约 | `/root/pi-vercel/.env.example` | 与 EdgeOne 版对称 + SANDBOX_* |
