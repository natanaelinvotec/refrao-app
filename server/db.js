"use strict";
// Banco: SQLite embutido no Node (node:sqlite, Node >= 22.5). Zero dependência nativa.
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");
const config = require("./config");

fs.mkdirSync(config.dataDir, { recursive: true });
for (const d of ["tracks", "previews", "photos", "clips", "tmp"]) fs.mkdirSync(path.join(config.dataDir, d), { recursive: true });

const db = new DatabaseSync(path.join(config.dataDir, "refrao.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  whatsapp TEXT UNIQUE NOT NULL,
  name TEXT,
  plan TEXT DEFAULT 'free',            -- free | studio
  plan_renews_at INTEGER,
  credits INTEGER DEFAULT 0,           -- músicas liberadas sem pagar (indicações, studio)
  ref_code TEXT UNIQUE,
  referred_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  whatsapp TEXT,
  device_id TEXT,
  ip TEXT,
  nicho TEXT NOT NULL,
  nome TEXT NOT NULL,
  numero TEXT,
  perfil TEXT,
  recado TEXT,
  ritmo TEXT NOT NULL,
  voz TEXT,
  letra TEXT,
  titulo TEXT,
  style TEXT,
  provider_task_id TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED',   -- QUEUED | PENDING | TEXT_SUCCESS | FIRST_SUCCESS | SUCCESS | FAILED
  tracks TEXT DEFAULT '[]',                -- JSON [{id, audioUrl, streamUrl, imageUrl, duration, file, preview}]
  error TEXT,
  paid INTEGER DEFAULT 0,
  plan TEXT,
  has_clip INTEGER DEFAULT 0,
  slug TEXT UNIQUE,
  public_status TEXT DEFAULT 'private',    -- private | pending | approved
  plays INTEGER DEFAULT 0,
  recovery_sent INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_songs_status ON songs(status);
CREATE INDEX IF NOT EXISTS idx_songs_whatsapp ON songs(whatsapp);
CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id),
  track_index INTEGER DEFAULT 0,
  photos TEXT DEFAULT '[]',
  status TEXT DEFAULT 'WAITING',          -- WAITING (sem fotos) | QUEUED | RENDERING | DONE | FAILED
  file TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id),
  whatsapp TEXT NOT NULL,
  email TEXT,
  plan TEXT NOT NULL,
  bumps TEXT DEFAULT '[]',
  total INTEGER NOT NULL,                 -- centavos
  provider TEXT,
  provider_id TEXT,
  pix_code TEXT,
  pix_qr_url TEXT,
  status TEXT DEFAULT 'PENDING',          -- PENDING | PAID | EXPIRED
  expires_at INTEGER,
  paid_at INTEGER,
  checked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_song ON orders(song_id);
CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY,                  -- ex.: SIGA-7K3P
  pct INTEGER NOT NULL,                   -- desconto em %
  source TEXT NOT NULL,                   -- instagram | whatsapp | admin
  handle TEXT,                            -- @ do Instagram ou número do WhatsApp de quem ganhou
  max_uses INTEGER DEFAULT 1,
  uses INTEGER DEFAULT 0,
  used_by TEXT,                           -- último pedido que consumiu
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coupons_handle ON coupons(source, handle);
CREATE TABLE IF NOT EXISTS leads (   -- quem deixou e-mail/WhatsApp no checkout (vira lista de marketing)
  id TEXT PRIMARY KEY,
  email TEXT,
  whatsapp TEXT,
  nome TEXT,
  song_id TEXT,
  paid INTEGER DEFAULT 0,
  source TEXT DEFAULT 'checkout',
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_whatsapp ON leads(whatsapp);
CREATE TABLE IF NOT EXISTS inbox_seen (   -- ids de mensagens já tratadas (Instagram/WhatsApp reenviam webhooks)
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS otps (
  whatsapp TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tries INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  song_id TEXT,
  data TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_song ON events(song_id, type, created_at);
CREATE INDEX IF NOT EXISTS idx_clips_song ON clips(song_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_queue ON clips(created_at) WHERE status IN ('QUEUED','RENDERING');
CREATE INDEX IF NOT EXISTS idx_orders_pending ON orders(expires_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_songs_public ON songs(plays DESC, created_at DESC) WHERE public_status = 'approved';
CREATE INDEX IF NOT EXISTS idx_songs_device ON songs(device_id);
CREATE INDEX IF NOT EXISTS idx_songs_ip ON songs(ip);
CREATE INDEX IF NOT EXISTS idx_songs_user ON songs(user_id);
`);

// migrações leves para bancos já existentes
try { db.exec("ALTER TABLE orders ADD COLUMN checked_at INTEGER"); } catch { /* já existe */ }
try { db.exec("ALTER TABLE orders ADD COLUMN cupom TEXT"); } catch { /* já existe */ }
try { db.exec("ALTER TABLE orders ADD COLUMN desconto INTEGER DEFAULT 0"); } catch { /* já existe */ }

const now = () => Date.now();

// cache de statements: todo SQL do projeto é estático com placeholders `?`
const stmts = new Map();
function prep(sql) { let s = stmts.get(sql); if (!s) { s = db.prepare(sql); stmts.set(sql, s); } return s; }
function row(sql, ...params) { return prep(sql).get(...params); }
function rows(sql, ...params) { return prep(sql).all(...params); }
function run(sql, ...params) { return prep(sql).run(...params); }
function event(type, songId, data) { run("INSERT INTO events (type, song_id, data, created_at) VALUES (?,?,?,?)", type, songId || null, data ? JSON.stringify(data) : null, now()); }

// Normaliza uma linha de songs: JSON parse dos campos
function parseSong(s) { if (!s) return null; return { ...s, tracks: JSON.parse(s.tracks || "[]") }; }

module.exports = { db, row, rows, run, event, now, parseSong };
