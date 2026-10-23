// Cliente da API — todas as chamadas passam por aqui.
window.API = (function () {
  // chave de dono por música (vem do POST /api/songs) — fica só neste aparelho
  function keys() { try { return JSON.parse(localStorage.getItem("refrao:keys") || "{}"); } catch (e) { return {}; } }
  function saveKey(id, k) { const m = keys(); m[id] = k; try { localStorage.setItem("refrao:keys", JSON.stringify(m)); } catch (e) {} }
  async function req(method, url, body, opts = {}) {
    const headers = {};
    if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    const m = url.match(/\/api\/(?:songs|orders)\/([a-f0-9]{16,32})/);
    if (m) { const k = keys()[m[1]] || (url.indexOf("/orders/") >= 0 ? keys()[sessionStorage.getItem("refrao:orderSong:" + m[1])] : null); if (k) headers["X-Song-Key"] = k; }
    const r = await fetch(url, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "erro " + r.status); e.status = r.status; e.data = j; throw e; }
    return j;
  }
  const get = (u) => req("GET", u);
  const post = (u, b) => req("POST", u, b);
  return {
    config: () => get("/api/config"),
    stats: () => get("/api/stats"),
    mural: () => get("/api/mural"),
    lyrics: (p) => post("/api/lyrics", p),
    createSong: (p) => post("/api/songs", p).then((r) => { if (r.key) saveKey(r.songId, r.key); return r; }),
    saveKey,
    song: (id, t) => get(`/api/songs/${id}${t ? "?t=" + encodeURIComponent(t) : ""}`),
    photos: (id, files, track) => { const fd = new FormData(); files.forEach((f) => fd.append("photos", f)); fd.append("track", track || 0); return post(`/api/songs/${id}/photos`, fd); },
    clip: (id, track) => post(`/api/songs/${id}/clip`, { track }),
    saveWhatsapp: (id, whatsapp) => post(`/api/songs/${id}/whatsapp`, { whatsapp }),
    checkout: (p) => post("/api/checkout", p).then((o) => { try { sessionStorage.setItem("refrao:orderSong:" + o.orderId, p.songId); } catch (e) {} return o; }),
    order: (id) => get(`/api/orders/${id}`),
    devPay: (id) => post(`/api/dev/pay/${id}`),
    publish: (id) => post(`/api/songs/${id}/publish`, { consent: true }),
    pub: (slug) => get(`/api/public/${slug}`),
    pubPlay: (slug) => post(`/api/public/${slug}/play`),
    otp: (whatsapp) => post("/api/auth/otp", { whatsapp }),
    verify: (whatsapp, code) => post("/api/auth/verify", { whatsapp, code }),
    logout: () => post("/api/auth/logout"),
    me: () => get("/api/me"),
    admin: {
      login: (password) => post("/api/admin/login", { password }),
      stats: (range) => get("/api/admin/stats?range=" + range),
      songs: (q) => get("/api/admin/songs?q=" + encodeURIComponent(q || "")),
      orders: () => get("/api/admin/orders"),
      mural: () => get("/api/admin/mural"),
      muralSet: (id, approve) => post(`/api/admin/songs/${id}/mural`, { approve }),
      unlock: (id) => post(`/api/admin/songs/${id}/unlock`, {}),
      retry: (id) => post(`/api/admin/songs/${id}/retry`, {}),
      cupons: () => get("/api/admin/cupons"),
      cupomNovo: (b) => post("/api/admin/cupons", b)
    },
    cupom: (code, plan) => post("/api/cupom", { code, plan })
  };
})();
