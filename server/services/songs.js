"use strict";
// Ciclo de vida de uma música: criação → polling do provedor → download das faixas →
// prévia com marca d'água → aviso no WhatsApp → (pago) clipe e entrega → recuperação de carrinho.
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { db, row, rows, run, event, now, parseSong } = require("../db");
const { id, slugify, RITMOS, brl } = require("../util");
const suno = require("./suno");
const media = require("./media");
const wa = require("./whatsapp");

const DIR = (d) => path.join(config.dataDir, d);
const ACTIVE = ["QUEUED", "PENDING", "TEXT_SUCCESS", "FIRST_SUCCESS"];

function getSong(songId) { return parseSong(row("SELECT * FROM songs WHERE id = ?", songId)); }
function saveTracks(songId, tracks, status, extra = {}) {
  run("UPDATE songs SET tracks = ?, status = ?, error = ?, updated_at = ? WHERE id = ?", JSON.stringify(tracks), status, extra.error || null, now(), songId);
}

/** Quantas músicas não pagas esta pessoa/dispositivo já gerou (limite de prévias grátis). */
function unpaidCount({ whatsapp, deviceId, ip }) {
  // o IP real entra SEMPRE: deviceId vem do cliente e sozinho seria burlável
  const conds = [], params = [];
  if (whatsapp) { conds.push("whatsapp = ?"); params.push(whatsapp); }
  if (deviceId) { conds.push("device_id = ?"); params.push(deviceId); }
  if (ip) { conds.push("(ip = ? AND created_at > ?)"); params.push(ip, now() - 86400000); }
  if (!conds.length) return { count: 0, last: null };
  const list = rows(`SELECT id FROM songs WHERE paid = 0 AND status != 'FAILED' AND (${conds.join(" OR ")}) ORDER BY created_at DESC`, ...params);
  return { count: list.length, last: list[0]?.id || null };
}

/** Cria a música e dispara a task no provedor. */
async function create(p) {
  const songId = id(16);
  const ritmo = RITMOS[p.ritmo] || RITMOS.pop;
  const titulo = (p.titulo || `${p.nome}, com carinho`).slice(0, 80);
  const slug = slugify(p.nome) + "-" + songId.slice(0, 6);
  run(`INSERT INTO songs (id, user_id, whatsapp, device_id, ip, nicho, nome, numero, perfil, recado, ritmo, voz, letra, titulo, style, status, slug, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    songId, p.userId || null, p.whatsapp || null, p.deviceId || null, p.ip || null, p.nicho, p.nome, p.numero || null, p.perfil || null, p.recado || null, p.ritmo, p.voz || "fem", p.letra, titulo, ritmo.style, "QUEUED", slug, now(), now());
  event("song.created", songId, { nicho: p.nicho, ritmo: p.ritmo });
  try {
    const { taskId } = await suno.create({ letra: p.letra, style: ritmo.style, titulo, voz: p.voz });
    run("UPDATE songs SET provider_task_id = ?, status = 'PENDING', updated_at = ? WHERE id = ?", taskId, now(), songId);
  } catch (e) {
    run("UPDATE songs SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?", e.message, now(), songId);
    event("song.failed", songId, { error: e.message });
  }
  return getSong(songId);
}

/** Baixa a faixa do provedor (ou copia, no mock) e gera a prévia com marca d'água. */
async function materialize(song, track, index) {
  const file = path.join(DIR("tracks"), `${song.id}-${index}.mp3`);
  const preview = path.join(DIR("previews"), `${song.id}-${index}.mp3`);
  if (!fs.existsSync(file)) {
    const url = track.audioUrl || track.streamUrl;
    if (url.startsWith("file://")) fs.copyFileSync(url.slice(7), file); else await suno.download(url, file);
  }
  if (!fs.existsSync(preview)) await media.watermark(file, preview);
  const dur = track.duration || (await media.duration(file));
  return { ...track, file: path.basename(file), preview: path.basename(preview), duration: Math.round(dur) };
}

/** Um passo de polling para uma música ativa. */
async function poll(song) {
  if (!song.provider_task_id) return;
  let st;
  try { st = await suno.status(song.provider_task_id); }
  catch (e) { console.error("[poll]", song.id, e.message); return; }
  if (st.status === "FAILED") {
    saveTracks(song.id, song.tracks, "FAILED", { error: st.error || "falha na geração" });
    event("song.failed", song.id, { error: st.error });
    return;
  }
  // materializa faixas novas em paralelo e grava a 1ª assim que fica pronta (`ready` mais cedo)
  const tracks = [...song.tracks];
  let notified = tracks.some((t) => t && t.file);
  await Promise.all(st.tracks.map((t, i) => {
    if (tracks[i]?.file || !(t.audioUrl || t.streamUrl)) return null;
    return materialize(song, t, i).then(async (m) => {
      tracks[i] = m; saveTracks(song.id, tracks, st.status);
      if (!notified) { notified = true; await onPreviewReady(getSong(song.id)); }
    }).catch((e) => console.error("[materialize]", song.id, i, e.message));
  }));
  saveTracks(song.id, tracks, st.status);
  if (st.status === "SUCCESS") event("song.success", song.id, { tracks: tracks.length });
}

async function onPreviewReady(song) {
  event("song.preview_ready", song.id);
  if (song.whatsapp) {
    const link = `${config.baseUrl}/#/previa/${song.id}`;
    await wa.sendText(song.whatsapp, `🎵 A música de *${song.nome}* ficou pronta!\nOuça a prévia e escolha a versão: ${link}\n\nPra baixar sem marca d'água é só liberar no PIX a partir de ${brl(config.prices.musica)}.`);
  }
}

