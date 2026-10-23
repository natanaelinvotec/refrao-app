"use strict";
const fs = require("fs");
const path = require("path");
const { Router, multipart } = require("../lib/http");
const config = require("../config");
const { row, rows, run, event, now, parseSong } = require("../db");
const { id, normalizeWhatsapp, sign, verify, cookie, readCookie, RITMOS, PLANOS, BUMPS, publicConfig } = require("../util");
const lyrics = require("../services/lyrics");
const songs = require("../services/songs");
const pix = require("../services/pix");
const wa = require("../services/whatsapp");
const media = require("../services/media");
const cupons = require("../services/cupons");
const instagram = require("../services/instagram");

const r = new Router();
const DIR = (d) => path.join(config.dataDir, d);
const bad = (res, code, msg, extra = {}) => res.status(code).json({ error: msg, ...extra });
const ip = (req) => req.ip;

// ---------- sessão (OTP) e propriedade da música ----------
function session(req) { return verify(readCookie(req, "rf_sess")) || verify(req.headers.authorization?.replace(/^Bearer /, "")); }
// Quem criou a música recebe uma chave (X-Song-Key) guardada no aparelho; quem logou com o mesmo WhatsApp também é dono.
function owns(req, song) {
  const k = verify(req.headers["x-song-key"] || req.query.k || "");
  if (k && k.own === song.id) return true;
  const s = session(req);
  return !!(s && s.wa && song.whatsapp && s.wa === song.whatsapp);
}
function canDownload(req, song) {
  if (!song.paid) return false;
  const t = verify(req.query.t || "");
  if (t && t.dl === song.id) return true;
  return owns(req, song);
}
const genericError = (e) => (e && /^(suno|mercadopago|download|evolution)/i.test(e) ? "o estúdio não respondeu; tente criar de novo" : e);

// memo curto para rotas de catálogo (landing)
const memo = new Map();
const cached = (k, ttl, fn) => { const c = memo.get(k); if (c && c.t > now()) return c.v; const v = fn(); memo.set(k, { v, t: now() + ttl }); return v; };

// ---------- catálogo ----------
r.get("/config", (req, res) => res.json(publicConfig()));

// amostra de ritmo (arquivo estático em public/samples/<ritmo>.mp3; 404 → o front usa o sintetizador)
r.get("/samples/:ritmo", (req, res) => {
  const f = path.join(config.publicDir, "samples", path.basename(req.params.ritmo) + ".mp3");
  if (!fs.existsSync(f)) return bad(res, 404, "sem amostra");
  res.sendFile(f, { cacheControl: "public, max-age=604800" });
});

// ---------- letra ----------
r.post("/lyrics", async (req, res) => {
  const p = req.body || {};
  if (!p.nome || !p.nicho || !p.ritmo || !p.recado) return bad(res, 400, "nome, nicho, ritmo e recado são obrigatórios");
  if (String(p.recado).length > 500) return bad(res, 400, "recado com mais de 500 caracteres");
  try { res.json(await lyrics.generate({ ...p, nome: String(p.nome).slice(0, 40) })); }
  catch (e) { bad(res, 500, "não deu pra escrever a letra agora"); }
});

// ---------- criar música ----------
r.post("/songs", async (req, res) => {
  const p = req.body || {};
  if (!p.nome || !p.nicho || !p.ritmo || !p.letra) return bad(res, 400, "dados incompletos");
  if (!RITMOS[p.ritmo]) return bad(res, 400, "ritmo inválido");
  if (String(p.letra).length > 3000) return bad(res, 400, "letra muito longa");
  const whatsapp = normalizeWhatsapp(p.whatsapp);
  const s = session(req);
  const user = s?.wa ? row("SELECT * FROM users WHERE whatsapp = ?", s.wa) : null;
  // limite de prévias grátis (créditos do Studio/indicação liberam)
  if (!(user && user.credits > 0)) {
    const { count, last } = songs.unpaidCount({ whatsapp: whatsapp || s?.wa, deviceId: p.deviceId, ip: ip(req) });
    if (count >= config.freePreviews) return bad(res, 402, `Você já gerou ${count} música${count > 1 ? "s" : ""} sem liberar. Pague a anterior pra criar outra — o pagamento libera as duas.`, { code: "PREVIEW_LIMIT", lastSongId: last });
  }
  const song = await songs.create({ ...p, whatsapp: whatsapp || s?.wa || null, userId: user?.id, ip: ip(req), deviceId: String(p.deviceId || "").slice(0, 64) });
  if (user && user.credits > 0) { run("UPDATE users SET credits = credits - 1 WHERE id = ?", user.id); run("UPDATE songs SET paid = 1, plan = 'studio', has_clip = 1 WHERE id = ?", song.id); }
  if (song.status === "FAILED") return bad(res, 500, "Não deu pra criar a música agora. Tente de novo.");
  res.json({ songId: song.id, key: sign({ own: song.id }, 365 * 86400) });
});

