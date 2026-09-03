// TEMP-DIAG: capture the exact HTTP requests getReadySandbox sends, to find
// why the API 400s on keepLastSnapshots in the real boot path.
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
      console.log('[fetchlog]', init?.method, url, 'FETCH_ERR', String(e));
      throw e;
    }
    const text = await resp.clone().text().catch(() => '');
    captured.push({ url, method: init?.method, body, status: resp.status, respBody: text.slice(0, 500) });
    console.log('[fetchlog]', init?.method, url, '->', resp.status, (text || '').slice(0, 300));
    return resp;
  }) as typeof fetch;

  const results: Record<string, unknown> = {
    cfgKeepLastSnapshots: cfg.sandboxKeepLastSnapshots,
    cfgKeepLastSnapshotsJson: JSON.stringify(cfg.sandboxKeepLastSnapshots),
    cfgSnapshotExp: cfg.sandboxSnapshotExpirationMs,
    name,
  };

  try {
    const { getReadySandbox } = await import('../src/lib/sandbox.js');
    const r = await getReadySandbox(cfg, 'Tiger');
    results.getOrCreate = { ok: true, name: r.sandbox.name, baseUrl: r.baseUrl, created: r.created };
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
