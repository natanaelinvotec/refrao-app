"use strict";
// E-mail transacional sem dependências: Resend (RESEND_API_KEY) ou Brevo (BREVO_API_KEY), via HTTPS.
// Sem chave → modo mock (imprime no log). Anexa os MP3 quando o total cabe no limite do provedor;
// senão manda só os links assinados (que valem 1 ano).
const fs = require("fs");
const path = require("path");
const config = require("../config");

const LIMITE = { resend: 35 * 1024 * 1024, brevo: 9 * 1024 * 1024 }; // margem abaixo do limite oficial

function provedor() {
  if (config.email.mock) return "mock";
  return config.email.resendKey ? "resend" : "brevo";
}

const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Monta o HTML da entrega no clima do site (escuro, magenta/ciano), sem imagens externas.
function htmlEntrega({ nome, titulo, links, pagina, clipe, brand, baseUrl }) {
  const btn = (href, txt, cor) => `<a href="${esc(href)}" style="display:inline-block;margin:6px 8px 6px 0;padding:14px 22px;border-radius:999px;background:${cor};color:#fff;font-weight:700;text-decoration:none;font-family:Arial,sans-serif">${esc(txt)}</a>`;
  const lista = links.map((l, i) => btn(l, `Baixar MP3 · versão ${i + 1}`, "#ff2bd6")).join("");
  return `<!doctype html><html><body style="margin:0;background:#07060f;color:#f6f4ff;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
  <p style="font-size:13px;letter-spacing:.2em;color:#cfcaff;margin:0 0 6px">SINGLE · ${esc(brand).toUpperCase()}</p>
  <h1 style="font-size:34px;line-height:1.05;margin:0 0 6px;color:#fff">${esc(titulo || nome)}</h1>
  <p style="color:#cfcaff;margin:0 0 22px">Pagamento confirmado. A música de <b style="color:#fff">${esc(nome)}</b> é sua — sem marca d'água, com licença de uso.</p>
  <div style="background:#15112b;border:1px solid #ffffff22;border-radius:18px;padding:20px;margin-bottom:16px">
    <p style="margin:0 0 10px;color:#fff;font-weight:700">Salvar no aparelho</p>
    ${lista}
    ${clipe ? btn(clipe, "Baixar o clipe (MP4 9:16)", "#19e6ff") : ""}
    <p style="margin:12px 0 0;font-size:13px;color:#cfcaff">Os arquivos também vão em anexo quando cabem no e-mail. Os links valem por 1 ano.</p>
  </div>
  <div style="background:#15112b;border:1px solid #ffffff22;border-radius:18px;padding:20px;margin-bottom:16px">
    <p style="margin:0 0 10px;color:#fff;font-weight:700">Compartilhar nas redes</p>
    <p style="margin:0 0 10px;color:#cfcaff;font-size:14px">A página da música tem capa e player pra mandar no WhatsApp, Instagram e TikTok:</p>
    ${btn(pagina, "Abrir a página da música", "#3a0ca3")}
    ${btn("https://wa.me/?text=" + encodeURIComponent("Ouve a música que fiz pra " + nome + " 🎵 " + pagina), "Mandar no WhatsApp", "#25D366")}
  </div>
  <p style="font-size:12px;color:#8a85a8;margin:24px 0 0">${esc(brand)} · ${esc(baseUrl)} · você recebeu este e-mail porque comprou uma música com este endereço.</p>
</div></body></html>`;
}

async function viaResend({ to, subject, html, attachments }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${config.email.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.email.from, to: [to], subject, html, attachments: attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) })
  });
  if (!r.ok) throw new Error("resend " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}

async function viaBrevo({ to, subject, html, attachments }) {
  const m = config.email.from.match(/^(.*?)\s*<([^>]+)>$/);
  const sender = m ? { name: m[1].trim(), email: m[2] } : { email: config.email.from };
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST", headers: { "api-key": config.email.brevoKey, "Content-Type": "application/json" },
    body: JSON.stringify({ sender, to: [{ email: to }], subject, htmlContent: html, attachment: attachments.length ? attachments.map((a) => ({ name: a.filename, content: a.content.toString("base64") })) : undefined })
  });
  if (!r.ok) throw new Error("brevo " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}

// Decide o que anexar: só arquivos existentes e enquanto couber no limite do provedor.
function anexos(arquivos, prov) {
  const out = []; let total = 0; const lim = LIMITE[prov] || 0;
  for (const a of arquivos) {
    try { const st = fs.statSync(a.path); if (total + st.size > lim) continue; total += st.size; out.push({ filename: a.filename, content: fs.readFileSync(a.path) }); } catch { /* arquivo ausente: fica só o link */ }
  }
  return out;
}

/** Envia a entrega. `arquivos`: [{ path, filename }] (MP3s); `links`: URLs assinadas de download. */
async function enviarEntrega({ to, nome, titulo, links, pagina, clipe, arquivos = [] }) {
  const prov = provedor();
  const subject = `🎵 ${titulo || "Sua música"} — ${config.brand}`;
  const html = htmlEntrega({ nome, titulo, links, pagina, clipe, brand: config.brand, baseUrl: config.baseUrl });
  if (prov === "mock") { console.log(`[email mock] → ${to}\n${subject}\nlinks: ${links.join(" | ")}\nanexos: ${arquivos.map((a) => a.filename).join(", ") || "-"}\n`); return { mock: true }; }
  const attachments = config.email.delivery === "attach" ? anexos(arquivos, prov) : [];
  try { return prov === "resend" ? await viaResend({ to, subject, html, attachments }) : await viaBrevo({ to, subject, html, attachments }); }
  catch (e) { console.error("[email]", e.message); return null; }
}

module.exports = { enviarEntrega, provedor };
