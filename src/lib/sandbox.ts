/**
 * Sandbox lifecycle + provisioning.
 *
 * Layout inside the sandbox (all state under /data so it survives
 * stop/snapshot/resume cycles):
 *   /data/home        HOME (git config, shell history, dotfiles)
 *   /data/config      XDG_CONFIG_HOME (pi agent config: /data/config/pi)
 *   /data/pi-agent    PI_CODING_AGENT_DIR (models.json, settings.json)
 *   /data/pi-web      PI_WEB_DATA_DIR (session daemon state, logs, pidfiles)
 *   /data/workspaces  default workspace root
 *
 * Two processes run inside the sandbox (mirroring the official Docker setup):
 *   pi-web-sessiond   unix-socket daemon owning all coding sessions
 *   pi-web-server     HTTP server on port 8504, proxied via the Vercel Function
 *
 * Secrets: API keys are injected per-command at process start time only, so
 * they are never baked into the sandbox definition or its snapshots.
 * models.json references the gateway key via pi's $ENV_VAR interpolation.
 */

import { Sandbox } from '@vercel/sandbox';
import type { AppConfig } from './config.js';
import { sandboxNameFor } from './stableId.js';
import { PI_WEB_INSTALL_SPEC } from './versions.js';

/** Port the pi-web HTTP server listens on inside the sandbox. */
export const PI_WEB_PORT = 8504;

/** Shared (non-secret) environment for every command we run in the sandbox. */
function baseEnv(): Record<string, string> {
  return {
    HOME: '/data/home',
    XDG_CONFIG_HOME: '/data/config',
    PI_WEB_DATA_DIR: '/data/pi-web',
    PI_WEB_SESSIOND_SOCKET: '/data/pi-web/sessiond.sock',
    PI_CODING_AGENT_DIR: '/data/pi-agent',
    PI_WEB_HOST: '0.0.0.0',
    PI_WEB_PORT: String(PI_WEB_PORT),
    // The browser reaches pi-web through the Vercel Function proxy, so the
    // Host header won't match the sandbox domain — allow any host.
    PI_WEB_ALLOWED_HOSTS: 'true',
  };
}

/**
 * Secret env injected only at runCommand time for the pi-web processes.
 * Never part of the sandbox definition, so it won't persist into snapshots.
 * BYOK keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, ...) pass through as-is.
 */
function secretEnv(cfg: AppConfig): Record<string, string> {
  const env: Record<string, string> = { ...cfg.byok };
  if (cfg.aiGatewayApiKey) env.AI_GATEWAY_API_KEY = cfg.aiGatewayApiKey;
  return env;
}

/**
 * Bootstrap script: idempotently ensure sessiond + pi-web-server are running.
 * Safe on fresh create, resume-from-snapshot, and already-running sandboxes:
 *  - pidfile + `kill -0` guards (no pgrep dependency) prevent double-starts
 *  - sessiond removes its own stale socket on startup
 *  - HTTP readiness is probed with node fetch (curl may not be in the image)
 */
const BOOT_SCRIPT = String.raw`
set -u
mkdir -p /data/home/projects /data/home /data/config/pi /data/pi-web/logs /data/pi-agent /data/workspaces

alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

# --- sessiond ---
if alive /data/pi-web/sessiond.pid; then
  echo "sessiond: already running (pid $(cat /data/pi-web/sessiond.pid))"
else
  echo "sessiond: starting"
  rm -f "$PI_WEB_SESSIOND_SOCKET"
  nohup pi-web-sessiond >>/data/pi-web/logs/sessiond.log 2>&1 &
  echo $! > /data/pi-web/sessiond.pid
fi

for i in $(seq 1 60); do
  [ -S "$PI_WEB_SESSIOND_SOCKET" ] && break
  sleep 0.5
done
[ -S "$PI_WEB_SESSIOND_SOCKET" ] || { echo "sessiond: socket never appeared"; tail -n 40 /data/pi-web/logs/sessiond.log 2>/dev/null; exit 1; }

# --- pi-web server ---
if alive /data/pi-web/server.pid; then
  echo "server: already running (pid $(cat /data/pi-web/server.pid))"
else
  echo "server: starting"
  nohup pi-web-server >>/data/pi-web/logs/server.log 2>&1 &
  echo $! > /data/pi-web/server.pid
fi

for i in $(seq 1 120); do
  if node -e "fetch('http://127.0.0.1:8504/api/pi-web/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "server: ready"
    exit 0
  fi
  sleep 0.5
done
echo "server: never became ready"
tail -n 40 /data/pi-web/logs/server.log 2>/dev/null
exit 1
`;

const INSTALL_MARKER = '/data/pi-web/.installed';

/**
 * Ensure the pinned stock pi-web release is installed (idempotent, runs on
 * create AND resume/attach — a sandbox whose onCreate install died mid-way
 * heals itself here).
 *
 * node-pty (pi-web dep) has no linux prebuild for the sandbox's Node ABI, so
 * its install script falls back to `node-gyp rebuild`, which needs a C++
 * toolchain. On first failure we `apt-get install` make/g++ once and retry;
 * with tools present, npm's cache makes the retry cheap.
 */
