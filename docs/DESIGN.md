# PI-vercel 设计文档

> 目标：把 PI WEB（pi-web server + session daemon + pi coding agent）部署到 **Vercel**，
> 用 **Vercel Sandbox** 提供"每用户一个持久 microVM"，**Vercel Functions** 负责鉴权 + 编排 + 反向代理。

---

## 0. 关键架构洞察（为什么这版比 EdgeOne 版简单）

EdgeOne 版为了迁就 "Makers 函数无法透传真实路由"，打了一堆补丁：
- 折叠代理 `api/proxy?target=base64(...)` + base64url 编解码
- bootstrap 里 hook `fetch` / `XMLHttpRequest` 塞 `makers-conversation-id` 头
- WS→SSE 桥接（Makers 不支持 WS）
- **fork 整个 pi-web 源码重打 SPA**（`VITE_MAKERS_PROXY=1`）
- 手写快照编解码（`context.store` 1.5MB 预算、base64 存二进制）

**Vercel Sandbox 是完整 Linux microVM**（child_process / Docker / 真文件系统 / 完整网络栈都支持），
pi-web 可以**原样**在里面跑，暴露端口就是一个正常站点。所以：

| EdgeOne 版的补丁 | Vercel 版 |
|---|---|
| 折叠代理 + base64 编解码 | ❌ 不需要，原样反代 |
| bootstrap hook fetch/XHR | ❌ 不需要，stock pi-web 直接跑 |
| WS→SSE 桥接 | ❌ 大概率不需要（microVM 有完整网络栈；见风险） |
| fork pi-web 重打 SPA | ❌ 不需要，用官方镜像 |
| 手写快照（1.5MB 预算） | ❌ 不需要，**沙箱默认自动快照/恢复整个 32GB 盘** |

**Vercel 层只剩四件事：鉴权 → 取/保活沙箱 → 确保 pi-web-server 活着 → 反代。**

---

## 1. 总体架构

```
浏览器  ──https──►  https://<app>.vercel.app/<path>
                        │
                        ▼
              ┌─────────────────────────────┐
              │  Vercel Function             │   （src/api/[...path].ts，Node runtime，fluid，streaming）
              │  1. Basic Auth               │
              │  2. stableUserId → sandbox名 │
              │  3. Sandbox.getOrCreate()    │   ── 冷则毫秒级从快照 resume（整盘还原）
              │  4. 确保 pi-web-server 活着  │
              │  5. 反代 HTTP/SSE/WS → 沙箱  │
              └───────────────┬──────────────┘
                              │ 反代到沙箱暴露端口
                              ▼
              ┌─────────────────────────────┐
              │  Vercel Sandbox (Firecracker) │   name = "piweb-<hash(user)>"
              │  ├─ pi-web-server            │   0.0.0.0:8504（gateway+sessiond+SPA）
              │  ├─ /data/pi-web  (数据)     │   ← 32GB NVMe，停止时自动快照
              │  ├─ /data/pi-agent (会话)    │   ← sessions/*.jsonl、workspace、uploads、归档
              │  └─ models.json (模型配置)   │   ← onCreate 从 env 写入
              └─────────────────────────────┘
```

**浏览器只认 `https://<app>.vercel.app` 这一个源**，永远拿不到沙箱真实地址（安全 + 统一鉴权）。

---

## 2. 请求生命周期（详细）

