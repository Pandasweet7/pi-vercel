// Index entrypoint: serves the site root "/" (rewritten to /api/proxy).
//
// IMPORTANT: with `"type": "module"` + no framework detected, `@vercel/node`
// treats a `export default function` as the legacy `(req, res) => void` handler
// and DISCARDS the returned Response (runtime log: "default export returned a
// `Response` ... returns are ignored"), which makes every request hang until
// the function times out. Route-handler style NAMED exports (GET/POST/…) are
// the correct web-handler form: they are called `(request, context)` and their
// returned Response is actually sent to the client.
import { handleProxyRequest } from '../../src/lib/handler.js';

type VercelRouteContext = unknown;

function make() {
  return async (req: Request, _ctx: VercelRouteContext): Promise<Response> =>
    handleProxyRequest(req, []);
}

export const GET = make();
export const HEAD = make();
export const POST = make();
export const PUT = make();
export const PATCH = make();
export const DELETE = make();
export const OPTIONS = make();