async function ensureInstalled(sandbox: Sandbox, cfg: AppConfig): Promise<void> {
  const check = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', `test -f ${INSTALL_MARKER} && echo yes || echo no`],
    env: baseEnv(),
  });
  if ((await check.stdout()).trim() !== 'yes') {
    try {
      await run(sandbox, cfg, ['npm', 'install', '-g', PI_WEB_INSTALL_SPEC], 'install');
    } catch {
      // node-pty has no linux prebuild for this Node ABI: it needs a C++
      // toolchain for node-gyp. The sandbox runs as a non-root user, so the
      // install needs sudo (the SDK's runCommand sudo flag).
      await sandbox.runCommand({
        cmd: 'bash',
        args: ['-lc', 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends make g++'],
        env: { ...baseEnv(), ...secretEnv(cfg) },
        sudo: true,
      });
      await run(sandbox, cfg, ['npm', 'install', '-g', PI_WEB_INSTALL_SPEC], 'install-retry');
    }
    await sandbox.runCommand({
      cmd: 'bash',
      args: ['-lc', `touch ${INSTALL_MARKER}`],
      env: baseEnv(),
    });
    // Seed agent config after the install (models.json interpolates $AI_GATEWAY_API_KEY).
    await writeAgentConfig(sandbox, cfg);
  }
  // npm links /usr/local/bin/pi-web-* straight to the dist .js files, but
  // leaves them non-executable (shebang without +x) -> "Permission denied"
  // when the boot script spawns them. Cheap to re-assert on every attach.
  await run(
    sandbox,
    cfg,
    [
      'bash',
      '-lc',
      'chmod +x /usr/local/lib/node_modules/@jmfederico/pi-web/dist/server/sessiond.js ' +
        '/usr/local/lib/node_modules/@jmfederico/pi-web/dist/server/index.js ' +
        '/usr/local/lib/node_modules/@jmfederico/pi-web/dist/cli.js',
    ],
    'chmod-bins',
  );
}

/**
 * Write pi agent config (models.json + settings.json) for the AI gateway.
 * The key lives in the process env ($AI_GATEWAY_API_KEY interpolation);
 * the literal key is never written to disk.
 */
async function writeAgentConfig(sandbox: Sandbox, cfg: AppConfig): Promise<void> {
  if (!cfg.aiGatewayBaseUrl || !cfg.aiGatewayModel) return;

  const models = {
    providers: {
      gateway: {
        baseUrl: cfg.aiGatewayBaseUrl,
        api: 'openai-completions',
        apiKey: '$AI_GATEWAY_API_KEY',
        models: [{ id: cfg.aiGatewayModel, name: cfg.aiGatewayModel }],
      },
    },
  };
  const settings = {
    defaultProvider: 'gateway',
    defaultModel: cfg.aiGatewayModel,
  };
  await sandbox.writeFiles([
    { path: '/data/pi-agent/models.json', content: JSON.stringify(models, null, 2) },
    { path: '/data/pi-agent/settings.json', content: JSON.stringify(settings, null, 2) },
  ]);
}

export interface ReadySandbox {
  sandbox: Sandbox;
  /** Public upstream origin of the pi-web HTTP server (https://<sub>.vercel.run) */
  baseUrl: string;
  /** true if this call freshly created the sandbox; false if attached/resumed. */
  created: boolean;
}

/**
 * Get (or create/resume) the per-user sandbox and ensure pi-web is serving.
 */
export async function getReadySandbox(cfg: AppConfig, username: string): Promise<ReadySandbox> {
  const name = sandboxNameFor(username);

  let created = false;
  const sandbox = await Sandbox.getOrCreate({
    name,
    resume: true,
    region: cfg.sandboxRegion,
    ...(cfg.sandboxImage ? { image: cfg.sandboxImage } : {}),
    resources: { vcpus: cfg.sandboxVcpus },
    timeout: cfg.sandboxTimeoutMs,
    ports: [PI_WEB_PORT],
    persistent: true,
    snapshotExpiration: cfg.sandboxSnapshotExpirationMs,
    keepLastSnapshots: { count: cfg.sandboxKeepLastSnapshots },
    env: baseEnv(),
    onCreate: async () => {
      created = true;
    },
  });

  // Install pi-web if missing (covers fresh create, resume, and interrupted installs).
  await ensureInstalled(sandbox, cfg);

  // Ensure processes are up (covers create, resume, and already-running).
  await run(sandbox, cfg, ['bash', '-lc', BOOT_SCRIPT], 'boot');

  // sandbox.domain() returns the full public origin for the exposed port.
  const baseUrl = sandbox.domain(PI_WEB_PORT);

  // Final readiness probe through the same network path the proxy uses.
  await waitForStatus(baseUrl, cfg.sandboxReadyTimeoutMs);

  return { sandbox, baseUrl, created };
}

async function run(
  sandbox: Sandbox,
  cfg: AppConfig,
  argv: string[],
  label: string,
): Promise<void> {
  const [cmd, ...args] = argv;
  const result = await sandbox.runCommand({
    cmd,
    args,
    env: { ...baseEnv(), ...secretEnv(cfg) },
  });
  if (result.exitCode !== 0) {
    const stderr = (await result.stderr()).trim();
    const stdout = (await result.stdout()).trim();
    throw new Error(`sandbox ${label} failed (exit ${result.exitCode}): ${stderr || stdout}`);
  }
}

async function waitForStatus(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/pi-web/status`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return;
      lastErr = new Error(`status ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(1500);
  }
  throw new Error(`pi-web not ready within ${timeoutMs}ms: ${String(lastErr)}`);
}

/** Extend the sandbox lifetime whenever it drifts past the halfway mark. */
export async function keepAlive(sandbox: Sandbox, cfg: AppConfig): Promise<void> {
  const expiresAt = sandbox.expiresAt;
  if (!expiresAt) return;
  const remaining = expiresAt.getTime() - Date.now();
  if (remaining < cfg.sandboxTimeoutMs * 0.5) {
    await sandbox.extendTimeout(cfg.sandboxTimeoutMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
