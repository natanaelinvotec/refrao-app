"use strict";
const path = require("path");
const { createApp, json, serveStatic } = require("./lib/http");
const config = require("./config");
require("./db");
const api = require("./routes/api");
const admin = require("./routes/admin");
const songs = require("./services/songs");
const { row, parseSong } = require("./db");
const { RITMOS } = require("./util");

const app = createApp();

// cabeçalhos de segurança + corpo JSON
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  next();
});
app.use(json(200 * 1024));

// limite simples de requisições por IP nas rotas caras
const buckets = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const k = req.ip + " " + req.path;
    const b = buckets.get(k) || { n: 0, t: Date.now() };
    if (Date.now() - b.t > windowMs) { b.n = 0; b.t = Date.now(); }
    b.n++; buckets.set(k, b);
    if (b.n > max) return res.status(429).json({ error: "calma, muitas tentativas. tente em 1 minuto." });
    next();
  };
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (t - b.t > 2 * 60000) buckets.delete(k); if (buckets.size > 50000) buckets.clear(); }, 60000);
app.post("/api/lyrics", limit(20, 60000), (req, res, next) => next());
app.post("/api/songs", limit(5, 60000), (req, res, next) => next());
app.post("/api/auth/otp", limit(5, 60000), (req, res, next) => next());
app.post("/api/auth/verify", limit(10, 60000), (req, res, next) => next());
app.post("/api/admin/login", limit(10, 60000), (req, res, next) => next());
app.post("/api/checkout", limit(10, 60000), (req, res, next) => next());

app.use("/api/admin", admin);
app.use("/api", api);

// página pública com meta tags (link com título no WhatsApp) → abre o app
app.get("/m/:slug", (req, res) => {
  const s = parseSong(row("SELECT * FROM songs WHERE slug = ?", req.params.slug));
  if (!s) return res.redirect("/");
  const title = `${s.titulo || s.nome} · ${config.brand}`;
  const desc = `${(RITMOS[s.ritmo] || {}).nome || "música"} com o nome no refrão. Ouça e faça a sua.`;
  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="music.song">
<meta property="og:url" content="${config.baseUrl}/m/${esc(s.slug)}"><meta property="og:image" content="${config.baseUrl}/img/og-default.png">
<meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url=/#/m/${esc(s.slug)}"></head><body></body></html>`);
});
function esc(x) { return String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// index.html servido da memória: config injetado (sem 1 RTT de /api/config antes da 1ª pintura),
// CSS/JS versionados pela data do arquivo (cache imutável + invalidação automática no deploy), ETag/304.
const fs = require("fs");
const crypto = require("crypto");
const { publicConfig } = require("./util");
const CFG = publicConfig();
const ver = (p) => { try { return Math.floor(fs.statSync(path.join(config.publicDir, p)).mtimeMs).toString(36); } catch { return "1"; } };
const INDEX = fs.readFileSync(path.join(config.publicDir, "index.html"), "utf8")
  .replace(/(href|src)="(\/(?:css|js)\/[^"?]+)"/g, (_, a, p) => `${a}="${p}?v=${ver(p.slice(1))}"`)
  .replace("</head>", `<script>window.__CFG=${JSON.stringify(CFG).replace(/</g, "\\u003c")}</script></head>`);
const INDEX_ETAG = `"${crypto.createHash("sha1").update(INDEX).digest("hex").slice(0, 16)}"`;
const sendIndex = (req, res) => {
  res.setHeader("Cache-Control", "no-cache"); res.setHeader("ETag", INDEX_ETAG);
  if (req.headers["if-none-match"] === INDEX_ETAG) return res.status(304).end();
  res.send(INDEX);
};
app.get("/", sendIndex);
app.get("/index.html", sendIndex);
app.use(serveStatic(config.publicDir));
app.use((req, res, next) => (req.method === "GET" && !req.path.startsWith("/api/") ? sendIndex(req, res) : next()));

app.listen(config.port, () => {
  console.log(`${config.brand} no ar em ${config.baseUrl} (porta ${config.port})${config.mock ? " — MODO MOCK" : ""}`);
  songs.start();
});
