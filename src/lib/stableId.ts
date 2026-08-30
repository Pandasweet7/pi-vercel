// Stable per-user sandbox name. Same algorithm as the EdgeOne version's
// stableConversationId, so a user maps to one identity across deployments.
// Deterministic from the authenticated username → one sandbox per user,
// shared by every browser (no per-browser isolation).
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function sandboxNameFor(username: string): string {
  return `piweb-${fnv1a(username || 'pi-web-makers')}`;
}
