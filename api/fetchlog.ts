// TEMP-DIAG: capture the exact HTTP requests the sandbox SDK sends, so we can
// see why the API rejects our getOrCreate call.
import { Sandbox } from '@vercel/sandbox';

type Captured = { url: string; method?: string; body?: string; status?: number; respBody?: string };

async function handler(): Promise<Response> {
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
    captured.push({ url, method: init?.method, body, status: resp.status, respBody: text.slice(0, 600) });
    return resp;
  }) as typeof fetch;

  const results: Record<string, unknown> = {};
  try {
    const sb = await Sandbox.create({
      name: 'diag-fetchcapture',
      ports: [8504],
      persistent: true,
      keepLastSnapshots: { count: 2 },
      resources: { vcpus: 2 },
      timeout: 300000,
      region: 'iad1',
    });
    results.create = { ok: true, name: sb.name };
  } catch (e) {
    results.create = { ok: false, err: String((e as Error)?.message ?? e) };
  } finally {
    globalThis.fetch = orig;
  }

  return new Response(JSON.stringify({ captured, results }, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
}

export const GET = handler;
