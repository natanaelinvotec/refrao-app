"use strict";
// ffmpeg: marca d'água na prévia e render do clipe 9:16 com fotos + legenda da letra.
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("../config");

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    // prioridade baixa: o render não disputa CPU com a API
    const p = spawn("nice", ["-n", "10", config.media.ffmpeg, "-hide_banner", "-loglevel", "error", "-y", ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg saiu com " + code + ": " + err.slice(-400)))));
  });
}

function duration(file) {
  return new Promise((resolve) => {
    execFile(config.media.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], (e, out) => resolve(e ? 0 : parseFloat(out) || 0));
  });
}

/**
 * Prévia com marca d'água: um toque curto (880 Hz) a cada WATERMARK_EVERY segundos,
 * mixado sobre a música, com a música inteira (ou PREVIEW_SECONDS).
 */
async function watermark(src, dest) {
  const every = config.media.watermarkEvery;
  const limit = config.media.previewSeconds > 0 ? ["-t", String(config.media.previewSeconds)] : [];
  const filter = `[1:a]volume='0.35*lt(mod(t,${every}),0.35)':eval=frame[wm];[0:a][wm]amix=inputs=2:duration=first:dropout_transition=0,volume=1.6[out]`;
  await ffmpeg(["-i", src, "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100", "-filter_complex", filter, "-map", "[out]", ...limit, "-codec:a", "libmp3lame", "-b:a", "112k", "-metadata", `comment=preview ${config.brand}`, dest]);
  return dest;
}

/** Escapa texto para o drawtext do ffmpeg. */
function esc(s) { return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%").replace(/,/g, "\\,").replace(/\[/g, "\\[").replace(/\]/g, "\\]"); }

/** Quebra uma linha da letra em até 2 linhas de ~26 caracteres. */
function wrap(line, max = 22) {
  const words = line.split(/\s+/), out = []; let cur = "";
  for (const w of words) { if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) out.push(cur);
  return out.slice(0, 3).join("\n");
}

/**
 * Clipe 9:16 (720x1280): cada foto com movimento lento (Ken Burns), legenda da letra distribuída
 * no tempo da música, assinatura da marca e o áudio da faixa.
 * photos: caminhos locais (1–8). audio: mp3. lyrics: texto da letra. dest: mp4.
 */
async function renderClip({ photos, audio, lyrics, title, dest, onProgress }) {
  const total = Math.max(10, await duration(audio));
  const fps = 25, W = 720, H = 1280;
  const n = Math.max(1, photos.length);
  const per = total / n, frames = Math.round(per * fps);
  const inputs = []; const parts = [];
  photos.forEach((p, i) => {
    // 1 frame por foto: o zoompan (d=frames) é quem cria a duração do segmento
    inputs.push("-loop", "1", "-framerate", "1", "-t", "1", "-i", p);
    const zoom = i % 2 === 0 ? `min(zoom+0.0008,1.18)` : `if(eq(on,1),1.18,max(zoom-0.0008,1))`;
    parts.push(`[${i}:v]scale=${W * 1.3}:${H * 1.3}:force_original_aspect_ratio=increase,crop=${W * 1.3}:${H * 1.3},zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},format=yuv420p,setsar=1[v${i}]`);
  });
  const concat = parts.join(";") + ";" + photos.map((_, i) => `[v${i}]`).join("") + `concat=n=${n}:v=1:a=0[base]`;

  // legendas: linhas da letra (sem [tags]) distribuídas uniformemente
  const lines = String(lyrics || "").split("\n").map((l) => l.trim()).filter((l) => l && !/^\[.*\]$/.test(l));
  const slot = lines.length ? total / lines.length : total;
  const font = fs.existsSync(config.media.font) ? `fontfile='${config.media.font}':` : "";
  let chain = "[base]";
  const draws = [];
  lines.forEach((l, i) => {
    const t0 = (i * slot).toFixed(2), t1 = ((i + 1) * slot).toFixed(2);
    draws.push(`drawtext=${font}text='${esc(wrap(l))}':fontsize=44:fontcolor=white:line_spacing=10:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2:y=h-text_h-170:enable='between(t,${t0},${t1})'`);
  });
  draws.push(`drawbox=x=0:y=ih-110:w=iw:h=110:color=black@0.35:t=fill`);
  draws.push(`drawtext=${font}text='${esc(title || "")}':fontsize=30:fontcolor=white:x=(w-text_w)/2:y=h-92`);
  draws.push(`drawtext=${font}text='feito com ${esc(config.brand)}':fontsize=22:fontcolor=white@0.75:x=(w-text_w)/2:y=h-48`);
  const filter = concat + ";" + chain + draws.join(",") + "[vout]";

  const args = [...inputs, "-i", audio, "-filter_complex", filter, "-map", "[vout]", "-map", `${n}:a`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", "-t", total.toFixed(2), dest];
  await ffmpeg(args);
  if (onProgress) onProgress(1);
  return dest;
}

/** Capa quadrada simples (fundo de cor + título) para OG image / player. */
async function cover({ title, subtitle, color, dest }) {
  const font = fs.existsSync(config.media.font) ? `fontfile='${config.media.font}':` : "";
  const filter = `drawtext=${font}text='${esc(title)}':fontsize=84:fontcolor=0x140B2E:x=56:y=h-230:line_spacing=8,drawtext=${font}text='${esc(subtitle)}':fontsize=36:fontcolor=0x140B2E@0.8:x=56:y=h-110,drawtext=${font}text='single':fontsize=28:fontcolor=0x140B2E@0.7:x=56:y=48`;
  await ffmpeg(["-f", "lavfi", "-i", `color=c=${color.replace("#", "0x")}:s=1200x1200:d=1`, "-vf", filter, "-frames:v", "1", dest]);
  return dest;
}

module.exports = { watermark, renderClip, cover, duration };
