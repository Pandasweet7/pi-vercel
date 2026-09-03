/**
 * Shared proxy handler logic.
 *
 * Two entrypoints delegate here (see /api/proxy/*):
 *   - api/proxy/index.ts     -> site root "/"  (rewritten to /api/proxy)
 *   - api/proxy/[...path].ts -> everything else ("/x/y" -> /api/proxy/x/y)
 *
 * Flow: Basic Auth -> per-user sandbox ready -> streaming reverse proxy.
 */
import { loadConfig } from './config.js';
import { checkBasicAuth, unauthorizedResponse } from './auth.js';
import { getReadySandbox, keepAlive } from './sandbox.js';
import { proxyHttp, proxyWebSocket } from './proxy.js';

const PROXY_PREFIX = '/api/proxy';

export type PathParams = { path?: string[] };

/** Vercel may deliver `params` directly or as a Promise, depending on runtime. */
export async function extractSegments(context: {
  params?: PathParams | Promise<PathParams>;
}): Promise<string[]> {
  const p = context.params;
  if (!p) return [];
  const resolved = await p;
  return resolved.path ?? [];
}

/** Reconstruct the original pi-web path from catch-all segments or the URL. */
export function resolveTargetPath(req: Request, segments: string[]): string {
  if (segments.length > 0) return '/' + segments.join('/');
  try {
    const url = requestUrl(req);
    let p = url.pathname;
    if (p === PROXY_PREFIX || p === `${PROXY_PREFIX}/`) return '/';
    if (p.startsWith(PROXY_PREFIX)) p = p.slice(PROXY_PREFIX.length);
    if (!p.startsWith('/')) p = '/' + p;
    return p === '' ? '/' : p;
  } catch {
    return '/';
  }
}

/**
 * Vercel's Node.js web handler may deliver `request.url` as a *relative* path
 * (e.g. "/api/proxy/foo"), so `new URL(req.url)` throws ERR_INVALID_URL.
 * Always resolve through this helper with a placeholder base.
 */
export function requestUrl(req: Request): URL {
  try {
    return new URL(req.url);
  } catch {
    return new URL(req.url, 'http://vercel.internal');
  }
}

export async function handleProxyRequest(
  req: Request,
  segments: string[],
): Promise<Response> {
  const cfg = loadConfig();

  // [1] Basic Auth.
  const auth = checkBasicAuth(
    req.headers.get('authorization'),
    cfg.siteUsername,
    cfg.sitePassword,
  );
  if (!auth.ok) return unauthorizedResponse();

  // [2] Original target path.
  const targetPath = resolveTargetPath(req, segments);

  // [3] WebSocket upgrade? (M3 — session events + terminals.)
  const isWs = (req.headers.get('upgrade') || '').toLowerCase() === 'websocket';

  try {
    // [4] Get/resume the user's sandbox and ensure pi-web is serving.
    const { sandbox, baseUrl } = await getReadySandbox(cfg, auth.username!);

    // [5] Keep the session alive while the user is active (fire-and-forget).
    void keepAlive(sandbox, cfg).catch(() => {});

    if (isWs) {
      // Relay the WebSocket to the sandbox (session events / terminal).
      return await proxyWebSocket(req, baseUrl, targetPath);
    }

    // [6] Reverse-proxy (streams SSE incrementally).
    return await proxyHttp(req, baseUrl, targetPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`PI WEB proxy error: ${message}`, {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}