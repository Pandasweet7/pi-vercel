# PI-vercel

PI WEB（pi coding agent 官方 Web UI）on **Vercel**：
**Vercel Sandbox** 提供"每用户一个持久 microVM"跑完整 pi-web，
**Vercel Functions** 负责鉴权 + 编排 + 反向代理。

> 设计文档：[docs/DESIGN.md](docs/DESIGN.md)。本仓库与 `PI-edgeone` 并存、独立部署。

## 架构一句话

```
浏览器 → Vercel Function（Basic Auth → 取/保活沙箱 → 反代）→ Vercel Sandbox（stock pi-web-server）
```

不 fork 客户端、不折叠代理、不手写快照——沙箱默认自动快照/恢复整个 32GB 盘。

## 状态

🚧 **设计中 / 骨架阶段**。实现前请先过目 [docs/DESIGN.md](docs/DESIGN.md) §5 风险与 §8 决策点。

## 部署按钮（上线后启用）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Pandasweet7/PI-vercel)

## 环境变量

见 [.env.example](.env.example)。核心：`SITE_USERNAME` / `SITE_PASSWORD`（Basic Auth，同时派生沙箱名）+ 模型配置（`AI_GATEWAY_*` 或 BYOK key）。

## 目录

```
src/
├─ lib/        # config / stableId / auth / sandbox / proxy
└─ api/        # [...path].ts catch-all：auth → sandbox → 反代
image/         # v2 自定义镜像（VCR），基于 pi-web 官方 Dockerfile
scripts/       # 镜像构建/推送等
docs/          # DESIGN.md
```
