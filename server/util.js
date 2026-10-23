"use strict";
const crypto = require("crypto");
const config = require("./config");

const id = (n = 16) => crypto.randomBytes(n).toString("hex");
const slugify = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40);
const onlyDigits = (s) => (s || "").replace(/\D/g, "");

// WhatsApp BR normalizado: 55 + DDD + número (12 ou 13 dígitos)
function normalizeWhatsapp(s) {
  let d = onlyDigits(s);
  if (!d) return "";
  if (d.startsWith("55") && d.length >= 12) return d.slice(0, 13);
  if (d.length === 10 || d.length === 11) return "55" + d;
  return "";
}

// ---------- tokens assinados (HMAC) — sessão, download, admin ----------
function sign(payload, ttlSeconds) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString("base64url");
  const mac = crypto.createHmac("sha256", config.secret).update(body).digest("base64url");
  return body + "." + mac;
}
function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", config.secret).update(body).digest("base64url");
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); if (p.exp < Date.now()) return null; return p; } catch { return null; }
}

function cookie(res, name, value, maxAgeSec) {
  const secure = config.cookieSecure ? "; Secure" : "";
  res.setHeader("Set-Cookie", [...(res.getHeader("Set-Cookie") || []), `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`]);
}
function readCookie(req, name) {
  const m = (req.headers.cookie || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : "";
}

// ---------- catálogo de ritmos: tags de estilo em inglês para o modelo ----------
const RITMOS = {
  forro: { nome: "Forró", style: "forró pé de serra, accordion, triangle, zabumba, upbeat Brazilian northeast, catchy chorus" },
  sertanejo: { nome: "Sertanejo", style: "sertanejo universitário, acoustic guitar, accordion, romantic, Brazilian country, singalong chorus" },
  pagode: { nome: "Pagode", style: "pagode, cavaquinho, pandeiro, tantã, Brazilian samba-pagode, warm vocals, catchy chorus" },
  piseiro: { nome: "Piseiro", style: "piseiro, forró eletrônico, synth accordion, 140 bpm, party, Brazilian northeast" },
  funk: { nome: "Funk", style: "funk carioca, tamborzão beat, 130 bpm, MC vocals, hook repeated, Brazilian baile funk" },
  gospel: { nome: "Gospel", style: "gospel brasileiro, worship ballad, piano, strings, emotional, powerful vocals" },
  mpb: { nome: "MPB", style: "MPB, bossa influenced, nylon guitar, soft percussion, poetic, Brazilian popular music" },
  arrocha: { nome: "Arrocha", style: "arrocha, romantic Bahian ballad, synth, slow groove, emotional male vocals" },
  axe: { nome: "Axé", style: "axé music, Bahia carnival, percussion, trio elétrico, high energy, chant chorus" },
  rap: { nome: "Rap", style: "rap nacional brasileiro, boom bap beat, spoken verses, strong hook" },
  pop: { nome: "Pop", style: "Brazilian pop, radio hit, bright synths, catchy chorus, modern production" },
  natal: { nome: "Natalina", style: "Christmas song, sleigh bells, warm, festive, Brazilian family celebration" },
  brega: { nome: "Brega", style: "brega romântico, 80s Brazilian ballad, dramatic vocals, synth strings" },
  samba: { nome: "Samba", style: "samba de raiz, surdo, cuíca, cavaquinho, carnival, Brazilian" },
  eletronica: { nome: "Eletrônica", style: "electronic dance, EDM drop, festival, energetic, Brazilian pop vocals" },
  reggae: { nome: "Reggae", style: "reggae, offbeat guitar, laid back, Brazilian reggae vibes" }
};

const PLANOS = {
  musica: { nome: "Música", preco: () => config.prices.musica, de: () => config.prices.de.musica, clipe: false, cupom: true },
  clipe: { nome: "Música + clipe", preco: () => config.prices.clipe, de: () => config.prices.de.clipe, clipe: true, cupom: true },
  studio: { nome: "Studio (mensal)", preco: () => config.prices.studio, de: () => config.prices.de.studio, clipe: true, mensal: true, cupom: false }
};
const BUMPS = {
  versoes: { nome: "+2 versões da música", preco: () => config.prices.bumps.versoes },
  urgente: { nome: "Entrega em até 1 hora no WhatsApp", preco: () => config.prices.bumps.urgente },
  clipe: { nome: "Clipe automático com suas fotos", preco: () => config.prices.bumps.clipe }
};

// Configuração pública (mesma no /api/config e no window.__CFG injetado no index.html)
function publicConfig() {
  return {
    brand: config.brand, support: config.supportWhatsapp, mock: config.mock, freePreviews: config.freePreviews,
    ritmos: Object.entries(RITMOS).map(([k, v]) => ({ id: k, nome: v.nome })),
    planos: Object.entries(PLANOS).map(([k, v]) => ({ id: k, nome: v.nome, preco: v.preco(), de: v.de() > v.preco() ? v.de() : 0, clipe: v.clipe, mensal: !!v.mensal, cupom: !!v.cupom })),
    bumps: Object.entries(BUMPS).map(([k, v]) => ({ id: k, nome: v.nome, preco: v.preco() })),
    cupom: { pct: config.cupom.pct, instagram: config.instagram.handle }
  };
}

const brl = (cents) => "R$ " + (cents / 100).toFixed(2).replace(".", ",");

module.exports = { id, slugify, onlyDigits, normalizeWhatsapp, sign, verify, cookie, readCookie, RITMOS, PLANOS, BUMPS, brl, publicConfig };
