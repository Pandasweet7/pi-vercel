// TEMP-DIAG: zero-dependency canary to verify basic Lambda execution + routing.
export default async function handler(): Promise<Response> {
  return new Response(
    JSON.stringify({
      pong: true,
      node: process.version,
      hasUser: !!process.env.SITE_USERNAME,
      hasPass: !!process.env.SITE_PASSWORD,
      gateway: !!process.env.AI_GATEWAY_API_KEY,
      sandboxRegion: process.env.SANDBOX_REGION ?? null,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}
