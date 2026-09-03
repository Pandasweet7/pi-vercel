// Reverse-proxy the incoming request to the pi-web server inside the sandbox.
// Streams responses so SSE stays incremental (never buffered).
//
// WebSocket relay (M3): the pi-web UI drives the chat view + terminals over
// WebSocket events (sessions/{id}/events, terminals/{id}/socket, /events), so
// without it the UI only paints once the REST poll catches up (message appears
// ~when the model finishes). Vercel Functions WebSocket support (public beta)
// accepts upgrades via experimental_upgradeWebSocket() and hands us a `ws`
// WebSocket; we bridge it to a `ws` client connected to the sandbox.

import { experimental_upgradeWebSocket } from '@vercel/functions';
import WebSocket from 'ws';

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
  // `req.url` may be relative under Vercel; resolve defensively.
  let incoming: URL;
  try {
    incoming = new URL(req.url);
  } catch {
    incoming = new URL(req.url, 'http://vercel.internal');
  }
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

/**
 * Bridge a browser WebSocket through this Function to the sandbox's pi-web.
 * The upgrade request was already authenticated + the sandbox is ready when
 * this is called. Returns the platform upgrade Response.
 */
export async function proxyWebSocket(req: Request, baseUrl: string, path: string): Promise<Response> {
  let incoming: URL;
  try {
    incoming = new URL(req.url);
  } catch {
    incoming = new URL(req.url, 'http://vercel.internal');
  }
  const wsBase = baseUrl.replace(/^https:/, 'wss:');
  const upstreamUrl = `${wsBase}${path === '' ? '/' : path}${incoming.search}`;

  return experimental_upgradeWebSocket(
    (client) => {
      const upstream = new WebSocket(upstreamUrl);
      // ws throws on send() before the socket is open; buffer instead.
      const pending: Array<{ data: unknown; binary: boolean }> = [];

      client.on('message', (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data as never, { binary: isBinary });
        } else {
          pending.push({ data, binary: isBinary });
        }
      });

      upstream.on('open', () => {
        for (const m of pending) upstream.send(m.data as never, { binary: m.binary });
        pending.length = 0;
      });
      upstream.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) client.send(data as never, { binary: isBinary });
      });

      upstream.on('close', (code, reason) => {
        try {
          client.close(code, reason);
        } catch {
          /* already closed */
        }
      });
      upstream.on('error', () => {
        try {
          client.close(1011, 'sandbox websocket error');
        } catch {
          /* already closed */
        }
      });
      client.on('close', () => {
        try {
          upstream.close();
        } catch {
          /* already closed */
        }
      });
      client.on('error', () => {
        try {
          upstream.close();
        } catch {
          /* already closed */
        }
      });
    },
    { maxPayload: 4 * 1024 * 1024 },
  );
}
