"use strict";
// WhatsApp via Evolution API (não oficial). Troque por Z-API/Meta Cloud API alterando só este arquivo.
const config = require("../config");

async function call(route, body) {
  const r = await fetch(`${config.whatsapp.url}/${route}/${config.whatsapp.instance}`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: config.whatsapp.apiKey }, body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error("evolution " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}

async function sendText(number, text) {
  if (config.whatsapp.mock) { console.log(`[whatsapp mock] → ${number}\n${text}\n`); return { mock: true }; }
  try { return await call("message/sendText", { number, text }); }
  catch (e) { console.error("[whatsapp]", e.message); return null; }
}

async function sendAudio(number, url, caption) {
  if (config.whatsapp.mock) { console.log(`[whatsapp mock] áudio → ${number}: ${url}`); return { mock: true }; }
  try { return await call("message/sendMedia", { number, mediatype: "audio", media: url, caption: caption || "" }); }
  catch (e) { console.error("[whatsapp]", e.message); return null; }
}

module.exports = { sendText, sendAudio };
