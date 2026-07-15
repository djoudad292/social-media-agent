const config = {
  supabase: {
    url: process.env.SUPABASE_URL || 'https://iofeoxrpcygvqlxxazxm.supabase.co',
    serviceKey: process.env.SUPABASE_SECRET_KEY || 'sb_secret_W-N_SvCslVziS36us6eq4Q_rZt9QVRH',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://default:cELvQv3bb7nHh5hPsDUDNdSQFbQNd9Cp@voice-glistening-teeth-80708.db.redis.io:11059',
  },
  azure: {
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || 'https://openclaw-ai2-5c86d.openai.azure.com',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview',
    gpt5Mini: process.env.AZURE_GPT5_MINI_DEPLOYMENT || 'gpt-5-mini',
  },
  speech: {
    key: process.env.AZURE_SPEECH_KEY,
    region: process.env.AZURE_SPEECH_REGION || 'germanywestcentral',
  },
  facebook: {
    accessToken: process.env.FACEBOOK_ACCESS_TOKEN,
    pageId: process.env.FACEBOOK_PAGE_ID || '651243158078819',
  },
  telegram: { botToken: process.env.TELEGRAM_BOT_TOKEN },
  pexels: { key: process.env.PEXELS_API_KEY },
  gemini: { key: process.env.GEMINI_API_KEY },
  jina: { key: process.env.JINA_API_KEY },
  freenews: { key: process.env.FREENEWS_API_KEY },
  gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
};

config.services = {
  gateway: process.env.GATEWAY_URL,
  content: process.env.CONTENT_URL,
  media: process.env.MEDIA_URL,
  data: process.env.DATA_URL,
};

module.exports = config;
