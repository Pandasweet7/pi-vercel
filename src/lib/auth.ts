// HTTP Basic Auth — identical contract to the EdgeOne middleware.js.
export interface AuthResult {
  ok: boolean;
  username?: string;
}

export function checkBasicAuth(
  authHeader: string | null | undefined,
  siteUsername: string,
  sitePassword: string,
): AuthResult {
  if (!siteUsername || !sitePassword) return { ok: false };
  if (!authHeader || !authHeader.startsWith('Basic ')) return { ok: false };
  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep === -1) return { ok: false };
    const username = decoded.slice(0, sep);
    const password = decoded.slice(sep + 1);
    if (username !== siteUsername || password !== sitePassword) return { ok: false };
    return { ok: true, username };
  } catch {
    return { ok: false };
  }
}

export function unauthorizedResponse(): Response {
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="PI WEB"',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
