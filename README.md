# PI-vercel

把 **PI WEB**（[pi coding agent](https://github.com/mariozechner/pi) 官方 Web UI，stock `@jmfederico/pi-web`）部署到 **Vercel**：

- **Vercel Sandbox** —— 每个用户一个**持久 microVM**，完整跑 pi-web（终端 / 文件 / 快照都是真的）
- **Vercel Functions** —— Basic Auth → 取/保活沙箱 → 反代（HTTP/SSE/WebSocket），浏览器只见 vercel.app，永远接触不到沙箱公网地址

架构一句话：

```
浏览器 ──> Vercel Function（Basic Auth → fnv1a(SITE_USERNAME) 定沙箱 → 反代）
              │
              ▼
        Vercel Sandbox：stock pi-web（sessiond + server），持久快照
```

不 fork 客户端、不折叠代理、不手写快照 —— 沙箱默认自动快照/恢复整个 32GB 盘。

> 设计文档：[docs/DESIGN.md](docs/DESIGN.md) ｜ 进度：[PROGRESS.md](PROGRESS.md)
> 姊妹项目 [PI-edgeone](https://github.com/Pandasweet7/PI-edgeone)：同样的 pi-web 跑在腾讯 EdgeOne（已完成）。两者独立部署、互不影响。

---

## ✨ 一键部署（M5）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FPandasweet7%2Fpi-vercel&env=SITE_USERNAME%2CSITE_PASSWORD&envDescription=必填%3A%20Basic%20Auth%20账号密码%20(同时决定%20“谁的数据”%20——%20改一个用户名就是一个独立沙箱)%3B%20模型%20key%20可部署后在%20Project%20Settings%20里补&project-name=pi-web&repository-name=pi-web)

点上面按钮 → 设 `SITE_USERNAME` / `SITE_PASSWORD` → Deploy。首次打开首页会自动创建你的沙箱（冷启动约 1–3 分钟：装 pi-web + 工具链），之后 1–2 秒内响应。

> 老用户迁移：直接在你已部署的项目上照下方"手动部署/更新"一节改环境变量后 Redeploy 即可，历史会话保留。

---

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `SITE_USERNAME` | ✅ | Basic Auth 用户名。**同时派生沙箱名**（`fnv1a`）→ 换一个用户名 = 一套全新的隔离数据 |
| `SITE_PASSWORD` | ✅ | Basic Auth 密码 |
| 模型供应商（三选一/混合）： | | |
| `AI_GATEWAY_API_KEY` / `AI_GATEWAY_BASE_URL` / `AI_GATEWAY_MODEL` | | 走自建 AI 网关（OpenAI 兼容） |
| 官方 BYOK key（下任选）：`ANTHROPIC_API_KEY` `OPENAI_API_KEY` `DEEPSEEK_API_KEY` `GEMINI_API_KEY` `NVIDIA_API_KEY` `OPENROUTER_API_KEY` `MISTRAL_API_KEY` `GROQ_API_KEY` `XAI_API_KEY` … | | pi 内置供应商，配了 key 即可选对应模型 |
| 进阶：自定义供应商（models.json 模板） | | 见 [docs/DESIGN.md](docs/DESIGN.md)；key 仍只放 Vercel env，磁盘 models.json 用 `$VAR` 引用 |

完整清单与说明见 [.env.example](.env.example)。

### 安全要点（已内置）

- **key 永不落盘**：只存 Vercel env（加密），沙箱进程启动时注入，models.json 用 `$ENV_VAR` 引用
- **沙箱地址永不下发浏览器**：一切流量只经 Function；暴露的 sandbox 公网端口仅供 Function 回源
- **数据按 `SITE_USERNAME` 隔离**：沙箱/快照/会话都属于那个用户
- 历史会话存在沙箱快照里：改 env / 重新部署 **不会丢会话**（新 key 在下一次沙箱 stop→resume 后生效）

---

## 手动部署 / 更新

```bash
git clone https://github.com/Pandasweet7/pi-vercel.git
cd pi-vercel
npm install

# 在 Vercel 建项目并设好 env（见上表），然后：
npx vercel --prod --env SITE_USERNAME=you --env SITE_PASSWORD=secret
# 或连 GitHub 后 push main 自动部署
```

### 本地联调

```bash
npm install
npx vercel dev   # 需要已 link 项目并本地可拿 OIDC；沙箱调用需在 Vercel 云侧跑
```

> `@vercel/node` 会丢弃 `export default` 的返回值（当成 legacy `(req,res)`）→ 请求挂起。
> 因此所有函数入口都必须是 **named route-handle 导出**（`export const GET/POST/…`），详见各 `api/` 文件头注释。

---

## 目录

```
api/proxy/index.ts + [...path].ts   # Function 入口：auth → 沙箱 → 反代（named 导出）
src/lib/                            # config / stableId(fnv1a) / auth / sandbox / proxy / versions
vercel.json                         # 把非 /api/proxy/* 的路径 rewrite 进 index 函数
docs/DESIGN.md                      # 完整设计
.env.example                        # 环境变量契约
image/  scripts/                    # M4（VCR 自定义镜像）预留
```

## 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | 设计确认 | ✅ |
| M1 | auth + 沙箱 + HTTP/SSE 反代 | ✅ 部署验证通过 |
| M2 | 持久化验证（stop→resume 数据仍在） | ⏳ 待浏览器实测确认 |
| M3 | WebSocket 中继（终端/事件流） | ✅ 上线（Hobby WS 连接上限 300s，客户端自动重连） |
| M4 | VCR 自定义镜像：冷启动 2.5min → ~10s | ⏳ |
| M5 | 上线 + README + 一键部署按钮 | ✅ 本文档 |

## 已知限制（Hobby 计划）

- WS 单连接最长 300s（到点断开，pi-web 客户端自动重连）
- 沙箱区域仅美欧（默认 `iad1`；无亚太）
- 冷启动首次约 1–3 分钟（沙箱创建 + 安装）；M4 镜像后降到 ~10s
- 每账号一个共享沙箱（同 `SITE_USERNAME` 的浏览器共享会话——与 EdgeOne 版一致的稳定身份设计）
