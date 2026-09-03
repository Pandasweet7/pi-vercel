// TEMP-DIAG: exercise the real sandbox boot path.
// Reports through (a) console.log -> Vercel runtime logs, (b) HTTP response body,
// (c) a webhook when not rate-limited. Named route-handler exports (see
// api/proxy/index.ts: default exports are legacy (req,res) and their return is
// ignored, which hangs the function).
const t0 = Date.now();

type Phase = { phase: string; event: string; ms?: number; info?: unknown; err?: string; stack?: string[] };
const phases: Phase[] = [];

function record(p: Phase): void {
  phases.push(p);
  const line = `[probe] ${p.phase}/${p.event}${p.ms !== undefined ? ` ms=${p.ms}` : ''}${
    p.info !== undefined ? ` info=${JSON.stringify(p.info).slice(0, 500)}` : ''
  }${p.err ? ` err=${p.err}` : ''}`;
  if (p.event === 'error') console.error(line);
  else console.log(line);
}

function safeUrl(u: string): URL {
  try {
    return new URL(u);
  } catch {
    return new URL(u, 'http://vercel.internal');
  }
}

async function timed<T>(phase: string, fn: () => Promise<T>): Promise<T | undefined> {
  const s = Date.now();
  record({ phase, event: 'start' });
  try {
    const v = await fn();
    record({ phase, event: 'ok', ms: Date.now() - s, info: v });
    return v;
  } catch (e) {
    const err = e as Error;
    record({
      phase,
      event: 'error',
      ms: Date.now() - s,
      err: `${err?.name ?? 'E'}: ${err?.message ?? String(e)}`,
      stack: String(err?.stack ?? '').split('\n').slice(0, 6),
    });
    return undefined;
  }
}

async function handler(req: Request): Promise<Response> {
  const user = safeUrl(req.url).searchParams.get('u') || 'diag-probe';
  record({ phase: 'boot', event: 'start', info: { user, node: process.version } });

  const cfg = await timed('loadConfig', async () => {
    const m = await import('../src/lib/config.js');
    return m.loadConfig();
  });

  const ready = await timed('getReadySandbox', async () => {
    const { getReadySandbox } = await import('../src/lib/sandbox.js');
    const r = await getReadySandbox(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cfg as any,
      user,
    );
    return { name: r.sandbox.name, baseUrl: r.baseUrl, created: r.created, expiresAt: String(r.sandbox.expiresAt ?? '') };
  });

  if (ready?.baseUrl) {
    await timed('status:direct', async () => {
      const r = await fetch(`${ready.baseUrl}/api/pi-web/status`, { signal: AbortSignal.timeout(20000) });
      return { status: r.status, body: (await r.text()).slice(0, 400) };
    });
  }

  const totalMs = Date.now() - t0;
  record({ phase: 'boot', event: 'done', ms: totalMs, info: { ready: !!ready } });
  return new Response(JSON.stringify({ totalMs, user, ready, phases }, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
}

export const GET = handler;
export const POST = handler;
