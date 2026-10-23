"use strict";
// Letra: gerada por LLM (Gemini ou API compatível com OpenAI) antes de gastar crédito de áudio.
const config = require("../config");
const { RITMOS } = require("../util");

const NICHO_DESC = {
  pessoa: "uma homenagem pessoal (aniversário, declaração, saudade, pedido de desculpas) para a pessoa chamada",
  empresa: "um jingle comercial para o negócio chamado",
  evento: "uma música para o evento/homenageados chamados",
  candidato: "um jingle de campanha eleitoral para o candidato chamado",
  criador: "uma abertura/vinheta para o canal, podcast ou perfil chamado"
};

function prompt(p) {
  const r = RITMOS[p.ritmo] || RITMOS.pop;
  const voz = p.voz === "masc" ? "voz masculina" : p.voz === "dupla" ? "dupla (voz masculina e feminina)" : "voz feminina";
  return `Você é um compositor brasileiro de hits populares. Escreva a letra de ${NICHO_DESC[p.nicho] || NICHO_DESC.pessoa} "${p.nome}"${p.numero ? ` (número ${p.numero})` : ""}${p.perfil ? `, perfil: ${p.perfil}` : ""}.
Ritmo: ${r.nome}. Cantada por ${voz}.
Recado de quem pediu (use os detalhes, nomes e frases dele): """${p.recado}"""

Regras:
- Português do Brasil, linguagem simples e cantável, rimas naturais, sem clichês vazios.
- Estrutura com marcações entre colchetes: [verso 1], [refrão], [verso 2], [refrão], [ponte], [refrão final].
- O NOME "${p.nome}" aparece no refrão pelo menos 2 vezes${p.numero ? ` e o número ${p.numero} também aparece no refrão` : ""}.
- Entre 14 e 22 linhas no total. Nenhuma linha com mais de 60 caracteres.
- Não use palavrões nem ofensas. Não invente fatos que o recado não diz.
Responda APENAS com JSON: {"titulo": "título curto com o nome", "letra": "letra completa com quebras de linha \\n"}`;
}

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("resposta sem JSON");
  const j = JSON.parse(m[0]);
  if (!j.letra) throw new Error("JSON sem letra");
  return { titulo: String(j.titulo || "").slice(0, 80), letra: String(j.letra).trim() };
}

async function viaGemini(p) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.lyrics.geminiModel}:generateContent?key=${config.lyrics.gemini}`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt(p) }] }], generationConfig: { temperature: 0.9, responseMimeType: "application/json" } }) });
  if (!r.ok) throw new Error("Gemini " + r.status + ": " + (await r.text()).slice(0, 200));
  const j = await r.json();
  return parseJson(j.candidates?.[0]?.content?.parts?.[0]?.text || "");
}

async function viaOpenAI(p) {
  const r = await fetch(config.lyrics.openaiBase + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.lyrics.openai }, body: JSON.stringify({ model: config.lyrics.openaiModel, temperature: 0.9, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt(p) }] }) });
  if (!r.ok) throw new Error("OpenAI " + r.status + ": " + (await r.text()).slice(0, 200));
  const j = await r.json();
  return parseJson(j.choices?.[0]?.message?.content || "");
}

// Mock: letra de modelo (sem custo) — serve para desenvolver e para fallback se o LLM falhar.
function mock(p) {
  const n = p.nome, r = (RITMOS[p.ritmo] || RITMOS.pop).nome.toLowerCase();
  const detalhe = (p.recado || "").replace(/\s+/g, " ").trim().slice(0, 58);
  const refrao = p.nicho === "empresa"
    ? `[refrão]\n${n}, ${n}, é aqui que tem\nChama no zap, pede já que vem\n${n}, ${n}, todo mundo sabe\nPreço bom, capricho e sabor que não acabe`
    : p.nicho === "candidato"
      ? `[refrão]\n${n}${p.numero ? ", " + p.numero : ""}, é o nome na urna\n${n}${p.numero ? ", " + p.numero : ""}, a cidade se junta\n${n}, ${n}, confirma e vai\nMudança de verdade é o que a gente trai`
      : `[refrão]\n${n}, ${n}, hoje é o seu dia\nEsse ${r} é pra você, feito com alegria\n${n}, ${n}, canta junto comigo\nO que você me ensinou eu levo pra vida, abrigo`;
  const letra = `[verso 1]\nTem gente que chega e ilumina a casa inteira\n${n} é desse jeito, a primeira da fileira\nO café na mesa, o conselho certo na hora\nA vida fica leve quando ${n} tá por perto agora\n\n${refrao}\n\n[verso 2]\n${detalhe || "Cada detalhe que você contou virou melodia"}\nE se a saudade bater, essa música é companhia\n\n${refrao.replace("[refrão]", "[refrão final]")}`;
  return { titulo: `${n}, com carinho`, letra };
}

async function generate(p) {
  if (config.lyrics.mock) return mock(p);
  try {
    return config.lyrics.gemini ? await viaGemini(p) : await viaOpenAI(p);
  } catch (e) {
    console.error("[lyrics] falhou, usando modelo:", e.message);
    return mock(p);
  }
}

module.exports = { generate };
