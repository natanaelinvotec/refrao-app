"use strict";
const path = require("path");
require("./lib/http").loadEnv(path.resolve(__dirname, "..", ".env"));

const env = (k, d = "") => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);
const num = (k, d) => Number(env(k, d));
const MOCK = env("MOCK_PROVIDERS", "0") === "1";

const config = {
  port: num("PORT", 3000),
  baseUrl: env("BASE_URL", "http://localhost:3000").replace(/\/$/, ""),
  brand: env("BRAND_NAME", "Refrão"),
  supportWhatsapp: env("SUPPORT_WHATSAPP", ""),
  secret: env("SECRET", "dev-secret-troque"),
  adminPassword: env("ADMIN_PASSWORD", "admin"),
  mock: MOCK,
  freePreviews: num("FREE_PREVIEWS", 1),

  dataDir: path.resolve(__dirname, "..", "data"),
  publicDir: path.resolve(__dirname, "..", "public"),

  suno: { baseUrl: env("SUNO_BASE_URL", "https://api.sunoapi.org"), apiKey: env("SUNO_API_KEY"), model: env("SUNO_MODEL", "V4_5"), mock: MOCK || !env("SUNO_API_KEY") },
  lyrics: {
    gemini: env("GEMINI_API_KEY"), geminiModel: env("GEMINI_MODEL", "gemini-2.0-flash"),
    openai: env("OPENAI_API_KEY"), openaiBase: env("OPENAI_BASE_URL", "https://api.openai.com/v1"), openaiModel: env("OPENAI_MODEL", "gpt-4o-mini"),
    mock: MOCK || (!env("GEMINI_API_KEY") && !env("OPENAI_API_KEY"))
  },
  pix: { accessToken: env("MP_ACCESS_TOKEN"), webhookSecret: env("MP_WEBHOOK_SECRET"), expires: num("PIX_EXPIRES_SECONDS", 1800), mock: MOCK || !env("MP_ACCESS_TOKEN") },
  whatsapp: { url: env("EVOLUTION_URL").replace(/\/$/, ""), instance: env("EVOLUTION_INSTANCE"), apiKey: env("EVOLUTION_API_KEY"), mock: MOCK || !env("EVOLUTION_URL") },
  media: { ffmpeg: env("FFMPEG_PATH", "ffmpeg"), ffprobe: env("FFPROBE_PATH", "ffprobe"), font: env("FONT_PATH", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"), watermarkEvery: num("WATERMARK_EVERY", 8), previewSeconds: num("PREVIEW_SECONDS", 0) },

  prices: {
    // preço "por" (cobrado) e preço "de" (riscado na tela; 0 = sem promoção)
    musica: num("PRICE_MUSICA", 990), clipe: num("PRICE_CLIPE", 1490), studio: num("PRICE_STUDIO", 4990),
    de: { musica: num("PRICE_MUSICA_DE", 1490), clipe: num("PRICE_CLIPE_DE", 2490), studio: num("PRICE_STUDIO_DE", 0) },
    bumps: { versoes: num("BUMP_VERSOES", 790), urgente: num("BUMP_URGENTE", 490), clipe: num("BUMP_CLIPE", 1000) }
  },
  // cupom "siga no Instagram": desconto em % sobre o plano (Música e Música + clipe; não vale no Studio nem nos extras)
  cupom: { pct: num("CUPOM_SEGUIDOR_PCT", 10), dias: num("CUPOM_SEGUIDOR_DIAS", 30) },
  instagram: {
    handle: env("IG_HANDLE", "refrao.app"),
    accountId: env("IG_ACCOUNT_ID"), accessToken: env("IG_ACCESS_TOKEN"), verifyToken: env("IG_VERIFY_TOKEN"),
    mock: MOCK || !env("IG_ACCESS_TOKEN")
  },
  whatsappWebhookSecret: env("EVOLUTION_WEBHOOK_SECRET")
};

// Fora do modo mock, o servidor não sobe com segredos default/fracos (eles assinam sessão, admin e downloads).
if (!config.mock) {
  if (!config.secret || config.secret === "dev-secret-troque" || config.secret === "troque-por-uma-chave-longa" || config.secret.length < 24)
    throw new Error("SECRET ausente ou fraco no .env: defina uma chave aleatória com 24+ caracteres (ex.: openssl rand -hex 32).");
  if (!process.env.ADMIN_PASSWORD || config.adminPassword === "admin" || config.adminPassword === "troque-esta-senha" || config.adminPassword.length < 10)
    throw new Error("ADMIN_PASSWORD ausente, default ou curta (mínimo 10 caracteres).");
  if (!config.pix.mock && !config.pix.webhookSecret)
    console.warn("[aviso] MP_WEBHOOK_SECRET vazio: o webhook segue seguro (sempre confirma no Mercado Pago), mas configure a assinatura no painel de desenvolvedor.");
}
config.cookieSecure = env("COOKIE_SECURE", config.baseUrl.startsWith("https") ? "1" : "0") === "1";

module.exports = config;
