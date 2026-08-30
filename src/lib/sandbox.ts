// Sandbox lifecycle: get-or-create the per-user persistent microVM, ensure the
// pi-web server is running inside it, and expose its URL for the proxy.
//
// NOTE (design): the exact @vercel/sandbox SDK method names for (a) obtaining
// the exposed-port URL and (b) running detached commands must be confirmed
// against the SDK reference during M1. Shapes below follow the documented
// `Sandbox.getOrCreate({ name, timeout, onCreate, onResume })` contract.
import { Sandbox } from '@vercel/sandbox';
import type { AppConfig } from './config.ts';
import { sandboxNameFor } from './stableId.ts';

export interface ReadySandbox {
  sandbox: InstanceType<typeof Sandbox>;
  /** Base URL of the pi-web server's exposed port inside the sandbox. */
  baseUrl: string;
}

const PI_WEB_PORT = 8504;

/**
 * Idempotently start pi-web-server inside the sandbox if it is not already
 * listening. Runs on every session (onResume) because a resumed session
 * restores the disk but NOT the running process.
 */
async function ensureServerRunning(sbx: InstanceType<typeof Sandbox>): Promise<void> {
  // TODO(M1): check `curl -fsS http://127.0.0.1:8504/api/pi-web/status`; if it
  // fails, launch `pi-web-server` detached. Exact runCommand detached API per SDK.
  await sbx.runCommand('bash', ['-lc', 'pgrep -f pi-web-server >/dev/null || (nohup pi-web-server >/tmp/pi-web-server.log 2>&1 &)']);
}

/** Write model/provider config into the sandbox on first creation. */
async function configureProviders(sbx: InstanceType<typeof Sandbox>, cfg: AppConfig): Promise<void> {
  // TODO(M1): materialize pi's models.json / settings.json from cfg
  // (AI_GATEWAY_* or BYOK keys). Simpler than the EdgeOne version: point pi
  // directly at the real gateway/BYOK endpoint (sandbox has outbound network).
  void cfg;
  void sbx;
}

/** Poll until the pi-web server answers its status endpoint. */
async function waitUntilReady(baseUrl: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/pi-web/status`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {
      /* still booting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('pi-web server did not become ready in time');
}

/**
 * Get (or create/resume) the user's sandbox and make sure pi-web is serving.
 * Persistent by default: a stopped sandbox auto-resumes from its filesystem
 * snapshot, restoring sessions, workspace files, uploads, and archives.
 */
export async function getReadySandbox(cfg: AppConfig, username: string): Promise<ReadySandbox> {
  const name = sandboxNameFor(username);
  const sandbox = await Sandbox.getOrCreate({
    name,
    // persistent: true is the default — filesystem auto-snapshots on stop.
    timeout: cfg.sandboxTimeoutMs,
    ...(cfg.sandboxImage ? { image: cfg.sandboxImage } : {}),
    onCreate: async (sbx) => {
      if (!cfg.sandboxImage) {
        // Managed-image path: install pi-web once (later resumes skip this via snapshot).
        await sbx.runCommand('npm', ['install', '-g', '@jmfederico/pi-web']);
      }
      await configureProviders(sbx, cfg);
      await ensureServerRunning(sbx);
    },
    onResume: async (sbx) => {
      await ensureServerRunning(sbx);
    },
  });

  // TODO(M1): confirm the SDK call that returns the exposed-port URL for PI_WEB_PORT.
  const baseUrl = await (sandbox as any).getHost(PI_WEB_PORT);
  await waitUntilReady(baseUrl);
  return { sandbox, baseUrl };
}

/** Extend the session while the user is active so long turns aren't cut off. */
export async function keepAlive(sandbox: InstanceType<typeof Sandbox>, cfg: AppConfig): Promise<void> {
  try {
    // TODO(M1): read remaining time via the `timeout` accessor; extend only when low.
    await (sandbox as any).extendTimeout?.(cfg.sandboxTimeoutMs);
  } catch {
    /* best effort */
  }
}
