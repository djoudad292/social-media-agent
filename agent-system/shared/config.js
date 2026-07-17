const missing = [];

const env = (key, fallback = undefined) => {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    missing.push(key);
    return undefined;
  }
  return v.trim();
};

const envInt = (key, fallback) => {
  const v = env(key);
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
};

const config = {
  supabase: {
    url: env('SUPABASE_URL'),
    serviceKey: env('SUPABASE_SECRET_KEY'),
  },
  redis: {
    url: env('REDIS_URL'),
  },
  azure: {
    apiKey: env('AZURE_OPENAI_API_KEY'),
    endpoint: env('AZURE_OPENAI_ENDPOINT'),
    apiVersion: env('AZURE_OPENAI_API_VERSION', '2025-01-01-preview'),
    gpt5Mini: env('AZURE_GPT5_MINI_DEPLOYMENT', 'gpt-5-mini'),
  },
  speech: {
    key: env('AZURE_SPEECH_KEY'),
    region: env('AZURE_SPEECH_REGION', 'germanywestcentral'),
  },
  facebook: {
    accessToken: env('FACEBOOK_ACCESS_TOKEN'),
    pageId: env('FACEBOOK_PAGE_ID', '651243158078819'),
  },
  telegram: {
    botToken: env('TELEGRAM_BOT_TOKEN'),
  },
  pexels: {
    key: env('PEXELS_API_KEY'),
  },
  pixabay: {
    key: env('PIXABAY_API_KEY'),
  },
  jina: {
    key: env('JINA_API_KEY'),
  },
  freenews: {
    key: env('FREENEWS_API_KEY'),
  },
  gatewayToken: env('GATEWAY_TOKEN'),
  port: {
    data: envInt('PORT', 3003),
    content: envInt('CONTENT_PORT', 3001),
    media: envInt('MEDIA_PORT', 3002),
    gateway: envInt('GATEWAY_PORT', 3999),
  },
};

config.services = {
  gateway: env('GATEWAY_URL'),
  content: env('CONTENT_URL'),
  media: env('MEDIA_URL'),
  data: env('DATA_URL'),
};

if (missing.length > 0) {
  console.warn('[config] MISSING ENV VARS:', missing.join(', '));
  if (missing.includes('AZURE_OPENAI_API_KEY')) {
    console.warn('[config] AI features will be disabled');
  }
  if (missing.includes('FACEBOOK_ACCESS_TOKEN')) {
    console.warn('[config] Facebook posting will be disabled');
  }
  if (missing.includes('REDIS_URL')) {
    console.warn('[config] Queue/persistence will be disabled (in-memory only)');
  }
}

module.exports = config;
