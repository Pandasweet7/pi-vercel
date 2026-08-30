# Sandbox image (v2 optimization)

v1 (prototype) uses the **managed image** (`vercel/sandbox/universal`) and installs
`@jmfederico/pi-web` at `onCreate` — zero image maintenance; first boot installs once,
later resumes skip it via snapshot.

v2 builds a custom image from pi-web's official `docker/Dockerfile`
(openSUSE + Node22 + `@jmfederico/pi-web` preinstalled, `EXPOSE 8504`,
`CMD pi-web-server`) and pushes it to **Vercel Container Registry (VCR)**,
so the sandbox boots ready-to-run with no install wait.

Adaptation notes vs pi-web's stock Dockerfile:
- Keep `PI_WEB_HOST=0.0.0.0`, `PI_WEB_PORT=8504` so the exposed port is reachable.
- Keep `PI_WEB_DATA_DIR=/data/pi-web`, `PI_CODING_AGENT_DIR=/data/pi-agent`, `HOME=/data/home`
  (all under `/data`, which is what gets snapshotted).
- Model/provider config is injected from env at `onCreate` (see `src/lib/sandbox.ts`),
  NOT baked into the image.

TODO(M4): finalize Dockerfile + `scripts/push-image.mjs` (build + push to VCR).
