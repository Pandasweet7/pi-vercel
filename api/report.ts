// TEMP-DIAG: single consolidated probe endpoint, reporting incrementally to a
// webhook (our HTTP responses rarely survive the flaky edge path from the test box).
// Every phase is POSTed as it starts/finishes so a truncated run is still readable.
const REPORT_URL =
  process.env.DIAG_WEBHOOK ?? 'https://webhook.site/ab875bfc-9cd5-447f-b361-512c360dab21';

const VERSION = 'probe-v2';
const t0 = Date.now();

async function post(body: Record<string, unknown>): Promise<void> {
  try {
    await fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: VERSION, startedAt: t0, atMs: Date.now() - t0, ...body }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    /* best effort */
  }
}

function shorten(v: unknown): unknown {
  try {
    const s = JSON.stringify(v);
    return s && s.length > 900 ? `${s.slice(0, 900)}…` : v;
  } catch {
    return String(v);
  }
}

/** Run `fn`, POSTing start/ok/error around it. Never throws. */
async function timed<T>(phase: string, fn: () => Promise<T>): Promise<T | undefined> {
  const s = Date.now();
  await post({ phase, event: 'start' });
  try {
    const v = await fn();
    await post({ phase, event: 'ok', ms: Date.now() - s, info: shorten(v) });
    return v;
  } catch (e) {
    const err = e as Error;
    await post({
      phase,
      event: 'error',
      ms: Date.now() - s,
      err: `${err?.name ?? 'E'}: ${err?.message ?? String(e)}`,
      stack: String(err?.stack ?? '').split('\n').slice(0, 6),
    });
    return undefined;
  }
}

/** Vercel may hand us a relative `req.url`; never let `new URL` throw. */
function safeUrl(u: string): URL {
  try {
    return new URL(u);
  } catch {
    return new URL(u, 'http://vercel.internal');
  }
}

async function handler(req: Request): Promise<Response> {
  const url = safeUrl(req.url);
  const user = url.searchParams.get('u') || 'diag-probe';
  const mode = url.searchParams.get('mode') || 'full'; // list | boot | full

  await post({
    phase: 'boot',
    event: 'entered',
    user,
    mode,
    env: {
      node: process.version,
      user: process.env.SITE_USERNAME ?? null,
      gatewayKey: !!process.env.AI_GATEWAY_API_KEY,
      gatewayBase: process.env.AI_GATEWAY_BASE_URL ?? null,
      region: process.env.VERCEL_REGION ?? null,
    },
  });

  const cfg = await timed('loadConfig', async () => {
    const m = await import('../src/lib/config.js');
    const c = m.loadConfig();
    return {
      user: c.siteUsername,
      region: c.sandboxRegion,
      vcpus: c.sandboxVcpus,
      timeoutMs: c.sandboxTimeoutMs,
      snapshotExpMs: c.sandboxSnapshotExpirationMs,
      gatewayBase: c.aiGatewayBaseUrl ?? null,
    };
  });

  await timed('sandbox:list', async () => {
    const { Sandbox } = await import('@vercel/sandbox');
    const res = (await (Sandbox.list() as unknown as Promise<{ items?: unknown[] }>)) ?? {};
    const items = (res.items ?? []) as Array<Record<string, unknown>>;
    return { count: items.length, items: items.slice(0, 5) };
  });

  if (mode !== 'list') {
    const ready = await timed('getReadySandbox', async () => {
      const { getReadySandbox } = await import('../src/lib/sandbox.js');
      const r = await getReadySandbox(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cfg as any,
        user,
      );
      return {
        name: r.sandbox.name,
        baseUrl: r.baseUrl,
        created: r.created,
        expiresAt: String(r.sandbox.expiresAt ?? ''),
      };
    });

    if (ready?.baseUrl) {
      await timed('status:direct', async () => {
        const r = await fetch(`${ready.baseUrl}/api/pi-web/status`, {
          signal: AbortSignal.timeout(20000),
        });
        return { status: r.status, body: (await r.text()).slice(0, 500) };
      });
    }
  }

  await post({ phase: 'boot', event: 'done', user, mode, totalMs: Date.now() - t0 });
  return new Response(JSON.stringify({ v: VERSION, totalMs: Date.now() - t0, user, mode }), {
    headers: { 'content-type': 'application/json' },
  });
}

export const GET = handler;
export const POST = handler;
