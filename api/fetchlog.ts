// TEMP-DIAG: replicate getReadySandbox's exact getOrCreate call with fetch
// capture, to find why the API 400s on keepLastSnapshots there.
import { Sandbox } from '@vercel/sandbox';
import { loadConfig } from '../src/lib/config.js';
import { sandboxNameFor } from '../src/lib/stableId.js';

type Captured = { url: string; method?: string; body?: string; status?: number; respBody?: string };

async function handler(): Promise<Response> {
  const cfg = loadConfig();
  const name = sandboxNameFor('Tiger');

  const captured: Captured[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? init.body : undefined;
    let resp: Response;
    try {
      resp = await orig(input as RequestInfo, init);
    } catch (e) {
      captured.push({ url, method: init?.method, body, respBody: `FETCH_ERR: ${String(e)}` });
      throw e;
    }
    const text = await resp.clone().text().catch(() => '');
    captured.push({ url, method: init?.method, body, status: resp.status, respBody: text.slice(0, 500) });
    return resp;
  }) as typeof fetch;

  const results: Record<string, unknown> = {
    cfgKeepLastSnapshots: cfg.sandboxKeepLastSnapshots,
    cfgKeepLastSnapshotsJson: JSON.stringify(cfg.sandboxKeepLastSnapshots),
    cfgSnapshotExp: cfg.sandboxSnapshotExpirationMs,
    name,
  };

  try {
    const sb = await Sandbox.getOrCreate({
      name,
      resume: true,
      region: cfg.sandboxRegion,
      resources: { vcpus: cfg.sandboxVcpus },
      timeout: cfg.sandboxTimeoutMs,
      ports: [8504],
      persistent: true,
      snapshotExpiration: cfg.sandboxSnapshotExpirationMs,
      keepLastSnapshots: { count: cfg.sandboxKeepLastSnapshots },
      env: {
        HOME: '/data/home',
        XDG_CONFIG_HOME: '/data/config',
        PI_WEB_DATA_DIR: '/data/pi-web',
        PI_WEB_SESSIOND_SOCKET: '/data/pi-web/sessiond.sock',
        PI_CODING_AGENT_DIR: '/data/pi-agent',
      },
      onCreate: async () => {
        /* no-op for capture */
      },
    });
    results.getOrCreate = { ok: true, name: sb.name, status: sb.status };
  } catch (e) {
    results.getOrCreate = { ok: false, err: String((e as Error)?.message ?? e) };
  } finally {
    globalThis.fetch = orig;
  }

  return new Response(JSON.stringify({ captured, results }, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
}

export const GET = handler;