```
任意请求  GET/POST/WS  https://<app>.vercel.app/<path>?<query>
│
├─[1] Basic Auth
│      读 Authorization 头，与 env 的 SITE_USERNAME / SITE_PASSWORD 比对
│      缺失/错误 → 401 + WWW-Authenticate（与 EdgeOne middleware.js 完全一致）
│
├─[2] 解析用户 → 沙箱名
│      name = "piweb-" + fnv1a(SITE_USERNAME)          ← 复用 EdgeOne 版 stableConversationId
│      （每用户一个沙箱，天然跨浏览器共享——这正是 EdgeOne 版靠稳定 id 解决的问题）
│
├─[3] 取/保活沙箱
│      sandbox = await Sandbox.getOrCreate({
│         name,
│         image: <托管镜像 或 VCR 镜像>,
│         timeout: <ms>,                 ← 默认 5min，活跃时用 extendTimeout() 续
│         onCreate:  sbx => configureProviders(sbx),   ← 首次：写 models.json/装依赖
│         onResume:  sbx => ensureServerRunning(sbx),  ← 每次开机：幂等拉起 pi-web-server
│      })
│      // getOrCreate 对已停止的持久沙箱会自动从快照 resume（整盘还原）
│      await waitUntilReady(sandbox)        ← 轮询 /api/pi-web/status 直到就绪
│      url = await sandbox.getHost(8504)    ← 沙箱暴露端口的内部地址
│
├─[4] 反向代理
│      HTTP / SSE: fetch(url + path, {method, 透传 headers, body})
│                  → 返回流式 Response（SSE 必须透传，不能 buffer）
│      WebSocket:  见 §5 风险与决策（首选 Function WS beta；备选桥接）
│
└─[5] 保活
       每次成功反代后，若剩余时间低于阈值 → sandbox.extendTimeout()
```

### 关键子步骤说明

- **`ensureServerRunning`（onResume）**：resume 恢复的是**磁盘**，不是进程。所以每次新 session 要重新拉起 `pi-web-server`。做法：探测 8504 端口，没响应就 `nohup pi-web-server &`（detached），幂等。
- **`waitUntilReady`**：从 Function 侧轮询 `<url>/api/pi-web/status`，直到返回 ok（pi-web 冷启动需拉起 gateway+sessiond，约数秒）。
- **持久化**：沙箱默认 `persistent: true`，停止时自动快照整盘、恢复时还原。**不需要任何手写快照逻辑**。配合 `snapshotExpiration` 设长/永不过期，解决 "长期不回来数据丢" 的问题。

---

## 3. 组件设计

### 3.1 沙箱镜像（`image/`）

**v1（简单，先跑通）**：用托管镜像（`vercel/sandbox/universal`，自带 Node LTS），`onCreate` 时 `npm i -g @jmfederico/pi-web` + 写配置。
- 优点：零镜像维护；缺点：首次开机要装依赖（慢，但只发生一次，之后靠快照跳过）。

**v2（优化）**：基于官方 `pi-web/docker/Dockerfile`（openSUSE + Node22 + pi-web 全局装好，`EXPOSE 8504`，`CMD pi-web-server`）
做适配镜像，推到 **Vercel Container Registry (VCR)**，沙箱从它启动 → 开机即用，无安装等待。

### 3.2 模型/Provider 配置（`image/configure-providers.sh`）

`onCreate` 时按 env 写入 pi 的模型配置，让 agent 能调模型：
- 直连 AI 网关：`AI_GATEWAY_BASE_URL` + `AI_GATEWAY_API_KEY` + `AI_GATEWAY_MODEL`
- 或 BYOK：`NVIDIA_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` …（沙箱有出网，可直连任意 OpenAI 兼容端点）

比 EdgeOne 版简单——不需要本地网关适配器，直接指向真实端点。

### 3.3 Vercel Function 层（`src/`）

```
src/
├─ lib/
│  ├─ config.ts        # 读 env（SITE_USERNAME/PASSWORD、AI_GATEWAY_*、SANDBOX_TIMEOUT…）
│  ├─ stableId.ts      # fnv1a(SITE_USERNAME) → 沙箱名（与 EdgeOne 版同算法）
│  ├─ auth.ts          # Basic Auth 校验
│  ├─ sandbox.ts       # getOrCreate + ensureServerRunning + waitUntilReady + extendTimeout
│  └─ proxy.ts         # 反向代理（HTTP/SSE 流式；WS 见 §5）
└─ api/
   └─ [...path].ts     # catch-all：auth → sandbox → proxy
```

`vercel.json` 把所有路径路由到这个 catch-all Function（SPA / API / WS / SSE 全走它）。

### 3.4 持久化策略

- **主存储**：沙箱磁盘（32GB NVMe），`persistent: true` 自动快照/恢复。
- **快照过期**：`snapshotExpiration` 设为长期或永不过期（默认 30 天会丢）。
- **可选**：跨沙箱共享/超大存储用 Vercel Drives（beta 免费，但当前单用户不需要）。

