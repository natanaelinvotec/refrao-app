"use strict";
const { Router } = require("../lib/http");
const crypto = require("crypto");
const config = require("../config");
const { row, rows, run, now, event } = require("../db");
const { sign, verify, cookie, readCookie, RITMOS, normalizeWhatsapp } = require("../util");
const songs = require("../services/songs");
const cupons = require("../services/cupons");
const wa = require("../services/whatsapp");

const r = new Router();
const bad = (res, code, msg) => res.status(code).json({ error: msg });

r.post("/login", (req, res) => {
  const h = (s) => crypto.createHmac("sha256", config.secret).update(String(s)).digest(); // tamanho fixo: sem vazar o comprimento
  if (!crypto.timingSafeEqual(h(req.body?.password || ""), h(config.adminPassword))) return bad(res, 401, "senha incorreta");
  cookie(res, "rf_admin", sign({ admin: true }, 12 * 3600), 12 * 3600);
  res.json({ ok: true });
});
r.use((req, res, next) => { const t = verify(readCookie(req, "rf_admin")); if (!t?.admin) return bad(res, 401, "faça login como admin"); next(); });

r.get("/stats", (req, res) => {
  const range = req.query.range === "30d" ? 30 : req.query.range === "7d" ? 7 : 1;
  const since = now() - range * 86400000;
  const c = (type) => row("SELECT COUNT(*) c FROM events WHERE type = ? AND created_at > ?", type, since).c;
  const paid = row("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE status = 'PAID' AND paid_at > ?", since);
  const gen = c("song.created"), previews = c("song.preview_ready"), checkout = c("checkout"), clips = c("clip.done"), leads = c("lead");
  const custoGeracao = 0.07 * 5.6; // US$ 0,07 × câmbio aproximado → R$ (ajuste em config se quiser)
  res.json({
    range, gerados: gen, previas: previews, checkouts: checkout, vendas: paid.c, receita: paid.s, leads, clipes: clips,
    conversao: previews ? +(paid.c / previews * 100).toFixed(1) : 0,
    custoIaPorVenda: paid.c ? +((gen * custoGeracao + gen * 0.02) / paid.c).toFixed(2) : 0,
    geracoesPorVenda: paid.c ? +(gen / paid.c).toFixed(1) : 0,
    funil: [["criadas", gen], ["prévia pronta", previews], ["lead (WhatsApp)", leads], ["abriu checkout", checkout], ["pagou", paid.c], ["clipe entregue", clips]],
    fila: rows("SELECT id, nome, ritmo, status, provider_task_id, created_at, updated_at, paid, error FROM songs ORDER BY created_at DESC LIMIT 12"),
    pendentesMural: row("SELECT COUNT(*) c FROM songs WHERE public_status = 'pending'").c,
    clipesFila: row("SELECT COUNT(*) c FROM clips WHERE status IN ('QUEUED','RENDERING')").c,
    provedores: { suno: config.suno.mock ? "mock" : config.suno.baseUrl, letra: config.lyrics.mock ? "mock" : (config.lyrics.gemini ? "gemini" : "openai"), pix: config.pix.mock ? "mock" : "mercadopago", whatsapp: config.whatsapp.mock ? "mock" : "evolution" }
  });
});
r.get("/songs", (req, res) => {
  const q = String(req.query.q || "").trim();
  const list = q ? rows("SELECT * FROM songs WHERE nome LIKE ? OR whatsapp LIKE ? OR id LIKE ? ORDER BY created_at DESC LIMIT 100", `%${q}%`, `%${q}%`, `${q}%`) : rows("SELECT * FROM songs ORDER BY created_at DESC LIMIT 100");
  res.json(list.map((s) => ({ ...s, tracks: JSON.parse(s.tracks || "[]").filter(Boolean).length, ritmoNome: (RITMOS[s.ritmo] || {}).nome })));
});
r.get("/orders", (req, res) => res.json(rows("SELECT o.*, s.nome FROM orders o JOIN songs s ON s.id = o.song_id ORDER BY o.created_at DESC LIMIT 100")));
// cupons "siga e ganhe": lista e geração manual (ex.: a pessoa mandou print seguindo pelo WhatsApp)
r.get("/cupons", (req, res) => res.json(cupons.listar()));
r.post("/cupons", async (req, res) => {
  const b = req.body || {};
  const pct = Math.min(90, Math.max(1, Number(b.pct) || config.cupom.pct));
  const whatsapp = normalizeWhatsapp(b.whatsapp || "");
  const handle = (b.handle || "").replace(/^@/, "").trim() || whatsapp;
  const c = cupons.gerar({ source: whatsapp ? "whatsapp" : "admin", handle, pct, maxUses: Math.max(1, Number(b.maxUses) || 1) });
  let enviado = false;
  if (whatsapp && b.enviar) {
    const r2 = await wa.sendText(whatsapp, `Seu cupom de ${c.pct}% chegou: *${c.code}* 🎶\nCole no checkout em ${config.baseUrl} (vale pra Música e Música + clipe, 1 uso).`);
    enviado = !!r2;
  }
  event("cupom_admin", null, { code: c.code, handle, pct });
  res.json({ ...c, enviado });
});
r.get("/mural", (req, res) => res.json(rows("SELECT id, slug, nome, titulo, ritmo, whatsapp, public_status, plays, created_at FROM songs WHERE public_status IN ('pending','approved') ORDER BY created_at DESC")));
r.post("/songs/:id/mural", (req, res) => { run("UPDATE songs SET public_status = ?, updated_at = ? WHERE id = ?", req.body?.approve ? "approved" : "private", now(), req.params.id); res.json({ ok: true }); });
r.post("/songs/:id/unlock", async (req, res) => {
  // libera manualmente (ex.: pagamento confirmado fora do gateway)
  const s = songs.getSong(req.params.id); if (!s) return bad(res, 404, "não encontrada");
  await songs.onPaid({ id: "manual", song_id: s.id, whatsapp: s.whatsapp || "", plan: req.body?.plan || "clipe", bumps: "[]", total: 0 });
  event("order.paid.manual", s.id); res.json({ ok: true });
});
r.post("/songs/:id/retry", async (req, res) => {
  const s = songs.getSong(req.params.id); if (!s) return bad(res, 404, "não encontrada");
  const n = await songs.create({ nicho: s.nicho, nome: s.nome, numero: s.numero, perfil: s.perfil, recado: s.recado, ritmo: s.ritmo, voz: s.voz, letra: s.letra, titulo: s.titulo, whatsapp: s.whatsapp, deviceId: s.device_id, ip: s.ip });
  if (s.paid) run("UPDATE songs SET paid = 1, plan = ?, has_clip = ? WHERE id = ?", s.plan, s.has_clip, n.id);
  res.json({ ok: true, songId: n.id });
});
r.post("/clips/:id/retry", (req, res) => { run("UPDATE clips SET status = 'QUEUED', error = NULL, updated_at = ? WHERE id = ?", now(), req.params.id); res.json({ ok: true }); });

module.exports = r;
