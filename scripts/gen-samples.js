"use strict";
// Gera uma amostra curta por ritmo pelo provedor (uma vez só) e corta 12 s com ffmpeg → public/samples/<ritmo>.mp3
// Uso: SUNO_API_KEY=... node scripts/gen-samples.js [ritmo ...]
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const config = require("../server/config");
const suno = require("../server/services/suno");
const { RITMOS } = require("../server/util");

(async () => {
  const lista = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(RITMOS);
  const out = path.join(config.publicDir, "samples");
  fs.mkdirSync(out, { recursive: true });
  for (const id of lista) {
    const r = RITMOS[id]; if (!r) { console.log("ritmo desconhecido:", id); continue; }
    const dest = path.join(out, id + ".mp3");
    if (fs.existsSync(dest)) { console.log("já existe:", id); continue; }
    console.log("gerando", id, "...");
    const letra = `[refrão]\nSeu nome no refrão, cantando pra você\n${r.nome}, do jeito que tem que ser\nSeu nome no refrão, todo mundo vai saber\n${r.nome} de verdade, pra você`;
    const { taskId } = await suno.create({ letra, style: r.style, titulo: "Amostra " + r.nome, voz: "fem" });
    let st;
    for (let i = 0; i < 90; i++) { await new Promise((x) => setTimeout(x, 5000)); st = await suno.status(taskId); if (st.status === "SUCCESS" || st.status === "FIRST_SUCCESS" || st.status === "FAILED") break; }
    const t = st.tracks[0];
    if (!t || !(t.audioUrl || t.streamUrl)) { console.log("falhou:", id, st.error); continue; }
    const tmp = path.join(config.dataDir, "tmp", id + "-full.mp3");
    const url = t.audioUrl || t.streamUrl;
    if (url.startsWith("file://")) fs.copyFileSync(url.slice(7), tmp); else await suno.download(url, tmp);
    // corta 12 s a partir de 30 s (normalmente já no refrão) com fade
    spawnSync(config.media.ffmpeg, ["-y", "-v", "error", "-ss", "30", "-t", "12", "-i", tmp, "-af", "afade=t=in:d=0.5,afade=t=out:st=11:d=1", "-q:a", "5", dest]);
    console.log("ok:", dest);
  }
})().catch((e) => { console.error(e); process.exit(1); });
