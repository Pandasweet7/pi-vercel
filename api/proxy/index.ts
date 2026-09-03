// Index: serves the site root "/" (rewritten to /api/proxy).
// TEMP-DIAG: dynamic import + full error echo to surface boot failures.
export default async function handler(req: Request): Promise<Response> {
  try {
    const { handleProxyRequest } = await import('../../src/lib/handler.js');
    return await handleProxyRequest(req, []);
  } catch (e) {
    const err = e as { stack?: string; message?: string };
    return new Response(`BOOT_ERR(index): ${err?.stack ?? err?.message ?? String(e)}`, {
      status: 599,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
