// Catch-all entrypoint: serves every path under /api/proxy/* (rewritten from the
// SPA + API routes). See index.ts for why this uses named route-handle exports
// instead of a default export (default exports are legacy `(req,res)` style and
// their return value is discarded -> requests hang).
import {
  extractSegments,
  handleProxyRequest,
  type PathParams,
} from '../../src/lib/handler.js';

type Ctx = { params?: PathParams | Promise<PathParams> } | undefined;

function make() {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    const segments = await extractSegments(ctx ?? {});
    return handleProxyRequest(req, segments);
  };
}

export const GET = make();
export const HEAD = make();
export const POST = make();
export const PUT = make();
export const PATCH = make();
export const DELETE = make();
export const OPTIONS = make();