---

## 4. env 契约（与 EdgeOne 版保持对称）

| 变量 | 必需 | 说明 |
|---|---|---|
| `SITE_USERNAME` | ✅ | Basic Auth 用户名；同时派生沙箱名 |
| `SITE_PASSWORD` | ✅ | Basic Auth 密码 |
| `AI_GATEWAY_API_KEY` | ✅* | 模型网关 key（或用下方 BYOK） |
| `AI_GATEWAY_BASE_URL` | ✅* | 模型网关地址 |
| `AI_GATEWAY_MODEL` | – | 默认模型 |
| `NVIDIA_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / … | – | BYOK，任选 |
| `SANDBOX_TIMEOUT_MS` | – | 单次 session 时长（默认 5min） |
| `SANDBOX_REGION` | – | 默认 iad1 |

---

## 5. 风险与关键决策（动手前必须确认）

| # | 风险 | 影响 | 缓解 / 决策 |
|---|---|---|---|
| 1 | **暴露端口的公网可达性**：沙箱端口经公网 URL 可达，若泄露 = 绕过 Basic Auth | 🔴 安全 | 所有流量只走 Function 反代，绝不下发沙箱真实 URL；验证 Sandbox 防火墙能否限制 ingress。**头号验证项** |
| 2 | **WebSocket 端到端**：pi-web 事件/终端走 WS；Function WS 是 beta | 🟠 功能 | 首选 Function WS 反代；备选：沿用 EdgeOne 版 WS→SSE 桥（改造成沙箱内跑） |
| 3 | **SSE 流式反代**：Function 必须流式透传，不能 buffer | 🟠 体验 | 用 `Response` + `ReadableStream` 透传；实测首字节延迟 |
| 4 | **每 session 重启进程**：resume 不恢复进程 | 🟡 已设计 | `onResume` 幂等拉起 + 就绪轮询（见 §2） |
| 5 | **冷启动延迟**：resume + 拉服务 + 就绪探测 | 🟡 体验 | 实测 2–5s；可接受（与 EdgeOne 相当或更好） |
| 6 | **区域**：仅美欧（iad1/sfo1/cle1/cdg1），无亚太 | 🟠 延迟 | 对在亚洲使用的你是现实短板；EdgeOne 有国内优化 |
| 7 | **计费**：provisioned memory 按 session 墙钟计（空闲也算） | 🟢 可控 | 空闲即停 + 快照恢复，天然省钱；单人 ≈ $3–6/月 |

---

## 6. 与 EdgeOne 版的关系（并存）

- **代码几乎不共享**（架构差异大）；共享的是：`stableId` 算法、env 契约、pi-web 镜像。
- 并存形态建议：**独立仓库 `PI-vercel`**（当前这个）+ `PI-edgeone` 各自部署；或后续合并成 monorepo 双部署根目录。
- 两个版本可同时在线，用户按域名/入口选择。

---

## 7. 里程碑

| 阶段 | 内容 | 产出 |
|---|---|---|
| M0 | 设计确认（本文档） | 你过目 + 决策 §5 |
| M1 | Function 层骨架：auth + stableId + sandbox.getOrCreate + HTTP/SSE 反代 | 能在 Vercel 上看到 pi-web 首页 |
| M2 | 持久化验证：停止→恢复后数据仍在；快照不过期 | 冷启动不丢数据 |
| M3 | WebSocket（终端 + 事件流） | 终端可用 |
| M4 | 自定义镜像（VCR）优化冷启动 | 开机即用 |
| M5 | 上线 + 部署按钮 + README | 可一键部署 |

---

## 8. 待你确认的决策点

1. **WS 方案**：先按 "Function WS beta 反代" 做，跑不通再退到桥接？
2. **镜像**：v1 用托管镜像 + 开机安装（快出原型），v2 再做 VCR 自定义镜像？
3. **区域**：先用默认 `iad1`？（亚太延迟你已知晓）
4. **反代安全**：确认 "所有流量只经 Function、不下发沙箱 URL" 这个原则？
