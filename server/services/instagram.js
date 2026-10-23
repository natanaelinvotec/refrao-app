"use strict";
// "Siga e ganhe" pelo Instagram (Messaging API da Meta).
//
// Como funciona: a pessoa segue a página e manda "CUPOM" no direct. A Meta chama o webhook com a mensagem;
// a gente consulta o perfil do remetente — o campo `is_user_follow_business` diz se ela segue a página —
// e responde no próprio direct com o código do cupom. Não existe jeito de perguntar "fulano me segue?"
// sem a pessoa ter mandado mensagem antes; por isso o fluxo passa pelo direct.
//
// Requisitos (Meta for Developers): app com produto Instagram → Messaging, conta profissional do Instagram
// (ligada a uma Página do Facebook se usar graph.facebook.com), token com instagram_basic +
// instagram_manage_messages, e o webhook "messages" apontando para {BASE_URL}/api/webhooks/instagram.
const crypto = require("crypto");
const config = require("../config");
const { row, run, now } = require("../db");
const cupons = require("./cupons");

const BASE = (process.env.IG_GRAPH_BASE || "https://graph.facebook.com/v21.0").replace(/\/$/, "");
const GATILHO = /\b(cupom|cupon|desconto|codigo|código|seguindo|segui)\b/i;

function texto(nome) {
  const h = config.instagram.handle;
  return {
    segue: (code, pct) => `Valeu por seguir a gente${nome ? ", " + nome : ""}! 🎶\nSeu cupom de ${pct}% é *${code}*.\nCole no checkout em ${config.baseUrl} (vale pra Música e Música + clipe, 1 uso, ${config.cupom.dias} dias).`,
    jaUsou: (code) => `Você já usou seu cupom *${code}* — ele vale uma vez por seguidor. 🎶 Mas conta pra gente: se quiser outra música, chama no WhatsApp que a gente vê um jeito!`,
    naoSegue: () => `Oi${nome ? ", " + nome : ""}! Pra ganhar o cupom é só seguir @${h} e mandar "CUPOM" de novo aqui que eu respondo na hora. 😉`,
    ajuda: () => `Oi! Manda "CUPOM" aqui que eu te dou ${config.cupom.pct}% de desconto na sua música com o nome no refrão. 🎤`
  };
}

async function graph(pathname, init) {
  const sep = pathname.includes("?") ? "&" : "?";
  const r = await fetch(`${BASE}/${pathname}${sep}access_token=${encodeURIComponent(config.instagram.accessToken)}`, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("instagram " + r.status + " " + JSON.stringify(j).slice(0, 200));
  return j;
}

async function perfil(igsid) {
  if (config.instagram.mock) return { username: "seguidor." + igsid, name: "Demo", is_user_follow_business: String(igsid) !== "0" };
  return graph(`${igsid}?fields=name,username,is_user_follow_business`);
}

async function enviar(igsid, text) {
  if (config.instagram.mock) { console.log(`[instagram mock] → ${igsid}\n${text}\n`); return { mock: true }; }
  return graph(`${config.instagram.accountId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: { id: igsid }, message: { text } }) });
}

// Assinatura do webhook (X-Hub-Signature-256) — só é checada se IG_APP_SECRET estiver configurado.
function assinaturaOk(req) {
  const secret = process.env.IG_APP_SECRET;
  if (!secret) return true;
  const sig = String(req.headers["x-hub-signature-256"] || "");
  const esperado = "sha256=" + crypto.createHmac("sha256", secret).update(req.rawBody || "").digest("hex");
  return sig.length === esperado.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado));
}

// Evita tratar a mesma mensagem duas vezes (a Meta reenvia quando não recebe 200 rápido).
function jaVisto(mid) {
  if (!mid) return false;
  if (row("SELECT id FROM inbox_seen WHERE id = ?", mid)) return true;
  run("INSERT INTO inbox_seen (id, created_at) VALUES (?,?)", mid, now());
  run("DELETE FROM inbox_seen WHERE created_at < ?", now() - 7 * 86400000);
  return false;
}

// Trata o corpo do webhook. Retorna quantas mensagens foram respondidas.
async function tratar(body) {
  let n = 0;
  for (const entry of body?.entry || []) {
    for (const ev of entry.messaging || []) {
      const msg = ev.message;
      if (!msg || msg.is_echo || !ev.sender?.id) continue;
      if (jaVisto(msg.mid)) continue;
      const igsid = ev.sender.id;
      const t = String(msg.text || "");
      try {
        if (!GATILHO.test(t)) { await enviar(igsid, texto().ajuda()); n++; continue; }
        const p = await perfil(igsid);
        const T = texto(p.name || p.username);
        if (p.is_user_follow_business) {
          const c = cupons.gerar({ source: "instagram", handle: p.username || igsid });
          await enviar(igsid, c.uses >= c.max_uses ? T.jaUsou(c.code) : T.segue(c.code, c.pct));
        } else {
          await enviar(igsid, T.naoSegue());
        }
        n++;
      } catch (e) { console.error("[instagram]", e.message); }
    }
  }
  return n;
}

module.exports = { tratar, assinaturaOk, enviar, perfil };
