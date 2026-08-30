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
}

const BYOK_PREFIXES = [
  'ANTHROPIC_', 'OPENAI_', 'DEEPSEEK_', 'GOOGLE_', 'GEMINI_', 'MISTRAL_',
  'GROQ_', 'CEREBRAS_', 'XAI_', 'OPENROUTER_', 'HUGGINGFACE_', 'HF_',
  'FIREWORKS_', 'TOGETHER_', 'BASETEN_', 'KIMI_', 'MINIMAX_', 'ZAI_',
  'NVIDIA_', 'CLOUDFLARE_', 'AZURE_OPENAI_',
];

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
    sandboxTimeoutMs: Number(env.SANDBOX_TIMEOUT_MS || 5 * 60 * 1000),
    sandboxRegion: env.SANDBOX_REGION || 'iad1',
    sandboxImage: env.SANDBOX_IMAGE || undefined,
  };
}
