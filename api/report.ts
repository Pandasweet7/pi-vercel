// TEMP-DIAG: out-of-band self-report. Posts its own progress to a webhook so we
// can see how far the handler gets even when the HTTP response never returns.
const REPORT_URL =
  process.env.DIAG_WEBHOOK ??
  'https://webhook.site/ab875bfc-9cd5-447f-b361-512c360dab21';

const steps: Array<Record<string, unknown>> = [];
const t0 = Date.now();

async function report(body: Record<string, unknown>): Promise<string> {
  try {
    const r = await fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ts: Date.now(), startedAt: t0, ...body }),
      signal: AbortSignal.timeout(8000),
    });
    return `http=${r.status}`;
  } catch (e) {
    return `post-failed:${(e as Error)?.message}`;
  }
}

/** Run `fn` but never wait longer than `ms`. */
function guard<T>(name: string, p: Promise<T>, ms: number): Promise<Record<string, unknown>> {
  return Promise.race([
    p.then(
      (v) => ({ name, ok: true, ms: Date.now() - t0, info: safe(v) }),
      (e) => ({
        name,
        ok: false,
        ms: Date.now() - t0,
        err: `${(e as Error)?.name ?? 'E'}: ${(e as Error)?.message ?? String(e)}`,
        stack: String((e as Error)?.stack ?? '').split('\n').slice(0, 4),
      }),
    ),
    new Promise((res) =>
      setTimeout(() => res({ name, ok: false, ms: Date.now() - t0, err: `HUNG>${ms}ms` }), ms),
    ),
  ]);
}

function safe(v: unknown): unknown {
  try {
    JSON.stringify(v);
    return v;
  } catch {
    return String(v);
  }
}

export default async function handler(): Promise<Response> {
  // [0] Did we get invoked at all?
  const posted = await report({
    stage: 'entered',
    env: {
      node: process.version,
      user: !!process.env.SITE_USERNAME,
      gatewayKey: !!process.env.AI_GATEWAY_API_KEY,
      gatewayBase: process.env.AI_GATEWAY_BASE_URL ?? null,
      oidc: !!process.env.VERCEL_OIDC_TOKEN,
      oidcLen: (process.env.VERCEL_OIDC_TOKEN ?? '').length,
      region: process.env.VERCEL_REGION ?? null,
      runtime: process.env.VERCEL_RUNTIME ?? null,
    },
  });

  // [1..4] guarded stages — each can hang without blocking the report.
  steps.push(await guard('import:sdk', import('@vercel/sandbox').then((m) => Object.keys(m)), 25000));
  steps.push(
    await guard('import:handler', import('../src/lib/handler.js').then((m) => Object.keys(m)), 25000),
  );
  steps.push(
    await guard(
      'loadConfig',
      import('../src/lib/config.js').then((m) => {
        const c = m.loadConfig();
        return { user: c.siteUsername, region: c.sandboxRegion, vcpus: c.sandboxVcpus };
      }),
      15000,
    ),
  );
  steps.push(
    await guard(
      'sandbox:list',
      import('@vercel/sandbox').then(async (m) => {
        const res = (await (m.Sandbox.list() as Promise<{ items?: unknown[] }>)) ?? {};
        return { count: (res.items ?? []).length };
      }),
      30000,
    ),
  );
  steps.push(
    await guard(
      'fetch:egress',
      fetch('https://example.com', { signal: AbortSignal.timeout(15000) }).then((r) => ({
        status: r.status,
      })),
      20000,
    ),
  );

  await report({ stage: 'done', totalMs: Date.now() - t0, steps, posted });

  return new Response(JSON.stringify({ totalMs: Date.now() - t0, posted, steps }, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
}
