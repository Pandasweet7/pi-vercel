// Catch-all handler: every request (SPA `/`, static assets, pi-web `/api/*`,
// SSE) is rewritten by vercel.json into /api/proxy/<original-path>, so the
// original target path is exactly "/" + path.join("/"). This namespace is
// reserved for the proxy and never used by pi-web itself, so reconstruction
// is unambiguous.
import { loadConfig } from '../../lib/config.ts';
import { checkBasicAuth, unauthorizedResponse } from '../../lib/auth.ts';
import { getReadySandbox, keepAlive } from '../../lib/sandbox.ts';
import { proxyHttp } from '../../lib/proxy.ts';

export default async function handler(req: Request, context: { params?: { path?: string[] } }): Promise<Response> {
  const cfg = loadConfig();

  // [1] Basic Auth.
  const auth = checkBasicAuth(req.headers.get('authorization'), cfg.siteUsername, cfg.sitePassword);
  if (!auth.ok) return unauthorizedResponse();

  // [2] Reconstruct the original target path from the catch-all segments.
  const segments = context.params?.path ?? [];
  const targetPath = '/' + segments.join('/');

  // [3] WebSocket upgrade? (M3 — terminal + session events.)
  const isWs = (req.headers.get('upgrade') || '').toLowerCase() === 'websocket';
  if (isWs) {
    // TODO(M3): relay WS or bridge to SSE. For now, refuse so the failure is visible.
    return new Response('WebSocket proxy not implemented yet (M3)', { status: 501 });
  }

  try {
    // [4] Get/resume the user's sandbox and ensure pi-web is serving.
    const { sandbox, baseUrl } = await getReadySandbox(cfg, auth.username!);

    // [5] Reverse-proxy (streams SSE incrementally).
    const response = await proxyHttp(req, baseUrl, targetPath);

    // [6] Keep the session alive while the user is active.
    void keepAlive(sandbox, cfg);

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`PI WEB proxy error: ${message}`, {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