function publicView(song, req) {
  const unlocked = canDownload(req, song);
  return {
    id: song.id, nome: song.nome, titulo: song.titulo, ritmo: song.ritmo, ritmoNome: (RITMOS[song.ritmo] || {}).nome, nicho: song.nicho, letra: song.letra,
    status: song.status, error: genericError(song.error), paid: !!song.paid, owner: owns(req, song), plan: song.plan, hasClip: !!song.has_clip, unlocked, slug: song.slug, publicStatus: song.public_status,
    ready: song.tracks.some((t) => t && t.file),
    tracks: song.tracks.map((t, i) => (t && t.file ? { index: i, duration: t.duration, previewUrl: `/api/songs/${song.id}/preview?track=${i}`, downloadUrl: unlocked ? `/api/songs/${song.id}/download?track=${i}${req.query.t ? "&t=" + req.query.t : ""}` : null } : null)),
    createdAt: song.created_at
  };
}

r.get("/songs/:id", (req, res) => {
  const song = songs.getSong(req.params.id);
  if (!song) return bad(res, 404, "música não encontrada");
  const clip = row("SELECT * FROM clips WHERE song_id = ? ORDER BY created_at DESC LIMIT 1", song.id);
  res.json({ ...publicView(song, req), clip: clip ? { id: clip.id, status: clip.status, photos: JSON.parse(clip.photos || "[]").length, url: clip.status === "DONE" && canDownload(req, song) ? `/api/songs/${song.id}/clip${req.query.t ? "?t=" + req.query.t : ""}` : null } : null });
});

r.get("/songs/:id/preview", (req, res) => {
  const song = songs.getSong(req.params.id);
  const t = song?.tracks[Number(req.query.track) || 0];
  if (!t?.preview) return bad(res, 404, "A faixa ainda não está pronta.");
  const rg = req.headers.range; // conta o play só no 1º pedido; seeks não tocam o banco
  if (req.method === "GET" && (!rg || /^bytes=0-/.test(rg)) && !row("SELECT 1 FROM events WHERE song_id = ? AND type = 'preview.play' AND created_at > ?", song.id, now() - 60000)) event("preview.play", song.id);
  res.sendFile(path.join(DIR("previews"), t.preview), { cacheControl: "private, max-age=31536000, immutable" });
});

r.get("/songs/:id/download", (req, res) => {
  const song = songs.getSong(req.params.id);
  if (!song) return bad(res, 404, "música não encontrada");
  if (!canDownload(req, song)) return bad(res, 403, "Finalize a compra pra liberar o download da música completa.");
  const i = Number(req.query.track) || 0, t = song.tracks[i];
  if (!t?.file) return bad(res, 404, "faixa não disponível");
  event("download", song.id, { track: i });
  res.download(path.join(DIR("tracks"), t.file), `${song.slug}-v${i + 1}.mp3`);
});

