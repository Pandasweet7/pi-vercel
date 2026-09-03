// TEMP-DIAG: exercise the real sandbox boot path, reporting each phase to a
// webhook as it completes (the HTTP response rarely reaches our test box, and a
// long boot may be cut off by the function's own maxDuration).
const REPORT_URL =
  process.env.DIAG_WEBHOOK ?? 'https://webhook.site/ab875bfc-9cd5-447f-b361-512c360dab21';

const t0 = Date.now();

async function post(body: Record<string, unknown>): Promise<void> {
  try {
    await fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startedAt: t0, atMs: Date.now() - t0, ...body }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    /* best effort */
  }
}

function shorten(v: unknown): unknown {
  try {
    const s = JSON.stringify(v);
    return s && s.length > 700 ? `${s.slice(0, 700)}…` : v;
  } catch {
    return String(v);
  }
}

/** Run `fn`, reporting start/ok/err to the webhook immediately. */
async function timed<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const s = Date.now();
  await post({ phase: name, event: 'start' });
  try {
    const v = await fn();
    await post({ phase: name, event: 'ok', ms: Date.now() - s, info: shorten(v) });
    return v;
  } catch (e) {
    const err = e as Error;
    await post({
      phase: name,
      event: 'error',
      ms: Date.now() - s,
      err: `${err?.name ?? 'E'}: ${err?.message ?? String(e)}`,
      stack: String(err?.stack ?? '').split('\n').slice(0, 5),
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
  const user = safeUrl(req.url).searchParams.get('u') || 'diag-probe';
  await post({ stage: 'start', user });

  const cfg = await timed('loadConfig', async () => {
    const m = await import('../src/lib/config.js');
    const c = m.loadConfig();
    return {
      user: c.siteUsername,
      region: c.sandboxRegion,
      vcpus: c.sandboxVcpus,
      timeoutMs: c.sandboxTimeoutMs,
      snapshotExpMs: c.sandboxSnapshotExpirationMs,
    };
  });

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
      return { status: r.status, body: (await r.text()).slice(0, 400) };
    });
  }

  await post({ stage: 'done', totalMs: Date.now() - t0, user });
  return new Response(JSON.stringify({ totalMs: Date.now() - t0, user, ready }, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
}

export const GET = handler;
export const POST = handler;
