"use strict";
// PIX via Mercado Pago (Checkout Transparente / API de Pagamentos) — funciona em conta PF.
// Docs: POST https://api.mercadopago.com/v1/payments  (payment_method_id: "pix")
//       resposta: point_of_interaction.transaction_data.{qr_code, qr_code_base64, ticket_url}
//       webhook: POST notification_url  { action: "payment.updated", data: { id } }  → confirmamos com GET /v1/payments/:id
// Para Pagar.me, troque este arquivo por pix.pagarme.js (mesmo contrato: createCharge / confirmFromWebhook).
const crypto = require("crypto");
const config = require("../config");
const { id } = require("../util");

const API = "https://api.mercadopago.com";
const headers = (idem) => ({ "Content-Type": "application/json", Authorization: "Bearer " + config.pix.accessToken, ...(idem ? { "X-Idempotency-Key": idem } : {}) });

/** Cria a cobrança PIX. Retorna { providerId, pixCode, qrUrl, qrBase64, expiresAt } */
async function createCharge({ orderId, amount, description, customer }) {
  if (config.pix.mock) {
    return { providerId: "mock_" + id(8), pixCode: `00020126580014br.gov.bcb.pix0136${id(16)}5204000053039865406${(amount / 100).toFixed(2)}5802BR5905REFRAO6009FORTALEZA62070503***6304MOCK`, qrUrl: "", qrBase64: "", expiresAt: Date.now() + config.pix.expires * 1000 };
  }
  const expires = new Date(Date.now() + config.pix.expires * 1000);
  const body = {
    transaction_amount: Math.round(amount) / 100,
    description: description.slice(0, 250),
    payment_method_id: "pix",
    external_reference: orderId,
    notification_url: config.baseUrl + "/api/webhooks/pix",
    date_of_expiration: expires.toISOString().replace("Z", "-00:00"),
    payer: { email: customer.email || `${customer.phone}@refrao.app`, first_name: (customer.name || "Cliente").split(" ")[0], last_name: (customer.name || "Refrão").split(" ").slice(1).join(" ") || "Refrão" }
  };
  const r = await fetch(API + "/v1/payments", { method: "POST", headers: headers(orderId), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("mercadopago " + r.status + " " + JSON.stringify(j).slice(0, 300));
  const td = j.point_of_interaction?.transaction_data || {};
  return { providerId: String(j.id), pixCode: td.qr_code || "", qrUrl: td.ticket_url || "", qrBase64: td.qr_code_base64 || "", expiresAt: expires.getTime() };
}

/** Consulta o pagamento no provedor (fonte da verdade). Retorna { paid, orderId, providerId } */
async function fetchPayment(paymentId) {
  const r = await fetch(`${API}/v1/payments/${encodeURIComponent(paymentId)}`, { headers: headers() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("mercadopago " + r.status);
  return { paid: j.status === "approved", orderId: j.external_reference || "", providerId: String(j.id) };
}

/**
 * Valida a assinatura do webhook (x-signature: "ts=...,v1=...") quando MP_WEBHOOK_SECRET está configurado.
 * Mesmo sem assinatura o webhook é seguro: nunca confiamos no corpo, só no GET /v1/payments.
 */
function verifySignature(req, dataId) {
  if (!config.pix.webhookSecret) return true;
  const sig = String(req.headers["x-signature"] || "");
  const ts = (sig.match(/ts=([^,]+)/) || [])[1], v1 = (sig.match(/v1=([^,]+)/) || [])[1];
  if (!ts || !v1) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${req.headers["x-request-id"] || ""};ts:${ts};`;
  const mac = crypto.createHmac("sha256", config.pix.webhookSecret).update(manifest).digest("hex");
  return mac.length === v1.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(v1));
}

/** Interpreta o webhook e confirma no provedor. Retorna { paid, orderId, providerId } ou null se não for de pagamento. */
async function confirmFromWebhook(req) {
  const body = req.body || {};
  const dataId = body.data?.id || req.query["data.id"] || req.query.id;
  const type = body.type || body.action || req.query.type || req.query.topic || "";
  if (!dataId || !/payment/.test(type)) return null;
  if (!verifySignature(req, dataId)) throw Object.assign(new Error("assinatura inválida"), { status: 401 });
  return fetchPayment(dataId);
}

module.exports = { createCharge, confirmFromWebhook, fetchPayment };
