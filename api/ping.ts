// Zero-dependency canary: verifies routing + function wiring quickly.
// Uses a named route-handler export (see api/proxy/index.ts comment: default
// exports are treated as legacy (req,res) handlers and their return is ignored).
export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      pong: true,
      node: process.version,
      user: !!process.env.SITE_USERNAME,
      gatewayKey: !!process.env.AI_GATEWAY_API_KEY,
      gatewayBase: process.env.AI_GATEWAY_BASE_URL ?? null,
      region: process.env.VERCEL_REGION ?? null,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}
