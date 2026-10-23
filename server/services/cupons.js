"use strict";
// Cupons de desconto — hoje só o "siga e ganhe" (seguidor do Instagram), mas a tabela serve para qualquer campanha.
// Regras: desconto em % só sobre o preço do plano (nunca sobre os extras), só em planos com `cupom: true`,
// um uso por código (max_uses), validade em dias, e o uso é consumido quando o pedido é PAGO (não ao gerar o PIX).
const crypto = require("crypto");
const config = require("../config");
const { row, run, rows, now } = require("../db");
const { PLANOS } = require("../util");

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I para não confundir ao digitar
function codigo(prefixo) {
  const b = crypto.randomBytes(4);
  let s = "";
  for (let i = 0; i < 4; i++) s += ALFABETO[b[i] % ALFABETO.length];
  return `${prefixo}-${s}`;
}
const normalizar = (c) => String(c || "").trim().toUpperCase().replace(/\s+/g, "");

// Quem já ganhou (mesma fonte + mesmo @/número) recebe o mesmo código de novo em vez de um cupom extra;
// se já gastou o dele, volta o cupom gasto (quem chama decide o que dizer — ver instagram.js).
function gerar({ source, handle, pct, maxUses = 1, prefixo = "SIGA" }) {
  const h = handle ? String(handle).trim().toLowerCase() : null;
  if (h) {
    const ja = row("SELECT * FROM coupons WHERE source = ? AND handle = ? ORDER BY created_at DESC LIMIT 1", source, h);
    if (ja && (ja.uses >= ja.max_uses || !ja.expires_at || ja.expires_at > now())) return ja;
  }
  let code;
  for (let i = 0; i < 10; i++) { code = codigo(prefixo); if (!row("SELECT code FROM coupons WHERE code = ?", code)) break; }
  const expires = config.cupom.dias > 0 ? now() + config.cupom.dias * 86400000 : null;
  run("INSERT INTO coupons (code, pct, source, handle, max_uses, uses, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)",
    code, pct || config.cupom.pct, source, h, maxUses, 0, expires, now());
  return row("SELECT * FROM coupons WHERE code = ?", code);
}

// Retorna { ok, pct, code } ou { ok:false, erro }
function validar(input, plan) {
  const code = normalizar(input);
  if (!code) return { ok: false, erro: "digite o código do cupom" };
  const c = row("SELECT * FROM coupons WHERE code = ?", code);
  if (!c) return { ok: false, erro: "cupom não encontrado" };
  if (c.expires_at && c.expires_at < now()) return { ok: false, erro: "esse cupom venceu" };
  if (c.uses >= c.max_uses) return { ok: false, erro: "esse cupom já foi usado" };
  const p = PLANOS[plan];
  if (p && !p.cupom) return { ok: false, erro: `o cupom não vale no plano ${p.nome}` };
  return { ok: true, pct: c.pct, code: c.code };
}

// Aplica o desconto ao preço do plano (centavos), arredondando para baixo.
function aplicar(precoPlano, pct) { return Math.floor(precoPlano * (100 - pct) / 100); }

function consumir(code, orderId) {
  if (!code) return;
  run("UPDATE coupons SET uses = uses + 1, used_by = ? WHERE code = ? AND uses < max_uses", orderId, normalizar(code));
}

function listar(limit = 200) { return rows("SELECT * FROM coupons ORDER BY created_at DESC LIMIT ?", limit); }

module.exports = { gerar, validar, aplicar, consumir, listar, normalizar };
