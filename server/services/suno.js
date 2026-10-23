"use strict";
// Geração de música via API intermediária do Suno (sunoapi.org / kie.ai — mesmo formato).
// Docs: POST /api/v1/generate  → { code, data: { taskId } }
//       GET  /api/v1/generate/record-info?taskId= → { data: { status, response: { sunoData: [...] } } }
// Status: PENDING | TEXT_SUCCESS | FIRST_SUCCESS | SUCCESS | CREATE_TASK_FAILED | GENERATE_AUDIO_FAILED | CALLBACK_EXCEPTION | SENSITIVE_WORD_ERROR
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const config = require("../config");
const { id } = require("../util");

const FAIL = new Set(["CREATE_TASK_FAILED", "GENERATE_AUDIO_FAILED", "CALLBACK_EXCEPTION", "SENSITIVE_WORD_ERROR"]);

async function api(method, route, body) {
  const r = await fetch(config.suno.baseUrl + route, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.suno.apiKey },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.code && j.code !== 200)) throw new Error(`suno ${r.status} ${j.msg || j.message || ""}`.trim());
  return j.data;
}

/** Cria a task. Retorna { taskId }. */
async function create({ letra, style, titulo, voz }) {
  if (config.suno.mock) return mockCreate();
  const vocal = voz === "masc" ? "male vocals" : voz === "dupla" ? "male and female duet vocals" : "female vocals";
  const data = await api("POST", "/api/v1/generate", {
    customMode: true, instrumental: false, model: config.suno.model,
    prompt: letra, style: `${style}, ${vocal}`, title: (titulo || "Refrão").slice(0, 80),
    callBackUrl: config.baseUrl + "/api/webhooks/suno"
  });
  return { taskId: data.taskId };
}

/** Consulta a task. Retorna { status, tracks: [{id, audioUrl, streamUrl, imageUrl, duration, title}], error } */
async function status(taskId) {
  if (config.suno.mock) return mockStatus(taskId);
  const data = await api("GET", "/api/v1/generate/record-info?taskId=" + encodeURIComponent(taskId));
  const st = data.status || "PENDING";
  const list = data.response?.sunoData || [];
  const tracks = list.map((t) => ({ id: t.id, audioUrl: t.audioUrl || "", streamUrl: t.streamAudioUrl || t.audioUrl || "", imageUrl: t.imageUrl || "", duration: Number(t.duration || 0), title: t.title || "" }));
  return { status: FAIL.has(st) ? "FAILED" : st, tracks, error: FAIL.has(st) ? (data.errorMessage || st) : null };
}

/** Baixa um MP3 remoto para o arquivo local. */
async function download(url, dest) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("download " + r.status);
  const { pipeline } = require("stream/promises");
  const { Readable } = require("stream");
  const tmp = dest + ".part";
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest); // só vira "pronto" quando completo
  return dest;
}

// ===================== MOCK =====================
// Simula a progressão de status e gera 2 faixas de 40 s com ffmpeg (acordes sintetizados),
// para o fluxo inteiro funcionar sem chave e sem custo.
const mockTasks = new Map();
function mockCreate() {
  const taskId = id(16);
  mockTasks.set(taskId, { t0: Date.now(), files: [] });
  const dir = path.join(config.dataDir, "tmp");
  const freqs = [[261.6, 329.6, 392.0], [293.7, 370.0, 440.0]];
  freqs.forEach((f, i) => {
    const file = path.join(dir, `mock-${taskId}-${i}.mp3`);
    const filter = `sine=frequency=${f[0]}:duration=40[a];sine=frequency=${f[1]}:duration=40[b];sine=frequency=${f[2]}:duration=40[c];[a][b][c]amix=inputs=3,volume=0.6,tremolo=f=${2 + i}:d=0.5`;
    const p = spawn(config.media.ffmpeg, ["-y", "-f", "lavfi", "-i", filter, "-t", "40", "-q:a", "4", file], { stdio: "ignore" });
    p.on("close", () => mockTasks.get(taskId).files[i] = file);
  });
  return { taskId };
}
function mockStatus(taskId) {
  const m = mockTasks.get(taskId);
  if (!m) return { status: "FAILED", tracks: [], error: "task desconhecida" };
  const s = (Date.now() - m.t0) / 1000;
  const mk = (i) => ({ id: taskId.slice(0, 8) + "-" + i, audioUrl: "file://" + m.files[i], streamUrl: "file://" + m.files[i], imageUrl: "", duration: 40, title: "mock" });
  if (s < 4) return { status: "PENDING", tracks: [], error: null };
  if (s < 8) return { status: "TEXT_SUCCESS", tracks: [], error: null };
  if (s < 12 || !m.files[1]) return { status: "FIRST_SUCCESS", tracks: m.files[0] ? [mk(0)] : [], error: null };
  return { status: "SUCCESS", tracks: [mk(0), mk(1)], error: null };
}

module.exports = { create, status, download, FAIL };
