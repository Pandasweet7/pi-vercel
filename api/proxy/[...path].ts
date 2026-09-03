// Catch-all: handles every path under /api/proxy/* (rewritten from the SPA + API routes).
import { handleProxyRequest, extractSegments } from '../../src/lib/handler.js';

export default async function handler(
  req: Request,
  context: { params?: { path?: string[] } | Promise<{ path?: string[] }> },
): Promise<Response> {
  const segments = await extractSegments(context);
  return handleProxyRequest(req, segments);
}