/** Depois do pagamento: libera, entrega no WhatsApp e renderiza o clipe se fizer parte do plano. */
async function onPaid(order) {
  const song = getSong(order.song_id);
  if (!song) return;
  const bumps = JSON.parse(order.bumps || "[]");
  const hasClip = order.plan === "clipe" || order.plan === "studio" || bumps.includes("clipe");
  run("UPDATE songs SET paid = 1, plan = ?, has_clip = ?, updated_at = ? WHERE id = ?", order.plan, hasClip ? 1 : 0, now(), song.id);
  if (order.plan === "studio") {
    const u = row("SELECT * FROM users WHERE whatsapp = ?", order.whatsapp);
    if (u) run("UPDATE users SET plan = 'studio', plan_renews_at = ?, credits = credits + 3 WHERE id = ?", now() + 30 * 86400000, u.id);
    else run("INSERT INTO users (id, whatsapp, plan, plan_renews_at, credits, ref_code, created_at) VALUES (?,?,?,?,?,?,?)", id(8), order.whatsapp, "studio", now() + 30 * 86400000, 3, id(4), now());
  }
  event("order.paid", song.id, { orderId: order.id, total: order.total, plan: order.plan });
  if (hasClip) {
    const clip = row("SELECT * FROM clips WHERE song_id = ? ORDER BY created_at DESC LIMIT 1", song.id);
    if (clip && JSON.parse(clip.photos || "[]").length) run("UPDATE clips SET status = 'QUEUED', updated_at = ? WHERE id = ?", now(), clip.id);
  }
  const { sign } = require("../util");
  const token = sign({ dl: song.id }, 365 * 86400);
  const link = `${config.baseUrl}/#/musica/${song.id}?t=${token}`;
  await wa.sendText(order.whatsapp, `✅ Pagamento confirmado! A música de *${song.nome}* é sua.\nBaixe as versões completas${hasClip ? " e o clipe" : ""} aqui: ${link}`);
  const t0 = song.tracks[0];
  if (t0?.file) await wa.sendAudio(order.whatsapp, `${config.baseUrl}/api/songs/${song.id}/download?track=0&t=${token}`, song.titulo);
}

