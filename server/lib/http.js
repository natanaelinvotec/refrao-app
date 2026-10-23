"use strict";
// Mini-framework HTTP sem dependências (subconjunto do Express): rotas com :params, JSON,
// multipart, cookies, estáticos com Range, ETag/304 e compressão (gzip/brotli).
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { URL } = require("url");

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg)/;
const zcache = new Map(); // arquivo:mtime:enc → Buffer (só textos pequenos)
const TRUST_PROXY = process.env.TRUST_PROXY === "1";

function compile(p) {
  const keys = [];
  const re = new RegExp("^" + p.replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  return { re, keys };
}

class Router {
  constructor() { this.layers = []; }
  use(a, b) { if (typeof a === "function") this.layers.push({ prefix: "", fn: a }); else this.layers.push({ prefix: a.replace(/\/+$/, ""), fn: b }); return this; }
  _add(method, p, fns) { const c = compile(p); this.layers.push({ method, ...c, fns }); return this; }
  get(p, ...fns) { return this._add("GET", p, fns); }
  post(p, ...fns) { return this._add("POST", p, fns); }
  delete(p, ...fns) { return this._add("DELETE", p, fns); }
  all(p, ...fns) { return this._add(null, p, fns); }

  handle(req, res, basePath, done) {
    const rel = req.path.slice(basePath.length) || "/";
    let i = 0;
    const next = (err) => {
      if (err) return done(err);
      const L = this.layers[i++];
      if (!L) return done();
      if (L.fn) {
        if (L.prefix && !(rel === L.prefix || rel.startsWith(L.prefix + "/"))) return next();
        if (L.fn instanceof Router) return L.fn.handle(req, res, basePath + L.prefix, next);
        try { return Promise.resolve(L.fn(req, res, next)).catch(next); } catch (e) { return next(e); }
      }
      if (L.method && L.method !== req.method) return next();
      const m = rel.match(L.re);
      if (!m) return next();
      req.params = {}; L.keys.forEach((k, j) => (req.params[k] = decodeURIComponent(m[j + 1])));
      let j = 0;
      const run = (e) => {
        if (e) return done(e);
        const fn = L.fns[j++];
        if (!fn) return next();
        try { Promise.resolve(fn(req, res, run)).catch(done); } catch (err) { done(err); }
      };
      run();
    };
    next();
  }
}

function decorate(req, res) {
  const u = new URL(req.url, "http://x");
  req.path = u.pathname.replace(/\/{2,}/g, "/");
  req.query = Object.fromEntries(u.searchParams.entries());
  // só confia em X-Forwarded-For atrás de proxy conhecido (TRUST_PROXY=1)
  req.ip = (TRUST_PROXY ? (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() : "") || req.socket.remoteAddress || "";
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => {
    const s = JSON.stringify(o);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (s.length > 1024 && /gzip/.test(req.headers["accept-encoding"] || "")) { res.setHeader("Content-Encoding", "gzip"); res.setHeader("Vary", "Accept-Encoding"); return res.end(zlib.gzipSync(s)); }
    res.end(s);
  };
  res.send = (s) => { if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(s); };
  res.redirect = (to) => { res.statusCode = 302; res.setHeader("Location", to); res.end(); };
  res.sendFile = (file, opts = {}) => sendFile(req, res, file, opts);
  res.download = (file, name) => sendFile(req, res, file, { download: name || path.basename(file) });
}

function sendFile(req, res, file, opts) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.statusCode = 404; return res.end("not found"); }
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    res.setHeader("Content-Type", type);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("ETag", etag);
    res.setHeader("Last-Modified", st.mtime.toUTCString());
    if (opts.cacheControl) res.setHeader("Cache-Control", opts.cacheControl);
    else if (opts.maxAge) res.setHeader("Cache-Control", "public, max-age=" + opts.maxAge);
    if (opts.download) res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(opts.download)}"; filename*=UTF-8''${encodeURIComponent(opts.download)}`);
    if (req.headers["if-none-match"] === etag) { res.statusCode = 304; return res.end(); }
    const range = req.headers.range && req.headers.range.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      let start, end;
      if (!range[1] && range[2]) { start = Math.max(0, st.size - parseInt(range[2])); end = st.size - 1; } // sufixo bytes=-N
      else { start = parseInt(range[1] || "0"); end = range[2] ? parseInt(range[2]) : st.size - 1; }
      if (isNaN(start) || start >= st.size) { res.statusCode = 416; res.setHeader("Content-Range", `bytes */${st.size}`); return res.end(); }
      end = Math.min(end, st.size - 1);
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${st.size}`);
      res.setHeader("Content-Length", end - start + 1);
      if (req.method === "HEAD") return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    const ae = String(req.headers["accept-encoding"] || "");
    const enc = COMPRESSIBLE.test(type) && st.size > 1024 && st.size < 2 * 1024 * 1024 ? (ae.includes("br") ? "br" : ae.includes("gzip") ? "gzip" : null) : null;
    if (enc) {
      res.setHeader("Vary", "Accept-Encoding"); res.setHeader("Content-Encoding", enc);
      const key = `${file}:${st.mtimeMs}:${enc}`;
      let buf = zcache.get(key);
      if (!buf) {
        const raw = fs.readFileSync(file);
        buf = enc === "br" ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : zlib.gzipSync(raw, { level: 6 });
        if (zcache.size > 200) zcache.clear();
        zcache.set(key, buf);
      }
      res.setHeader("Content-Length", buf.length);
      return req.method === "HEAD" ? res.end() : res.end(buf);
    }
    res.setHeader("Content-Length", st.size);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function rawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error("corpo muito grande"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Middleware: JSON → req.body; guarda req.rawBody (para verificar assinatura de webhooks). */
function json(limit = 200 * 1024) {
  return async (req, res, next) => {
    req.body = {};
    const ct = req.headers["content-type"] || "";
    if (!/application\/json/.test(ct) || req.method === "GET") return next();
    try { const b = await rawBody(req, limit); req.rawBody = b; req.body = b.length ? JSON.parse(b.toString("utf8")) : {}; next(); }
    catch (e) { res.status(e.status || 400).json({ error: e.status === 413 ? "corpo muito grande" : "JSON inválido" }); }
  };
}

const MAGIC = [[/jpeg/, Buffer.from([0xff, 0xd8, 0xff])], [/png/, Buffer.from([0x89, 0x50, 0x4e, 0x47])], [/webp/, Buffer.from("RIFF")]];
function isImage(buf, mimetype) {
  const m = MAGIC.find(([re]) => re.test(mimetype));
  if (!m) return false;
  if (!buf.slice(0, m[1].length).equals(m[1])) return false;
  return !/webp/.test(mimetype) || buf.slice(8, 12).toString() === "WEBP";
}

/** Middleware multipart: grava arquivos (validados pelos bytes iniciais) em destDir → req.files; campos em req.body. */
function multipart({ destDir, maxFiles = 8, maxFileSize = 4 * 1024 * 1024, accept = /^image\/(jpeg|png|webp)$/, name = (req, f) => f.filename }) {
  return async (req, res, next) => {
    const ct = req.headers["content-type"] || "";
    const bm = ct.match(/boundary=("?)([^";]+)\1/);
    if (!/multipart\/form-data/.test(ct) || !bm) return res.status(400).json({ error: "envie como multipart/form-data" });
    let body;
    try { body = await rawBody(req, maxFiles * maxFileSize + 64 * 1024); } catch (e) { return res.status(413).json({ error: "arquivos grandes demais (máx. 4 MB por foto)" }); }
    const boundary = Buffer.from("--" + bm[2]);
    req.files = []; req.body = req.body || {};
    let pos = body.indexOf(boundary);
    while (pos !== -1) {
      let start = pos + boundary.length;
      if (body.slice(start, start + 2).toString() === "--") break;
      start += 2;
      const hdrEnd = body.indexOf("\r\n\r\n", start);
      if (hdrEnd === -1) break;
      const headers = body.slice(start, hdrEnd).toString();
      const nextB = body.indexOf(boundary, hdrEnd);
      if (nextB === -1) break; // parte sem boundary final: descarta
      const content = body.slice(hdrEnd + 4, nextB - 2);
      const nm = headers.match(/name="([^"]*)"/), fn = headers.match(/filename="([^"]*)"/), tm = headers.match(/Content-Type:\s*([^\r\n]+)/i);
      if (fn) {
        const mimetype = (tm ? tm[1] : "").trim();
        if (accept.test(mimetype) && isImage(content, mimetype) && content.length <= maxFileSize && req.files.length < maxFiles) {
          const ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[mimetype] || ".bin";
          const filename = name(req, { filename: fn[1], mimetype, ext });
          const p = path.join(destDir, filename);
          await fs.promises.writeFile(p, content);
          req.files.push({ filename, path: p, mimetype, size: content.length, originalname: fn[1] });
        }
      } else if (nm) req.body[nm[1]] = content.toString("utf8");
      pos = nextB;
    }
    next();
  };
}

/** Estáticos: HTML sem cache (sempre revalida), assets versionados (?v=) imutáveis, o resto revalida por ETag. */
function serveStatic(dir, { index = "index.html" } = {}) {
  const root = path.resolve(dir);
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let p = decodeURIComponent(req.path);
    if (p.endsWith("/")) p += index;
    const file = path.resolve(root, "." + p);
    if (!file.startsWith(root)) return next();
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return next();
      const cc = /\.html$/.test(file) ? "no-cache" : req.query.v ? "public, max-age=31536000, immutable" : /\.(mp3|mp4|png|jpg|webp|woff2)$/.test(file) ? "public, max-age=604800" : "public, max-age=0, must-revalidate";
      sendFile(req, res, file, { cacheControl: cc });
    });
  };
}

function createApp() {
  const router = new Router();
  const app = { router, use: (...a) => router.use(...a), get: (...a) => router.get(...a), post: (...a) => router.post(...a), delete: (...a) => router.delete(...a) };
  app.listen = (port, cb) => http.createServer((req, res) => {
    decorate(req, res);
    router.handle(req, res, "", (err) => {
      if (res.writableEnded) return;
      if (err) { console.error("[http]", err); return res.status(err.status || 500).json({ error: err.status ? err.message : "erro interno" }); }
      res.status(404).json({ error: "rota não encontrada" });
    });
  }).listen(port, cb);
  return app;
}

function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*(?:#.*)?$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  } catch { /* sem .env */ }
}

module.exports = { createApp, Router, json, multipart, serveStatic, loadEnv, sendFile };
