// Catch-all: handles every path under /api/proxy/*.
// TEMP-DIAG: dynamic import + full error echo to surface boot failures.
export default async function handler(
  req: Request,
  context: { params?: { path?: string[] } | Promise<{ path?: string[] }> },
): Promise<Response> {
  try {
    const { handleProxyRequest, extractSegments } = await import('../../src/lib/handler.js');
    const segments = await extractSegments(context ?? {});
    return await handleProxyRequest(req, segments);
  } catch (e) {
    const err = e as { stack?: string; message?: string };
    return new Response(`BOOT_ERR(path): ${err?.stack ?? err?.message ?? String(e)}`, {
      status: 599,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
