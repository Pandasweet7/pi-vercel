// TEMP-DIAG: in-situ diagnostics. Runs inside the Vercel Function runtime so we
// can see boot/import/OIDC behaviour without depending on external access.
type Step = { step: string; ok: boolean; ms: number; info?: unknown; err?: string };

const steps: Step[] = [];
const t0 = Date.now();

async function stage(name: string, fn: () => Promise<unknown>): Promise<void> {
  const s = Date.now();
  try {
    const info = await fn();
    steps.push({ step: name, ok: true, ms: Date.now() - s, info });
  } catch (e) {
    const err = e as { stack?: string; message?: string; name?: string };
    steps.push({
      step: name,
      ok: false,
      ms: Date.now() - s,
      err: `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`,
      info: err?.stack ? String(err.stack).split('\n').slice(0, 6) : undefined,
    });
  }
}

export default async function handler(): Promise<Response> {
  // [1] env presence (never values)
  steps.push({
    step: 'env',
    ok: true,
    ms: 0,
    info: {
      node: process.version,
      user: !!process.env.SITE_USERNAME,
      pass: !!process.env.SITE_PASSWORD,
      gatewayKey: !!process.env.AI_GATEWAY_API_KEY,
      gatewayBase: process.env.AI_GATEWAY_BASE_URL ?? null,
      oidc: !!process.env.VERCEL_OIDC_TOKEN,
      region: process.env.VERCEL_REGION ?? null,
    },
  });

  // [2] module graph loads?
  await stage('import:handler', async () => {
    const m = await import('../src/lib/handler.js');
    return Object.keys(m);
  });

  // [3] config loads?
  await stage('loadConfig', async () => {
    const { loadConfig } = await import('../src/lib/config.js');
    const cfg = loadConfig();
    return { user: cfg.siteUsername, sandboxRegion: cfg.sandboxRegion, vcpus: cfg.sandboxVcpus };
  });

  // [4] sandbox SDK reachable + OIDC works?
  await stage('sandbox:list', async () => {
    const { Sandbox } = await import('@vercel/sandbox');
    const res = await withTimeout(Sandbox.list() as Promise<{ items?: unknown[] }>, 20000);
    const items = (res?.items ?? []) as Array<{ id?: string; name?: string; state?: string }>;
    return { count: items.length, items: items.slice(0, 10) };
  });

  // [5] basic outbound fetch from the function (not sandbox)
  await stage('fetch:example', async () => {
    const r = await withTimeout(fetch('https://example.com', { signal: AbortSignal.timeout(15000) }), 20000);
    return { status: r.status };
  });

  return new Response(
    JSON.stringify({ totalMs: Date.now() - t0, steps }, null, 2),
    { headers: { 'content-type': 'application/json' } },
  );
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}