// ---------- fotos e clipe ----------
const upload = multipart({ destDir: DIR("photos"), maxFiles: 8, name: (req, f) => `${path.basename(req.params.id)}-${id(4)}${f.ext}` });
const mustOwn = (req, res, next) => {
  const song = songs.getSong(req.params.id);
  if (!song) return bad(res, 404, "música não encontrada");
  if (!owns(req, song)) return bad(res, 403, "essa música não está neste aparelho: entre com o seu WhatsApp em 'minhas músicas' pra editar", { code: "NOT_OWNER" });
  req.song = song; next();
};
r.post("/songs/:id/photos", mustOwn, upload, (req, res) => {
  const song = req.song;
  let clip = row("SELECT * FROM clips WHERE song_id = ? ORDER BY created_at DESC LIMIT 1", song.id);
  const photos = (clip ? JSON.parse(clip.photos || "[]") : []).concat((req.files || []).map((f) => f.filename)).slice(0, 8);
  const trackIndex = Number(req.body?.track) || 0;
  const status = photos.length ? (song.paid && song.has_clip ? "QUEUED" : "WAITING") : "WAITING";
  if (clip) run("UPDATE clips SET photos = ?, track_index = ?, status = ?, updated_at = ? WHERE id = ?", JSON.stringify(photos), trackIndex, status, now(), clip.id);
  else run("INSERT INTO clips (id, song_id, track_index, photos, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", id(8), song.id, trackIndex, JSON.stringify(photos), status, now(), now());
  event("photos.added", song.id, { count: photos.length });
  res.json({ photos: photos.length, status });
});
r.post("/songs/:id/clip", mustOwn, (req, res) => {
  // escolhe a versão do clipe e (se pago) enfileira a renderização
  const song = req.song;
  const clip = row("SELECT * FROM clips WHERE song_id = ? ORDER BY created_at DESC LIMIT 1", song.id);
  if (!clip) return bad(res, 404, "suba as fotos primeiro");
  if (!JSON.parse(clip.photos || "[]").length) return bad(res, 400, "nenhuma foto");
  const status = song.paid && song.has_clip ? "QUEUED" : "WAITING";
  run("UPDATE clips SET track_index = ?, status = ?, updated_at = ? WHERE id = ?", Number(req.body?.track) || 0, status, now(), clip.id);
  res.json({ status });
});
r.get("/songs/:id/clip", (req, res) => {
  const song = songs.getSong(req.params.id);
  if (!song) return bad(res, 404, "música não encontrada");
  if (!canDownload(req, song) || !song.has_clip) return bad(res, 403, "O clipe faz parte do plano Música + clipe.");
  const clip = row("SELECT * FROM clips WHERE song_id = ? AND status = 'DONE' ORDER BY updated_at DESC LIMIT 1", song.id);
  if (!clip) return bad(res, 404, "clipe ainda não está pronto");
  event("download.clip", song.id);
  res.download(path.join(DIR("clips"), clip.file), `${song.slug}-clipe.mp4`);
});

// ---------- guardar prévia / lead ----------
r.post("/songs/:id/whatsapp", mustOwn, async (req, res) => {
  const song = req.song;
  const w = normalizeWhatsapp(req.body?.whatsapp);
  if (!w) return bad(res, 400, "WhatsApp inválido");
  if (song.whatsapp && song.whatsapp !== w && !session(req)) return bad(res, 403, "essa música já tem um WhatsApp; entre com ele pra trocar");
  run("UPDATE songs SET whatsapp = ?, updated_at = ? WHERE id = ?", w, now(), song.id);
  event("lead", song.id, { whatsapp: w });
  await wa.sendText(w, `Guardei a música de *${song.nome}* pra você 🎵\nOuvir quando quiser: ${config.baseUrl}/#/previa/${song.id}`);
  res.json({ ok: true });
});

