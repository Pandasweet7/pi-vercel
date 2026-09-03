// Environment access. Mirrors the EdgeOne version's env contract so both
// deployments share identical configuration.
export interface AppConfig {
  siteUsername: string;
  sitePassword: string;
  // Model provider — either an AI gateway or BYOK keys (any subset).
  aiGatewayApiKey?: string;
  aiGatewayBaseUrl?: string;
  aiGatewayModel?: string;
  byok: Record<string, string>;
  // Sandbox tuning.
  sandboxTimeoutMs: number;
  sandboxRegion: string;
  sandboxImage?: string; // VCR image ref; undefined → managed image + install at onCreate
  sandboxReadyTimeoutMs: number;
  /** Snapshot TTL in ms. 0 = never expire (design §3.4: avoid the 30-day default). */
  sandboxSnapshotExpirationMs: number;
  /** Keep only the N most recent snapshots (1-10). */
  sandboxKeepLastSnapshots: number;
  /** vCPU count for the sandbox (2048 MB RAM per vCPU). Default 2. */
  sandboxVcpus: number;
}

const BYOK_PREFIXES = [
  'ANTHROPIC_', 'OPENAI_', 'DEEPSEEK_', 'GOOGLE_', 'GEMINI_', 'MISTRAL_',
  'GROQ_', 'CEREBRAS_', 'XAI_', 'OPENROUTER_', 'HUGGINGFACE_', 'HF_',
  'FIREWORKS_', 'TOGETHER_', 'BASETEN_', 'KIMI_', 'MINIMAX_', 'ZAI_',
  'NVIDIA_', 'CLOUDFLARE_', 'AZURE_OPENAI_',
];

function intOr(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const siteUsername = env.SITE_USERNAME ?? '';
  const sitePassword = env.SITE_PASSWORD ?? '';
  const byok: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string' || value === '') continue;
    if (BYOK_PREFIXES.some((p) => key.startsWith(p)) && key.endsWith('_API_KEY')) {
      byok[key] = value;
    }
  }
  return {
    siteUsername,
    sitePassword,
    aiGatewayApiKey: env.AI_GATEWAY_API_KEY || undefined,
    aiGatewayBaseUrl: env.AI_GATEWAY_BASE_URL || undefined,
    aiGatewayModel: env.AI_GATEWAY_MODEL || undefined,
    byok,
    sandboxTimeoutMs: intOr(env.SANDBOX_TIMEOUT_MS, 5 * 60 * 1000),
    sandboxRegion: env.SANDBOX_REGION || 'iad1',
    sandboxImage: env.SANDBOX_IMAGE || undefined,
    sandboxReadyTimeoutMs: intOr(env.SANDBOX_READY_TIMEOUT_MS, 90 * 1000),
    // Snapshots default to never expiring: a returning user must not lose
    // sessions/workspace because 30 idle days passed (DESIGN §3.4).
    sandboxSnapshotExpirationMs: intOr(env.SANDBOX_SNAPSHOT_EXPIRATION_MS, 0),
    sandboxKeepLastSnapshots: Math.min(10, Math.max(1, intOr(env.SANDBOX_KEEP_LAST_SNAPSHOTS, 2))),
    sandboxVcpus: Math.min(8, Math.max(1, intOr(env.SANDBOX_VCPUS, 2))),
  };
}
