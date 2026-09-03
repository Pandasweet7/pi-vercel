// Index: serves the site root "/" (rewritten to /api/proxy).
import { handleProxyRequest } from '../../src/lib/handler.js';

export default async function handler(req: Request): Promise<Response> {
  return handleProxyRequest(req, []);
}