// ---------- checkout PIX ----------
// Total em centavos. O cupom desconta só o plano; os extras ficam inteiros. Retorna null se algo for inválido.
function priceOf(plan, bumps, pct = 0) {
  const p = PLANOS[plan]; if (!p) return null;
  const base = p.preco();
  let total = pct ? cupons.aplicar(base, pct) : base;
  for (const b of bumps) { if (!BUMPS[b]) return null; if (b === "clipe" && p.clipe) continue; total += BUMPS[b].preco(); }
  return { total, desconto: base - (pct ? cupons.aplicar(base, pct) : base) };
}
// confere um cupom antes de gerar o PIX (o front mostra o total com desconto)
r.post("/cupom", (req, res) => {
  const v = cupons.validar(req.body?.code, req.body?.plan);
  if (!v.ok) return bad(res, 400, v.erro);
  res.json(v);
});
r.post("/checkout", async (req, res) => {
  const p = req.body || {};
  const song = songs.getSong(p.songId);
  if (!song) return bad(res, 404, "música não encontrada");
  const whatsapp = normalizeWhatsapp(p.whatsapp);
  if (!whatsapp) return bad(res, 400, "coloque seu WhatsApp com DDD");
  const bumps = Array.isArray(p.bumps) ? p.bumps.filter((b) => BUMPS[b]) : [];
  let cupom = null, pct = 0;
  if (p.cupom) { const v = cupons.validar(p.cupom, p.plan); if (!v.ok) return bad(res, 400, v.erro); cupom = v.code; pct = v.pct; }
  const preco = priceOf(p.plan, bumps, pct);
  if (preco === null) return bad(res, 400, "plano inválido");
  const { total, desconto } = preco;
  const orderId = id(8);
  let charge;
  try { charge = await pix.createCharge({ orderId, amount: total, description: `${config.brand} · ${PLANOS[p.plan].nome} · ${song.nome}`, customer: { phone: whatsapp, email: p.email || "", name: p.nome || song.nome } }); }
  catch (e) { console.error("[pix]", e.message); return bad(res, 502, "o PIX não respondeu agora, tente de novo"); }
  run("INSERT INTO orders (id, song_id, whatsapp, email, plan, bumps, total, provider, provider_id, pix_code, pix_qr_url, status, expires_at, created_at, cupom, desconto) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    orderId, song.id, whatsapp, p.email || null, p.plan, JSON.stringify(bumps), total, config.pix.mock ? "mock" : "mercadopago", charge.providerId, charge.pixCode, charge.qrUrl, "PENDING", charge.expiresAt, now(), cupom, desconto);
  run("UPDATE songs SET whatsapp = COALESCE(whatsapp, ?), updated_at = ? WHERE id = ?", whatsapp, now(), song.id);
  event("checkout", song.id, { orderId, plan: p.plan, bumps, total, cupom, desconto });
  res.json({ orderId, total, desconto, pixCode: charge.pixCode, qrUrl: charge.qrUrl, qrBase64: charge.qrBase64 || "", expiresAt: charge.expiresAt, mock: config.pix.mock });
});
r.get("/orders/:id", async (req, res) => {
  let o = row("SELECT * FROM orders WHERE id = ?", req.params.id);
  if (!o) return bad(res, 404, "pedido não encontrado");
  // rede de segurança: se o webhook atrasar, consulta o provedor a cada ~15 s enquanto o cliente espera
  if (o.status === "PENDING" && !config.pix.mock && o.provider_id && (!o.checked_at || now() - o.checked_at > 15000)) {
    try { run("UPDATE orders SET checked_at = ? WHERE id = ?", now(), o.id); const p = await pix.fetchPayment(o.provider_id); if (p.paid) { await markPaid(o); o = row("SELECT * FROM orders WHERE id = ?", o.id); } } catch (e) { /* tenta no próximo */ }
  }
  const out = { id: o.id, songId: o.song_id, status: o.status, total: o.total, plan: o.plan, expiresAt: o.expires_at };
  // o token de download só sai para quem é dono (chave do aparelho ou sessão); os outros recebem o link pelo WhatsApp
  if (o.status === "PAID") { const song = songs.getSong(o.song_id); if (song && owns(req, song)) out.token = sign({ dl: o.song_id }, 365 * 86400); }
  res.json(out);
});
async function markPaid(order) {
  if (order.status === "PAID") return;
  run("UPDATE orders SET status = 'PAID', paid_at = ? WHERE id = ?", now(), order.id);
  if (order.cupom) cupons.consumir(order.cupom, order.id);
  await songs.onPaid({ ...order, status: "PAID" });
}
// webhook do Mercado Pago: nunca confia no corpo — confirma o pagamento no provedor
r.post("/webhooks/pix", async (req, res) => {
  if (config.pix.mock) return res.json({ ok: true, mock: true });
  try {
    const p = await pix.confirmFromWebhook(req);
    if (p && p.paid && p.orderId) { const order = row("SELECT * FROM orders WHERE id = ?", p.orderId); if (order) await markPaid(order); }
    res.json({ ok: true });
  } catch (e) { bad(res, e.status || 500, e.status ? e.message : "erro ao confirmar"); }
});
// ---------- Instagram: "siga e ganhe" (direct → cupom) ----------
// A Meta valida a URL com GET (hub.challenge) e depois manda as mensagens por POST.
r.get("/webhooks/instagram", (req, res) => {
  const q = req.query || {};
  if (q["hub.mode"] === "subscribe" && config.instagram.verifyToken && q["hub.verify_token"] === config.instagram.verifyToken) { res.setHeader("Content-Type", "text/plain"); return res.send(String(q["hub.challenge"] || "")); }
  bad(res, 403, "token de verificação inválido");
});
r.post("/webhooks/instagram", async (req, res) => {
  if (!instagram.assinaturaOk(req)) return bad(res, 401, "assinatura inválida");
  res.json({ ok: true }); // responde já: a Meta reenvia se demorar
  try { const n = await instagram.tratar(req.body); if (n) event("ig_cupom", null, { respondidas: n }); } catch (e) { console.error("[instagram]", e.message); }
});
// ---------- WhatsApp (Evolution, evento MESSAGES_UPSERT): quem pede "cupom" recebe o passo a passo ----------
// Pelo WhatsApp não dá pra conferir se a pessoa segue; o bot orienta a mandar "CUPOM" no direct do Instagram.
// Se a pessoa mandar um print, o admin libera o cupom no painel (aba Cupons) e ele chega aqui mesmo.
r.post("/webhooks/whatsapp", async (req, res) => {
  const tok = req.query?.token || req.headers["apikey"] || "";
  if (!config.whatsappWebhookSecret || tok !== config.whatsappWebhookSecret) return bad(res, 401, "token inválido");
  res.json({ ok: true });
  const b = req.body || {};
  if (!/messages\.upsert/i.test(b.event || "")) return;
  const d = b.data || {};
  const key = d.key || {};
  if (key.fromMe || !key.remoteJid || /@g\.us$/.test(key.remoteJid)) return;
  const m = d.message || {};
  const t = m.conversation || m.extendedTextMessage?.text || "";
  if (!/\b(cupom|cupon|desconto|instagram|insta)\b/i.test(t)) return;
  if (key.id && row("SELECT id FROM inbox_seen WHERE id = ?", key.id)) return;
  if (key.id) run("INSERT INTO inbox_seen (id, created_at) VALUES (?,?)", key.id, now());
  const numero = key.remoteJid.replace(/@.*$/, "");
  const h = config.instagram.handle;
  await wa.sendText(numero, `Quer ${config.cupom.pct}% de desconto na sua música? 🎶\n1) Siga @${h} no Instagram: https://instagram.com/${h}\n2) Mande "CUPOM" no direct da página\n3) O código chega na hora — é só colar no checkout em ${config.baseUrl}\n\nSe preferir, manda aqui um print seguindo a página que a gente libera o cupom por aqui.`);
  event("wa_cupom", null, { numero });
});
// callback do provedor de música (opcional; o worker também faz polling)
r.post("/webhooks/suno", (req, res) => { res.json({ ok: true }); setTimeout(() => songs.tick(), 500); });
// simulação de pagamento (só em mock)
r.post("/dev/pay/:orderId", async (req, res) => {
  if (!config.pix.mock) return bad(res, 404, "não disponível");
  const order = row("SELECT * FROM orders WHERE id = ?", req.params.orderId);
  if (!order) return bad(res, 404, "pedido não encontrado");
  await markPaid(order);
  res.json({ ok: true });
});

// ---------- página pública / mural ----------
r.get("/public/:slug", (req, res) => {
  const song = parseSong(row("SELECT * FROM songs WHERE slug = ?", req.params.slug));
  if (!song || !song.tracks.some((t) => t && t.file)) return bad(res, 404, "música não encontrada");
  res.json({ slug: song.slug, nome: song.nome, titulo: song.titulo, ritmo: song.ritmo, ritmoNome: (RITMOS[song.ritmo] || {}).nome, letra: song.letra, plays: song.plays, previewUrl: `/api/songs/${song.id}/preview?track=0`, createdAt: song.created_at });
});
r.post("/public/:slug/play", (req, res) => { run("UPDATE songs SET plays = plays + 1 WHERE slug = ?", req.params.slug); res.json({ ok: true }); });
r.post("/songs/:id/publish", mustOwn, (req, res) => {
  if (!req.body?.consent) return bad(res, 400, "precisa do consentimento");
  run("UPDATE songs SET public_status = 'pending', updated_at = ? WHERE id = ?", now(), req.song.id);
  res.json({ ok: true, status: "pending" });
});
r.get("/mural", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json(cached("mural", 30000, () => rows("SELECT id, slug, nome, titulo, ritmo, plays FROM songs WHERE public_status = 'approved' ORDER BY plays DESC, created_at DESC LIMIT 12").map((s) => ({ ...s, ritmoNome: (RITMOS[s.ritmo] || {}).nome, previewUrl: `/api/songs/${s.id}/preview?track=0` }))));
});
r.get("/stats", (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json(cached("stats", 30000, () => ({ musicas: row("SELECT COUNT(*) c FROM songs WHERE status IN ('FIRST_SUCCESS','SUCCESS')").c })));
});