/** Renderiza um clipe na fila. */
async function renderClip(clip) {
  const song = getSong(clip.song_id);
  const photos = JSON.parse(clip.photos || "[]").map((f) => path.join(DIR("photos"), f)).filter((f) => fs.existsSync(f));
  const track = song.tracks[clip.track_index] || song.tracks[0];
  if (!photos.length || !track?.file) return;
  run("UPDATE clips SET status = 'RENDERING', updated_at = ? WHERE id = ?", now(), clip.id);
  const dest = path.join(DIR("clips"), `${clip.id}.mp4`);
  try {
    await media.renderClip({ photos, audio: path.join(DIR("tracks"), track.file), lyrics: song.letra, title: song.titulo, dest });
    run("UPDATE clips SET status = 'DONE', file = ?, updated_at = ? WHERE id = ?", path.basename(dest), now(), clip.id);
    event("clip.done", song.id, { clipId: clip.id });
    if (song.paid && song.whatsapp) {
      const { sign } = require("../util");
      const token = sign({ dl: song.id }, 365 * 86400);
      await wa.sendText(song.whatsapp, `🎬 O clipe de *${song.nome}* ficou pronto: ${config.baseUrl}/api/songs/${song.id}/clip?t=${token}`);
    }
  } catch (e) {
    run("UPDATE clips SET status = 'FAILED', error = ?, updated_at = ? WHERE id = ?", e.message, now(), clip.id);
    console.error("[clip]", e.message);
  }
}

/** Recuperação: prévia pronta, não paga, > 1 h, sem aviso ainda. */
async function recovery() {
  const list = rows("SELECT * FROM songs WHERE paid = 0 AND recovery_sent = 0 AND whatsapp IS NOT NULL AND status IN ('FIRST_SUCCESS','SUCCESS') AND updated_at < ?", now() - 3600000);
  for (const s of list) {
    run("UPDATE songs SET recovery_sent = 1 WHERE id = ?", s.id);
    await wa.sendText(s.whatsapp, `Oi! A música de *${s.nome}* continua te esperando 🎶\nOuvir de novo: ${config.baseUrl}/#/previa/${s.id}\nLibere o MP3 completo por ${brl(config.prices.musica)} — e o clipe com suas fotos por ${brl(config.prices.clipe)}.`);
    event("recovery.sent", s.id);
  }
}

// ---------------- loop do worker ----------------
const inflight = new Set();   // músicas em polling agora (evita consulta dupla)
const POLL_CONCURRENCY = 5;
async function tick() {
  try {
    const jobs = [];
    for (const s of rows("SELECT * FROM songs WHERE status IN ('PENDING','TEXT_SUCCESS','FIRST_SUCCESS') AND provider_task_id IS NOT NULL ORDER BY created_at ASC LIMIT 20")) {
      if (inflight.has(s.id)) continue;
      if (now() - s.created_at > 15 * 60000) { saveTracks(s.id, JSON.parse(s.tracks || "[]"), "FAILED", { error: "tempo esgotado no estúdio" }); continue; }
      if (jobs.length >= POLL_CONCURRENCY) break;
      inflight.add(s.id);
      jobs.push(poll(parseSong(s)).catch((e) => console.error("[poll]", s.id, e)).finally(() => inflight.delete(s.id)));
    }
    await Promise.all(jobs);
    run("UPDATE orders SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < ?", now());
  } catch (e) { console.error("[worker]", e); }
}
// clipes em fila própria: 1 render por vez, sem travar o polling das músicas
let clipBusy = false;
async function clipTick() {
  if (clipBusy) return; clipBusy = true;
  try { const clip = row("SELECT * FROM clips WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1"); if (clip) await renderClip(clip); }
  catch (e) { console.error("[clip]", e); } finally { clipBusy = false; }
}
function start() {
  setInterval(tick, 4000);
  setInterval(clipTick, 4000);
  setInterval(() => recovery().catch((e) => console.error("[recovery]", e)), 10 * 60000);
  console.log(`[worker] ativo (${config.suno.mock ? "mock" : "suno " + config.suno.baseUrl})`);
}

module.exports = { create, getSong, unpaidCount, onPaid, start, tick, ACTIVE };
