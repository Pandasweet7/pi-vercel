// Catch-all proxy handler: every request (SPA `/`, static assets, pi-web
// `/api/*`, SSE) is rewritten by vercel.json into /api/proxy/<original-path>.
//
// The route uses an OPTIONAL catch-all ([[...path]].ts) so the site root "/"
// still lands here. If Vercel does not supply path segments (e.g. for "/"),
// we fall back to stripping the /api/proxy prefix from the request URL.
import { loadConfig } from '../../lib/config';
import { checkBasicAuth, unauthorizedResponse } from '../../lib/auth';
import { getReadySandbox, keepAlive } from '../../lib/sandbox';
import { proxyHttp } from '../../lib/proxy';

const PROXY_PREFIX = '/api/proxy';

type PathParams = { path?: string[] };

async function extractParams(context: {
  params?: PathParams | Promise<PathParams>;
}): Promise<PathParams> {
  const p = context.params;
  if (!p) return {};
  return await p; // newer Vercel runtimes may deliver params as a Promise
}

function resolveTargetPath(req: Request, params: PathParams): string {
  const segments = params.path;
  if (segments && segments.length > 0) {
    return '/' + segments.join('/');
  }
  // Fallback: reconstruct from the rewritten URL pathname.
  try {
    const url = new URL(req.url);
    let p = url.pathname;
    if (p.startsWith(PROXY_PREFIX)) p = p.slice(PROXY_PREFIX.length);
    if (!p.startsWith('/')) p = '/' + p;
    return p === '' ? '/' : p;
  } catch {
    return '/';
  }
}

export default async function handler(
  req: Request,
  context: { params?: PathParams | Promise<PathParams> },
): Promise<Response> {
  const cfg = loadConfig();

  // [1] Basic Auth.
  const auth = checkBasicAuth(
    req.headers.get('authorization'),
    cfg.siteUsername,
    cfg.sitePassword,
  );
  if (!auth.ok) return unauthorizedResponse();

  // [2] Reconstruct the original target path.
  const params = await extractParams(context);
  const targetPath = resolveTargetPath(req, params);

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

    // [6] Keep the session alive while the user is active (fire-and-forget).
    void keepAlive(sandbox, cfg).catch(() => {});

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`PI WEB proxy error: ${message}`, {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