// ---------- login por código no WhatsApp ----------
r.post("/auth/otp", async (req, res) => {
  const w = normalizeWhatsapp(req.body?.whatsapp);
  if (!w) return bad(res, 400, "WhatsApp inválido");
  const prev = row("SELECT * FROM otps WHERE whatsapp = ?", w);
  if (prev && prev.expires_at - 9 * 60000 > now()) return bad(res, 429, "já mandamos um código; espere 1 minuto pra pedir outro");
  const code = String(Math.floor(100000 + Math.random() * 900000));
  run("INSERT INTO otps (whatsapp, code, expires_at, tries) VALUES (?,?,?,?) ON CONFLICT(whatsapp) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, tries = excluded.tries", w, code, now() + 10 * 60000, prev && prev.expires_at > now() ? prev.tries : 0);
  await wa.sendText(w, `Seu código de acesso ao ${config.brand}: *${code}* (vale 10 minutos)`);
  res.json({ ok: true, mock: config.whatsapp.mock, code: config.whatsapp.mock ? code : undefined });
});
r.post("/auth/verify", (req, res) => {
  const w = normalizeWhatsapp(req.body?.whatsapp);
  const o = row("SELECT * FROM otps WHERE whatsapp = ?", w);
  if (!o || o.expires_at < now() || o.tries >= 5) return bad(res, 400, "código expirado, peça outro");
  if (String(req.body?.code) !== o.code) { run("UPDATE otps SET tries = tries + 1 WHERE whatsapp = ?", w); return bad(res, 400, "código errado"); }
  run("DELETE FROM otps WHERE whatsapp = ?", w);
  let u = row("SELECT * FROM users WHERE whatsapp = ?", w);
  if (!u) { run("INSERT INTO users (id, whatsapp, ref_code, created_at) VALUES (?,?,?,?)", id(8), w, id(4), now()); u = row("SELECT * FROM users WHERE whatsapp = ?", w); }
  run("UPDATE songs SET user_id = ? WHERE whatsapp = ? AND user_id IS NULL", u.id, w);
  const token = sign({ wa: w, uid: u.id }, 90 * 86400);
  cookie(res, "rf_sess", token, 90 * 86400);
  res.json({ ok: true, token });
});
r.post("/auth/logout", (req, res) => { cookie(res, "rf_sess", "", 0); res.json({ ok: true }); });
r.get("/me", (req, res) => {
  const s = session(req);
  if (!s) return bad(res, 401, "faça login");
  const u = row("SELECT * FROM users WHERE id = ?", s.uid);
  if (!u) return bad(res, 401, "faça login");
  const list = rows("SELECT * FROM songs WHERE whatsapp = ? OR user_id = ? ORDER BY created_at DESC", u.whatsapp, u.id).map((x) => publicView(parseSong(x), req));
  const indic = row("SELECT COUNT(*) c FROM users WHERE referred_by = ?", u.ref_code).c;
  res.json({ whatsapp: u.whatsapp, plan: u.plan, planRenewsAt: u.plan_renews_at, credits: u.credits, refCode: u.ref_code, referrals: indic, songs: list });
});

module.exports = r;
