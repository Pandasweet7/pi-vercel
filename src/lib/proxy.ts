// Reverse-proxy the incoming request to the pi-web server inside the sandbox.
// Streams responses so SSE stays incremental (never buffered).
//
// WebSocket handling is the open design decision (DESIGN.md §5 risk #2):
//   option A — relay WS through the Vercel Function (public beta), or
//   option B — bridge WS→SSE like the EdgeOne version.
// Both are TODO(M3).

/** Headers that must not be forwarded to / from the upstream. */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

function forwardHeaders(src: Headers): Headers {
  const out = new Headers();
  src.forEach((value, key) => {
    const lk = key.toLowerCase();
    if (!HOP_BY_HOP.has(lk)) out.set(key, value);
  });
  // Force identity so the upstream never gzips the body — gzip would buffer
  // SSE / streaming responses and defeat incremental delivery (EdgeOne bug #1).
  out.set('accept-encoding', 'identity');
  return out;
}

/**
 * Proxy an HTTP/SSE request to the sandbox and stream the response back.
 */
export async function proxyHttp(req: Request, baseUrl: string, path: string): Promise<Response> {
  const target = new URL(path, baseUrl);
  const incoming = new URL(req.url);
  target.search = incoming.search;

  const headers = forwardHeaders(req.headers);
  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: 'manual',
    // @ts-expect-error duplex is required for streaming request bodies.
    duplex: 'half',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
    init.body = req.body;
  }

  const upstream = await fetch(target, init);

  // Stream the body through untouched (SSE + large payloads stay incremental).
  const responseHeaders = forwardHeaders(upstream.headers);
  // The body we hand out is the decoded stream — never claim an encoding it
  // doesn't have, and never let intermediate caches store dynamic responses.
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.set('cache-control', 'no-store, no-cache, must-revalidate');
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

// TODO(M3): proxyWebSocket(req, baseUrl, path) — WS relay or WS→SSE bridge.
