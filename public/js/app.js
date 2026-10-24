/* ============================================================
   REFRÃO — app (versão clara) ligado à API
   Rotas: #/  #/criar  #/gerando/:id  #/previa/:id  #/checkout/:id
          #/musica/:id?t=  #/m/:slug  #/painel  #/admin
   ============================================================ */
(function () {
  "use strict";
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var brl = function (c) { return "R$ " + (c / 100).toFixed(2).replace(".", ","); };
  var fmtT = function (s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var ui = function (r) { return RITMO_UI[r] || RITMO_UI.pop; };

  // ---------- estado ----------
  var CFG = { brand: "Refrão", ritmos: [], planos: [], bumps: [], mock: false, cupom: { pct: 10, instagram: "refrao.app" } };
  // preço com o "de" riscado quando há promoção
  function precoHtml(p, sufixo) { return (p.de ? "<s class='de'>" + brl(p.de) + "</s>" : "") + brl(p.preco) + (sufixo || ""); }
  var RITMO_NOME = {};
  var KEY = "refrao:pedido:v1";
  var pedido = load() || novoPedido();
  function novoPedido() { return { nicho: "", nome: "", numero: "", perfil: "", recado: "", ritmo: "", voz: "fem", letra: "", titulo: "", step: 1 }; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(pedido)); } catch (e) {} }
  function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function deviceId() { try { var d = localStorage.getItem("refrao:device"); if (!d) { d = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("refrao:device", d); } return d; } catch (e) { return ""; } }
  function tokens() { try { return JSON.parse(localStorage.getItem("refrao:tokens") || "{}"); } catch (e) { return {}; } }
  function saveToken(id, t) { var m = tokens(); m[id] = t; try { localStorage.setItem("refrao:tokens", JSON.stringify(m)); } catch (e) {} }
  function fotosPendentes() { try { return JSON.parse(sessionStorage.getItem("refrao:fotos") || "{}"); } catch (e) { return {}; } }

  var toastT;
  function toast(msg) { var t = $("#toast"); t.textContent = msg; t.classList.add("is-on"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("is-on"); }, 2600); }
  function maskWpp(v) { var d = v.replace(/\D/g, "").slice(0, 11); return d.length > 7 ? "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7) : d.length > 2 ? "(" + d.slice(0, 2) + ") " + d.slice(2) : d; }
  function wppOk(v) { var d = v.replace(/\D/g, ""); return d.length === 10 || d.length === 11; }
  function fillWaves(el, n) { el.innerHTML = ""; for (var i = 0; i < n; i++) { var b = document.createElement("i"); var v = (14 + ((i * 37) % 70)) / 100; b.style.setProperty("--s", v); b.style.setProperty("--d", (i * 90) % 1400); b.style.transform = "scaleY(" + v + ")"; el.appendChild(b); } }

  // ============================================================
  //  ÁUDIO: amostras de ritmo (MP3 do servidor) com sintetizador de fallback
  // ============================================================
  var audio = { ctx: null, handle: null, el: null };
  function stopAll() {
    if (audio.handle) { audio.handle.stop(); audio.handle = null; }
    if (audio.el) { audio.el.pause(); audio.el = null; }
    $$(".is-playing").forEach(function (el) { el.classList.remove("is-playing"); });
  }
  function ctx() { if (!audio.ctx) audio.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (audio.ctx.state === "suspended") audio.ctx.resume(); return audio.ctx; }
  function synth(ritmoId, maxSeconds, onEnd) {
    var c = ctx(), r = ui(ritmoId), beat = 60 / r.bpm, scale = r.esc, base = 220;
    var master = c.createGain(); master.gain.value = 0.18; master.connect(c.destination);
    var step = 0, timer, stopped = false, start = c.currentTime;
    function note(freq, t, dur, type, vol) { var o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05); }
    function kick(t) { var o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.3); }
    function tick() {
      if (stopped) return;
      var t = c.currentTime + 0.05, half = beat / 2, root = [0, 5, 7, 5][Math.floor(step / 8) % 4];
      if (step % 2 === 0) kick(t);
      if (step % 4 === 0) [0, 4, 7].forEach(function (iv) { note(base / 2 * Math.pow(2, (root + iv) / 12), t, beat * 1.6, "sawtooth", 0.12); });
      if (step % 2 === 0) note(base / 4 * Math.pow(2, root / 12), t, half, "square", 0.25);
      note(base * 2 * Math.pow(2, (root + scale[(step * 3 + Math.floor(step / 4)) % scale.length]) / 12), t, half * 0.9, "triangle", 0.35);
      step++;
      if (c.currentTime - start > maxSeconds) { handle.stop(); if (onEnd) onEnd(); return; }
      timer = setTimeout(tick, half * 1000);
    }
    var handle = { stop: function () { stopped = true; clearTimeout(timer); master.gain.setTargetAtTime(0, c.currentTime, 0.05); setTimeout(function () { master.disconnect(); }, 300); } };
    tick(); return handle;
  }
  var sampleCache = {};
  // toca a amostra MP3 direto (sem HEAD antes); se não existir, cai no sintetizador
  function playSample(ritmoId, maxSeconds, onEnd) {
    if (sampleCache[ritmoId] === false) { audio.handle = synth(ritmoId, maxSeconds, onEnd); return; }
    var el = new Audio("/api/samples/" + ritmoId); el.volume = 0.9; audio.el = el; el.onended = onEnd;
    el.onerror = function () { sampleCache[ritmoId] = false; if (audio.el === el) { audio.el = null; audio.handle = synth(ritmoId, maxSeconds, onEnd); } };
    el.play().catch(function () {});
    setTimeout(function () { if (audio.el === el) { el.pause(); if (onEnd) onEnd(); } }, maxSeconds * 1000);
  }
  function bindSample(btn, ritmo, waves, max) {
    btn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var was = btn.classList.contains("is-playing"); stopAll(); if (was) return;
      btn.classList.add("is-playing"); if (waves) waves.classList.add("is-playing");
      playSample(typeof ritmo === "function" ? ritmo() : ritmo, max || 10, function () { btn.classList.remove("is-playing"); if (waves) waves.classList.remove("is-playing"); });
    });
  }

  // ============================================================
  //  ROTEADOR
  // ============================================================
  var views = {};
  function route() {
    stopAll();
    var h = location.hash.replace(/^#\/?/, ""), q = {};
    var qi = h.indexOf("?"); if (qi >= 0) { h.slice(qi + 1).split("&").forEach(function (kv) { var p = kv.split("="); q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ""); }); h = h.slice(0, qi); }
    var parts = h.split("/"), view = parts[0] || "landing", arg = parts[1] || "";
    if (view === "m") view = "publica";
    if (!$$(".view").some(function (v) { return v.dataset.view === view; })) view = "landing";
    $$(".view").forEach(function (v) { v.classList.toggle("is-on", v.dataset.view === view); });
    $$(".topnav a").forEach(function (a) { a.classList.toggle("is-on", a.getAttribute("href") === "#/" + (view === "landing" ? "" : view)); });
    if (views[view]) views[view](arg, q);
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  function go(h) { location.hash = h; }

  // ============================================================
  //  LANDING
  // ============================================================
  // ---------- a capa viva ----------
  var heroRitmo = "forro";
  function setCover(nome, ritmoId) {
    $("#coverTitle").textContent = nome || "Seu nome";
    $("#coverSub").textContent = (RITMO_NOME[ritmoId] || ritmoId).toLowerCase() + " · 2:48";
    $(".sleeve-name").style.color = ui(ritmoId).cor;
    var dl = $(".disc-label"); if (dl) { dl.style.background = ui(ritmoId).cor; $(".disc-label-name").textContent = nome || "Dona Cida"; $(".disc-label-sub").textContent = (RITMO_NOME[ritmoId] || ritmoId).toLowerCase() + " · versão 1 · 2:48"; }
    $$("#heroRitmos button").forEach(function (b) { b.classList.toggle("is-on", b.dataset.id === ritmoId); });
  }
  var DISC_COPY = {
    pessoa: ["Duas versões, você escolhe", "A mesma letra gravada de dois jeitos. Ouve as duas inteiras, com marca d'água, e leva a que mais gostar. Não gostou de nenhuma? Refazemos uma vez sem custo."],
    empresa: ["O jingle que o cliente repete", "Nome do negócio no refrão, endereço e promoção na letra. Toca no delivery, no carro de som e no Status, com o clipe das fotos da loja."],
    candidato: ["Nome e número no refrão", "Jingle de campanha com o slogan e a cidade, em forró, piseiro ou axé. Licença de uso eleitoral incluída no recibo."]
  };
  function initLanding() {
    var box = $("#heroRitmos"); box.innerHTML = "";
    ["forro", "sertanejo", "pagode", "piseiro", "funk", "gospel"].forEach(function (id) {
      var b = document.createElement("button"); b.type = "button"; b.dataset.id = id; b.innerHTML = '<i style="--c:' + ui(id).cor + '"></i>' + esc(RITMO_NOME[id] || id);
      b.addEventListener("click", function () { heroRitmo = id; setCover($("#heroNome").value.trim(), id); if ($("#heroPlay").classList.contains("is-playing")) { stopAll(); $("#heroPlay").click(); } });
      box.appendChild(b);
    });
    fillWaves($("#heroWaves"), 40); setCover("", heroRitmo);
    $("#heroNome").addEventListener("input", function () { setCover(this.value.trim(), heroRitmo); });
    bindSample($("#heroPlay"), function () { return heroRitmo; }, $("#heroWaves"), 12);
    $("#heroPlay").addEventListener("click", function () { var d = $(".disc"); if (d) d.classList.toggle("is-spinning", this.classList.contains("is-playing")); });
    $("#heroForm").addEventListener("submit", function (e) { e.preventDefault(); var nome = $("#heroNome").value.trim(); if (!nome) return; pedido = novoPedido(); pedido.nome = nome; pedido.ritmo = heroRitmo; save(); go("#/criar"); });
    // o primeiro passo do produto, já aberto no fecho da página
    var nb = $("#nichosLanding"); nb.innerHTML = "";
    NICHOS.forEach(function (n, i) { var a = document.createElement("a"); a.href = "#/criar"; a.setAttribute("data-part", ""); a.style.setProperty("--i", i); a.innerHTML = '<strong>' + n.titulo + '</strong><span>' + n.sub + '</span>'; a.addEventListener("click", function () { pedido = novoPedido(); pedido.nicho = n.id; pedido.step = 2; save(); }); nb.appendChild(a); });
    // os ingressos
    var pb = $("#planosLanding"); pb.innerHTML = "";
    var itens = { musica: ["2 versões completas em MP3", "sem marca d'água", "letra e página pública", "licença de uso comercial"], clipe: ["tudo da Música", "clipe 9:16 com suas fotos", "pronto na hora, sem editor", "Reels, Status e TikTok"], studio: ["4 músicas por mês", "clipes ilimitados", "vinhetas e trilhas curtas", "pra negócios e criadores"] };
    CFG.planos.forEach(function (p) {
      var d = document.createElement("div"); d.className = "ticket" + (p.id === "clipe" ? " is-destaque" : p.id === "studio" ? " is-ink" : ""); d.setAttribute("data-reveal", "");
      d.innerHTML = "<div class='ticket-main'><h3>" + esc(p.nome) + "</h3><ul>" + (itens[p.id] || []).map(function (i) { return "<li>" + i + "</li>"; }).join("") + "</ul></div><div class='ticket-stub'><div class='ticket-price'>" + precoHtml(p, p.mensal ? "<small>/mês</small>" : "") + (p.de ? "<span class='promo-tag'>promoção</span>" : "") + "</div><a href='#/criar' class='btn " + (p.id === "studio" ? "btn-brasa" : "btn-ink") + "'>" + (p.mensal ? "assinar" : "começar grátis") + "</a></div>";
      pb.appendChild(d);
    });
    if (CFG.cupom) {
      var ig = "https://instagram.com/" + CFG.cupom.instagram;
      $("#sigaPct").textContent = CFG.cupom.pct + "%"; $("#sigaLink").textContent = "@" + CFG.cupom.instagram; $("#sigaLink").href = ig; $("#sigaBtn").href = ig;
      $("#cupomIg").textContent = "@" + CFG.cupom.instagram; $("#cupomIg").href = ig; $$(".cupomPct").forEach(function (e) { e.textContent = CFG.cupom.pct + "%"; });
    }
    if (CFG.support) { var s = $("#supportLink"); s.textContent = "WhatsApp +" + CFG.support; s.href = "https://wa.me/" + CFG.support; }
    API.stats().then(function (s) { $("#statMusicas").textContent = (s.musicas || 0).toLocaleString("pt-BR"); }).catch(function () { $("#statMusicas").textContent = "muitas"; });
    $$("#discTabs button").forEach(function (b) { b.addEventListener("click", function () { $$("#discTabs button").forEach(function (x) { x.classList.toggle("is-on", x === b); }); var c = DISC_COPY[b.dataset.tab]; $("#discTitle").textContent = c[0]; $("#discDesc").textContent = c[1]; }); });
    // fichas: uma aberta por vez
    $$("#faqCards details").forEach(function (d) { d.addEventListener("toggle", function () { if (d.open) $$("#faqCards details").forEach(function (o) { if (o !== d) o.open = false; }); }); });
    revealObserve();
  }
  // entradas das seções, uma vez, só quando entram na tela
  function revealObserve() {
    var targets = $$("[data-reveal]:not(.is-in)");
    if (!("IntersectionObserver" in window)) return targets.forEach(function (el) { el.classList.add("is-in"); });
    var io = new IntersectionObserver(function (entries) { entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }); }, { rootMargin: "0px 0px -12% 0px", threshold: 0.1 });
    targets.forEach(function (el) { io.observe(el); });
    setTimeout(function () { targets.forEach(function (el) { var r = el.getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) el.classList.add("is-in"); }); }, 2500);
  }
  views.landing = function () {
    API.mural().then(function (list) {
      var box = $("#muralLanding"); box.innerHTML = "";
      if (!list.length) { box.innerHTML = '<p class="mural-vazio">O mural começa vazio de propósito: aqui entram só músicas de clientes que autorizaram. A primeira pode ser a sua.</p>'; return; }
      list.forEach(function (m, i) {
        var a = document.createElement("a"); a.href = "#/m/" + m.slug; a.className = "mural-item s" + ((i % 4) + 1); a.setAttribute("data-reveal", "");
        a.innerHTML = '<div class="thumb" style="--c:' + ui(m.ritmo).cor + '"><strong>' + esc(m.titulo || m.nome) + '</strong><button type="button" class="mini-play" aria-label="ouvir"><span class="ico-play"></span></button></div><div class="strip"><div><span>' + esc(m.ritmoNome) + '</span><span>' + (m.plays || 0).toLocaleString("pt-BR") + ' plays</span></div><div><span>2 versões</span><span>com clipe</span></div></div>';
        var btn = $(".mini-play", a);
        btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); var was = btn.classList.contains("is-playing"); stopAll(); if (was) return; btn.classList.add("is-playing"); var el = new Audio(m.previewUrl); audio.el = el; el.play(); el.onended = function () { btn.classList.remove("is-playing"); }; setTimeout(function () { if (audio.el === el) { el.pause(); btn.classList.remove("is-playing"); } }, 20000); });
        box.appendChild(a);
      });
      revealObserve();
    }).catch(function () {});
  };

  // ============================================================
  //  CRIAR (passos 1–4)
  // ============================================================
  function showStep(n) {
    pedido.step = n; save();
    $$(".step").forEach(function (s) { s.classList.toggle("is-on", +s.dataset.step === n); });
    $("#progress span").style.width = (n / 6 * 100) + "%";
    if (n === 1) renderStep1(); if (n === 2) renderStep2(); if (n === 3) renderStep3(); if (n === 4) renderStep4();
    window.scrollTo(0, 0);
  }
  views.criar = function () { showStep(pedido.step || 1); };

  function renderStep1() {
    var box = $("#tilesNicho"); box.innerHTML = "";
    NICHOS.forEach(function (n) {
      var b = document.createElement("button"); b.type = "button"; b.className = "tile" + (pedido.nicho === n.id ? " is-on" : "");
      b.innerHTML = '<i style="--c:' + n.cor + '"></i><div><strong>' + n.titulo + '</strong><span>' + n.sub + '</span></div>';
      b.addEventListener("click", function () { if (pedido.nicho !== n.id) { pedido.perfil = ""; pedido.letra = ""; } pedido.nicho = n.id; showStep(2); });
      b.style.setProperty("--i", NICHOS.indexOf(n)); box.appendChild(b);
    });
  }
  function renderStep2() {
    var c = COPY[pedido.nicho] || COPY.pessoa;
    $("#quemTitulo").textContent = c.t; $("#quemSub").textContent = c.s; $("#perfilTitulo").textContent = c.p;
    $("#fieldNumero").hidden = pedido.nicho !== "candidato";
    $("#inNome").value = pedido.nome; $("#inNumero").value = pedido.numero;
    var box = $("#chipsPerfil"); box.innerHTML = "";
    (PERFIS[pedido.nicho] || []).forEach(function (p) { var b = document.createElement("button"); b.type = "button"; b.className = "chip" + (pedido.perfil === p ? " is-on" : ""); b.textContent = p; b.addEventListener("click", function () { pedido.perfil = p; $$(".chip", box).forEach(function (x) { x.classList.toggle("is-on", x === b); }); validar2(); }); box.appendChild(b); });
    validar2();
  }
  function validar2() { pedido.nome = $("#inNome").value.trim(); pedido.numero = $("#inNumero").value.replace(/\D/g, ""); save(); $("#btnStep2").disabled = !(pedido.nome && pedido.perfil); }
  $("#inNome").addEventListener("input", validar2); $("#inNumero").addEventListener("input", validar2);
  $("#btnStep2").addEventListener("click", function () { showStep(3); });

  function renderStep3() {
    var c = COPY[pedido.nicho] || COPY.pessoa;
    $("#recadoTitulo").textContent = c.r.replace("{n}", pedido.nome || "essa pessoa");
    $("#inRecado").value = pedido.recado; contar();
    var st = $("#chipsStarter"); st.innerHTML = "";
    c.starters.forEach(function (s) { var b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = s.trim() + "…"; b.addEventListener("click", function () { var ta = $("#inRecado"), v = ta.value.trim(); ta.value = (v ? v.replace(/[.,;]$/, "") + ". " : "") + s; ta.focus(); contar(); }); st.appendChild(b); });
    renderRitmos(false);
    var vz = $("#chipsVoz"); vz.innerHTML = "";
    VOZES.forEach(function (v) { var b = document.createElement("button"); b.type = "button"; b.className = "chip" + (pedido.voz === v.id ? " is-on" : ""); b.textContent = v.nome; b.addEventListener("click", function () { pedido.voz = v.id; $$(".chip", vz).forEach(function (x) { x.classList.toggle("is-on", x === b); }); save(); }); vz.appendChild(b); });
    validar3();
  }
  function renderRitmos(todos) {
    var box = $("#listaRitmos"); box.innerHTML = "";
    var sug = RITMO_POR_NICHO[pedido.nicho] || RITMO_POR_NICHO.pessoa;
    var lista = CFG.ritmos.filter(function (r) { return todos || sug.indexOf(r.id) >= 0 || r.id === pedido.ritmo; }).sort(function (a, b) { var ia = sug.indexOf(a.id), ib = sug.indexOf(b.id); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    lista.forEach(function (r) {
      var d = document.createElement("div"); d.className = "ritmo" + (pedido.ritmo === r.id ? " is-on" : ""); d.setAttribute("role", "button"); d.tabIndex = 0;
      d.innerHTML = '<i style="--c:' + ui(r.id).cor + '"></i><span class="nome">' + esc(r.nome) + '</span><button type="button" class="mini-play" aria-label="ouvir ' + esc(r.nome) + '"><span class="ico-play"></span></button>';
      var pick = function () { pedido.ritmo = r.id; pedido.letra = ""; $$(".ritmo", box).forEach(function (x) { x.classList.toggle("is-on", x === d); }); validar3(); };
      d.addEventListener("click", pick); d.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
      bindSample($(".mini-play", d), r.id, null, 8);
      box.appendChild(d);
    });
    if (!todos) { var m = document.createElement("button"); m.type = "button"; m.className = "more"; m.textContent = "ver todos os ritmos"; m.addEventListener("click", function () { renderRitmos(true); }); box.appendChild(m); }
  }
  function contar() { var ta = $("#inRecado"); $("#recadoCount").textContent = ta.value.length + "/500"; pedido.recado = ta.value; validar3(); }
  function validar3() { save(); $("#btnStep3").disabled = !(pedido.recado.trim() && pedido.ritmo); }
  $("#inRecado").addEventListener("input", contar);
  // ditado por voz (Web Speech API; cai em aviso se o navegador não tiver)
  $("#btnMic").addEventListener("click", function () {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition, b = this;
    if (!SR) return toast("seu navegador não tem ditado por voz; escreva o recado");
    if (b._rec) { b._rec.stop(); return; }
    var rec = new SR(); rec.lang = "pt-BR"; rec.interimResults = false; rec.maxAlternatives = 1; b._rec = rec; b.classList.add("is-rec");
    rec.onresult = function (e) { var ta = $("#inRecado"), txt = e.results[0][0].transcript; ta.value = (ta.value.trim() ? ta.value.trim() + " " : "") + txt; contar(); };
    rec.onerror = function () { toast("não consegui ouvir, tente de novo"); };
    rec.onend = function () { b.classList.remove("is-rec"); b._rec = null; };
    rec.start();
  });
  $("#btnStep3").addEventListener("click", function () { showStep(4); });

  var letraBusy = false;
  function renderStep4() {
    $("#letraRitmo").textContent = (RITMO_NOME[pedido.ritmo] || "").toLowerCase() + " · " + (VOZES.find(function (v) { return v.id === pedido.voz; }) || {}).nome;
    $("#erroStep4").hidden = true;
    $("#inLetra").value = pedido.letra || "";
    if (!pedido.letra) escreverLetra();
  }
  function escreverLetra() {
    if (letraBusy) return; letraBusy = true;
    $("#inLetra").value = ""; $("#inLetra").placeholder = "escrevendo a letra..."; $("#btnStep4").disabled = true; $("#btnOutraLetra").disabled = true;
    API.lyrics({ nicho: pedido.nicho, nome: pedido.nome, numero: pedido.numero, perfil: pedido.perfil, recado: pedido.recado, ritmo: pedido.ritmo, voz: pedido.voz })
      .then(function (r) { pedido.letra = r.letra; pedido.titulo = r.titulo; save(); $("#inLetra").value = r.letra; })
      .catch(function (e) { $("#erroStep4").textContent = e.message; $("#erroStep4").hidden = false; })
      .finally(function () { letraBusy = false; $("#btnStep4").disabled = false; $("#btnOutraLetra").disabled = false; });
  }
  $("#inLetra").addEventListener("input", function () { pedido.letra = this.value; save(); });
  $("#btnOutraLetra").addEventListener("click", function () { pedido.letra = ""; escreverLetra(); });
  $("#btnStep4").addEventListener("click", function () {
    if (!pedido.letra.trim()) return toast("a letra ainda não ficou pronta");
    var b = this; b.disabled = true; b.textContent = "enviando pro estúdio...";
    API.createSong({ nicho: pedido.nicho, nome: pedido.nome, numero: pedido.numero, perfil: pedido.perfil, recado: pedido.recado, ritmo: pedido.ritmo, voz: pedido.voz, letra: pedido.letra, titulo: pedido.titulo, deviceId: deviceId() })
      .then(function (r) { pedido.step = 1; save(); go("#/gerando/" + r.songId); })
      .catch(function (e) {
        if (e.data && e.data.code === "PREVIEW_LIMIT" && e.data.lastSongId) { toast(e.message); go("#/checkout/" + e.data.lastSongId); return; }
        $("#erroStep4").textContent = e.message; $("#erroStep4").hidden = false;
      })
      .finally(function () { b.disabled = false; b.textContent = "gravar a música"; });
  });

  // ============================================================
  //  GERANDO (polling) + fotos do clipe
  // ============================================================
  var gerT, gerId;
  var PCT = { QUEUED: 8, PENDING: 22, TEXT_SUCCESS: 52, FIRST_SUCCESS: 96, SUCCESS: 100 };
  views.gerando = function (id) {
    clearTimeout(gerT); gerId = id;
    $("#gerandoErro").hidden = true; $("#btnGerandoVoltar").hidden = true;
    var t0 = Date.now(), i = 0;
    renderFotos(id, (fotosPendentes()[id] || 0));
    (function loop() {
      API.song(id).then(function (s) {
        if (gerId !== id) return;
        var f = LOADING[i++ % LOADING.length];
        $("#gerandoTitulo").textContent = f[0].replace("{n}", s.nome); $("#gerandoSub").textContent = f[1].replace("{n}", s.nome);
        var pct = Math.min(PCT[s.status] || 10, Math.max(PCT[s.status] ? PCT[s.status] - 10 : 6, (Date.now() - t0) / 180000 * 90));
        if (s.ready) pct = 100;
        $("#gerandoBar").style.width = pct + "%"; $("#gerandoPct").textContent = Math.round(pct) + "%";
        if (s.status === "FAILED") { $("#gerandoErro").textContent = s.error || "não deu pra gerar a música. tente de novo."; $("#gerandoErro").hidden = false; $("#btnGerandoVoltar").hidden = false; return; }
        if (s.ready) { setTimeout(function () { if (gerId === id) go("#/previa/" + id); }, 600); return; }
        if (Date.now() - t0 > 15 * 60000) { $("#gerandoErro").textContent = "o estúdio está demorando mais que o normal. assim que ficar pronta, a prévia chega no seu WhatsApp."; $("#gerandoErro").hidden = false; return; }
        gerT = setTimeout(loop, 4000);
      }).catch(function () { gerT = setTimeout(loop, 5000); });
    })();
  };
  $("#btnGerandoVoltar").addEventListener("click", function () { go("#/criar"); showStep(4); });
  var thumbs = {};
  function renderFotos(id, n) {
    var g = $("#fotosGrid"); g.innerHTML = "";
    var th = thumbs[id] || [];
    for (var i = 0; i < 8; i++) { var d = document.createElement("div"); if (i >= n) d.className = "vazio"; else if (th[i]) d.style.backgroundImage = "url(" + th[i] + ")"; g.appendChild(d); }
    $("#btnAddFoto").textContent = n ? "+ adicionar mais (" + n + "/8)" : "+ adicionar fotos";
  }
  // reduz a foto no aparelho antes de subir (o clipe é 720×1280; 8 fotos de câmera dariam 40 MB)
  function encolher(file, max) {
    max = max || 1700;
    if (!window.createImageBitmap) return Promise.resolve(file);
    return createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bmp) {
      var k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (k === 1 && file.size < 600 * 1024) { bmp.close(); return file; }
      var c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
      return new Promise(function (ok) { c.toBlob(function (b) { ok(b ? new File([b], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file); }, "image/jpeg", 0.85); });
    }).catch(function () { return file; });
  }
  function subirFotos(id, files, done) {
    if (!files.length) return;
    thumbs[id] = (thumbs[id] || []).concat(files.map(function (f) { return URL.createObjectURL(f); })).slice(0, 8);
    toast("enviando " + files.length + " foto" + (files.length > 1 ? "s" : "") + "...");
    Promise.all(files.map(function (f) { return encolher(f); })).then(function (small) { return API.photos(id, small, 0); }).then(function (r) { var m = fotosPendentes(); m[id] = r.photos; sessionStorage.setItem("refrao:fotos", JSON.stringify(m)); toast(r.photos + " foto" + (r.photos > 1 ? "s" : "") + " no clipe"); if (done) done(r.photos); }).catch(function (e) { toast(e.message); });
  }
  $("#btnAddFoto").addEventListener("click", function () { $("#inFotos").click(); });
  $("#inFotos").addEventListener("change", function () { var files = Array.prototype.slice.call(this.files, 0, 8); this.value = ""; subirFotos(gerId, files, function (n) { renderFotos(gerId, n); }); });

  // ============================================================
  //  PRÉVIA
  // ============================================================
  var prev = { song: null, v: 0, el: null, id: "" };
  views.previa = function (id) {
    prev.id = id; prev.v = 0;
    API.song(id).then(function (s) {
      if (!s.ready) { toast("a música ainda está sendo gravada"); go("#/gerando/" + id); return; }
      prev.song = s; renderPreview();
    }).catch(function (e) { toast(e.message); go("#/"); });
  };
  function renderPreview() {
    var s = prev.song, t = s.tracks[prev.v] || s.tracks.filter(Boolean)[0];
    $("#previewTitulo").textContent = s.titulo || s.nome; $("#previewSub").textContent = (s.ritmoNome || "").toLowerCase() + " · " + fmtT(t ? t.duration : 0) + " · versão " + (prev.v + 1);
    $("#previewCover").style.setProperty("--accent", ui(s.ritmo).cor === "#1B1230" ? "#FFC247" : ui(s.ritmo).cor);
    $("#previewLetra").textContent = s.letra || "";
    var vs = $("#versoes"); vs.innerHTML = "";
    [0, 1].forEach(function (i) { var b = document.createElement("button"); b.type = "button"; b.className = "versao" + (prev.v === i ? " is-on" : ""); b.disabled = !s.tracks[i]; b.textContent = s.tracks[i] ? "versão " + (i + 1) : "versão " + (i + 1) + " saindo..."; b.addEventListener("click", function () { stopAll(); prev.v = i; renderPreview(); }); vs.appendChild(b); });
    fillWaves($("#previewWaves"), 48);
    var n = (s.clip && s.clip.photos) || fotosPendentes()[s.id] || 0;
    $("#clipeMini").hidden = !n; $("#previaAddFotos").hidden = !!n; $("#clipeFotos").textContent = n; $("#clipeLegenda").textContent = s.nome + ", hoje é o seu dia";
    var plano = CFG.planos.find(function (p) { return p.id === (n ? "clipe" : "musica"); });
    $("#btnCheckout").textContent = "quero a música completa · " + (plano ? brl(plano.preco) : "") + (plano && plano.de ? " (era " + brl(plano.de) + ")" : "");
    $("#tCur").textContent = "0:00"; $("#tDur").textContent = fmtT(t ? t.duration : 0); $("#previewSeek").value = 0;
    if (t) prepararPreview(t); // já bufferiza antes do toque
    if (!s.tracks[1]) setTimeout(function () { if (prev.id === s.id) API.song(s.id).then(function (x) { if (prev.id === s.id && x.tracks[1] && !prev.song.tracks[1]) { prev.song = x; renderPreview(); } }); }, 6000);
  }
  var seeking = false;
  function prepararPreview(t) {
    if (audio.el && audio.el._track === t.previewUrl) return audio.el;
    stopAll();
    var b = $("#previewPlay"), el = new Audio(); el.preload = "auto"; el._track = t.previewUrl; el.src = t.previewUrl; audio.el = el;
    el.ontimeupdate = function () { if (seeking) return; $("#tCur").textContent = fmtT(el.currentTime); if (el.duration) $("#previewSeek").value = el.currentTime / el.duration * 100; };
    el.onloadedmetadata = function () { $("#tDur").textContent = fmtT(el.duration); };
    el.onended = function () { b.classList.remove("is-playing"); $("#previewWaves").classList.remove("is-playing"); };
    el.onerror = function () { toast("não deu pra carregar a prévia — toque de novo"); b.classList.remove("is-playing"); };
    return el;
  }
  $("#previewPlay").addEventListener("click", function () {
    var b = this, s = prev.song; if (!s) return;
    var t = s.tracks[prev.v]; if (!t) return;
    var el = prepararPreview(t);
    if (!el.paused) { el.pause(); b.classList.remove("is-playing"); $("#previewWaves").classList.remove("is-playing"); return; }
    el.play().then(function () { b.classList.add("is-playing"); $("#previewWaves").classList.add("is-playing"); }).catch(function () {});
  });
  // arrastando só mostra o tempo; o seek (1 request) acontece ao soltar
  $("#previewSeek").addEventListener("input", function () { seeking = true; if (audio.el && audio.el.duration) $("#tCur").textContent = fmtT(this.value / 100 * audio.el.duration); });
  $("#previewSeek").addEventListener("change", function () { seeking = false; if (audio.el && audio.el.duration) audio.el.currentTime = this.value / 100 * audio.el.duration; });
  $("#btnAddFoto2").addEventListener("click", function () { $("#inFotos2").click(); });
  $("#inFotos2").addEventListener("change", function () { var files = Array.prototype.slice.call(this.files, 0, 8); this.value = ""; subirFotos(prev.id, files, function () { API.song(prev.id).then(function (s) { prev.song = s; renderPreview(); }); }); });
  $("#btnCheckout").addEventListener("click", function () { go("#/checkout/" + prev.id); });
  $("#btnGuardar").addEventListener("click", function () {
    var w = prompt("Seu WhatsApp com DDD (a prévia e o link chegam lá):"); if (!w) return;
    if (!wppOk(w)) return toast("número inválido, use DDD + número");
    API.saveWhatsapp(prev.id, w).then(function () { toast("prévia enviada pro seu WhatsApp"); }).catch(function (e) { toast(e.message); });
  });

  // ============================================================
  //  CHECKOUT + PIX
  // ============================================================
  var ck = { id: "", song: null, plan: "musica", bumps: [], order: null, pollT: null, timerT: null, cupom: null };
  views.checkout = function (id) {
    ck.id = id; ck.bumps = []; ck.order = null; ck.cupom = null; $("#inCupom").value = ""; $("#cupomOk").hidden = true; $("#cupomBox").classList.remove("is-on"); $("#erroCheckout").hidden = true; $("#pixModal").hidden = true;
    API.song(id).then(function (s) {
      ck.song = s;
      var n = (s.clip && s.clip.photos) || fotosPendentes()[s.id] || 0;
      ck.plan = n ? "clipe" : "musica";
      $("#checkoutTitulo").textContent = (s.titulo || s.nome) + " · " + (s.ritmoNome || "").toLowerCase();
      $("#checkoutThumb").style.background = ui(s.ritmo).cor;
      try { var w = localStorage.getItem("refrao:wpp"); if (w) $("#inWpp").value = w; var em0 = localStorage.getItem("refrao:email"); if (em0) $("#inEmail").value = em0; } catch (e) {}
      renderCheckout();
    }).catch(function (e) { toast(e.message); go("#/"); });
  };
  // o cupom desconta só o plano (nunca os extras) e só nos planos que aceitam cupom — igual ao servidor
  function descontoCk() { var p = CFG.planos.find(function (x) { return x.id === ck.plan; }); if (!p || !ck.cupom || !p.cupom) return 0; return p.preco - Math.floor(p.preco * (100 - ck.cupom.pct) / 100); }
  function totalCk() { var p = CFG.planos.find(function (x) { return x.id === ck.plan; }); var t = p ? p.preco - descontoCk() : 0; ck.bumps.forEach(function (id) { var b = CFG.bumps.find(function (x) { return x.id === id; }); if (b && !(id === "clipe" && p && p.clipe)) t += b.preco; }); return t; }
  function renderCheckout() {
    var pp = $("#planoPick"); pp.innerHTML = "";
    var sub = { musica: "2 versões em MP3 · sem marca d'água", clipe: "tudo da Música + clipe 9:16 com suas fotos", studio: "4 músicas por mês · clipes ilimitados" };
    CFG.planos.forEach(function (p) {
      var b = document.createElement("button"); b.type = "button"; b.className = "pick" + (ck.plan === p.id ? " is-on" : "");
      b.innerHTML = "<div><strong>" + esc(p.nome) + "</strong><span>" + (sub[p.id] || "") + "</span></div><span class='valor'>" + precoHtml(p, p.mensal ? "/mês" : "") + "</span>";
      b.addEventListener("click", function () { ck.plan = p.id; if (p.clipe) ck.bumps = ck.bumps.filter(function (x) { return x !== "clipe"; }); renderCheckout(); });
      pp.appendChild(b);
    });
    var plano = CFG.planos.find(function (x) { return x.id === ck.plan; });
    var bb = $("#bumps"); bb.innerHTML = "";
    var desc = { versoes: "mais duas interpretações do mesmo recado", urgente: "arquivo final e clipe direto no seu número", clipe: "sobe até 8 fotos e o clipe sai junto com a música" };
    CFG.bumps.forEach(function (b) {
      if (b.id === "clipe" && plano && plano.clipe) return;
      var on = ck.bumps.indexOf(b.id) >= 0;
      var l = document.createElement("label"); l.className = "bump" + (on ? " is-on" : "");
      l.innerHTML = '<input type="checkbox"' + (on ? " checked" : "") + '><div><strong>' + esc(b.nome) + '</strong><span>' + (desc[b.id] || "") + '</span></div><span class="valor">+ ' + brl(b.preco) + '</span>';
      $("input", l).addEventListener("change", function () { if (this.checked) ck.bumps.push(b.id); else ck.bumps = ck.bumps.filter(function (x) { return x !== b.id; }); renderCheckout(); });
      bb.appendChild(l);
    });
    var d = descontoCk(); $("#descontoPix").hidden = !d; if (d) $("#descontoPix").textContent = "cupom " + ck.cupom.code + ": − " + brl(d);
    if (ck.cupom && plano && !plano.cupom) { $("#cupomOk").textContent = "o cupom não vale no plano " + plano.nome; $("#cupomOk").hidden = false; }
    else if (ck.cupom) { $("#cupomOk").textContent = "cupom " + ck.cupom.code + " aplicado: " + ck.cupom.pct + "% na música"; $("#cupomOk").hidden = false; }
    $("#totalPix").textContent = brl(totalCk());
  }
  $("#btnCupom").addEventListener("click", function () {
    var code = $("#inCupom").value.trim().toUpperCase(); if (!code) { $("#inCupom").focus(); return; }
    var b = this; b.disabled = true;
    API.cupom(code, ck.plan).then(function (v) { ck.cupom = v; $("#cupomBox").classList.add("is-on"); toast("cupom aplicado!"); renderCheckout(); })
      .catch(function (e) { ck.cupom = null; $("#cupomBox").classList.remove("is-on"); $("#cupomOk").hidden = true; $("#descontoPix").hidden = true; toast(e.message); renderCheckout(); })
      .finally(function () { b.disabled = false; });
  });
  $("#inCupom").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); $("#btnCupom").click(); } });
  $("#inWpp").addEventListener("input", function () { this.value = maskWpp(this.value); });
  $("#btnPix").addEventListener("click", function () {
    var w = $("#inWpp").value; if (!wppOk(w)) { toast("coloque seu WhatsApp com DDD"); $("#inWpp").focus(); return; }
    var em = $("#inEmail").value.trim();
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { toast("coloque seu e-mail: a música vai pra sua caixa de entrada"); $("#inEmail").focus(); return; }
    try { localStorage.setItem("refrao:email", em); } catch (e) {}
    try { localStorage.setItem("refrao:wpp", w); } catch (e) {}
    var b = this; b.disabled = true; b.textContent = "gerando PIX...";
    API.checkout({ songId: ck.id, plan: ck.plan, bumps: ck.bumps, whatsapp: w, email: $("#inEmail").value.trim(), cupom: ck.cupom ? ck.cupom.code : "" })
      .then(function (o) { ck.order = o; abrirPix(o); })
      .catch(function (e) { $("#erroCheckout").textContent = e.message; $("#erroCheckout").hidden = false; })
      .finally(function () { b.disabled = false; b.textContent = "gerar PIX"; });
  });
  function abrirPix(o) {
    $("#pixModal").hidden = false;
    var qr = $("#pixQr"); qr.innerHTML = o.qrBase64 ? '<img alt="QR code PIX" src="data:image/png;base64,' + esc(o.qrBase64) + '">' : '<div style="width:200px;height:200px;border-radius:16px;background:var(--papel-3);display:grid;place-items:center;padding:16px;text-align:center;font-size:13px;color:var(--muted)">use o código copia e cola abaixo</div>';
    $("#pixCode").textContent = o.pixCode;
    $("#btnSimularPago").hidden = !o.mock;
    clearInterval(ck.timerT); clearInterval(ck.pollT);
    ck.timerT = setInterval(function () { var s = Math.max(0, Math.round((o.expiresAt - Date.now()) / 1000)); $("#pixTimer").textContent = fmtT(s); if (!s) { clearInterval(ck.timerT); clearInterval(ck.pollT); $("#pixTimer").textContent = "expirou — gere outro"; } }, 1000);
    ck.pollT = setInterval(function () {
      API.order(o.orderId).then(function (r) { if (r.status === "PAID") { clearInterval(ck.pollT); clearInterval(ck.timerT); saveToken(r.songId, r.token); toast("pagamento confirmado!"); go("#/musica/" + r.songId + "?t=" + encodeURIComponent(r.token)); } }).catch(function () {});
    }, 3000);
  }
  $("#btnCopiar").addEventListener("click", function () { var c = $("#pixCode").textContent; (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).then(function () { toast("código PIX copiado"); }).catch(function () { var r = document.createRange(); r.selectNodeContents($("#pixCode")); getSelection().removeAllRanges(); getSelection().addRange(r); toast("selecione e copie o código"); }); });
  $("#btnSimularPago").addEventListener("click", function () { if (ck.order) API.devPay(ck.order.orderId).catch(function (e) { toast(e.message); }); });
  $("#pixModal").addEventListener("click", function (e) { if (e.target === this) { this.hidden = true; clearInterval(ck.pollT); clearInterval(ck.timerT); } });

  // ============================================================
  //  MÚSICA (entrega)
  // ============================================================
  var mus = { id: "", t: "", pollT: null };
  views.musica = function (id, q) {
    clearTimeout(mus.pollT);
    mus.id = id; mus.t = q.t || tokens()[id] || "";
    if (q.t) saveToken(id, q.t);
    renderMusica(); // reagenda a si mesma só enquanto o clipe está na fila
  };
  function renderMusica() {
    var id = mus.id;
    API.song(id, mus.t).then(function (s) {
      var cst = s.clip && s.clip.status;
      clearTimeout(mus.pollT);
      if (s.unlocked && s.hasClip && (cst === "QUEUED" || cst === "RENDERING") && location.hash.indexOf("#/musica/" + id) === 0) mus.pollT = setTimeout(renderMusica, 8000);
      if (!s.unlocked) { $("#musicaSub").textContent = "esta música ainda não foi liberada. se você já pagou, abra pelo link que chegou no WhatsApp ou entre em 'minhas músicas'."; $("#entregas").innerHTML = '<a class="entrega" href="#/checkout/' + s.id + '"><span class="ico-down"></span><strong>Liberar no PIX</strong><span class="muted small">a partir de ' + brl(CFG.planos[0] ? CFG.planos[0].preco : 0) + '</span></a><a class="entrega" href="#/painel"><span class="ico-link"></span><strong>Minhas músicas</strong><span class="muted small">entrar com WhatsApp</span></a>'; return; }
      var h = "";
      s.tracks.forEach(function (t, i) { if (t) h += '<a class="entrega" href="' + t.downloadUrl + '" download><span class="ico-down"></span><strong>Baixar MP3</strong><span class="muted small">versão ' + (i + 1) + ' · ' + fmtT(t.duration) + '</span></a>'; });
      if (s.hasClip) {
        var c = s.clip, st = c ? c.status : "WAITING";
        if (st === "DONE" && c.url) h += '<a class="entrega destaque" href="' + c.url + '" download><span class="ico-clip"></span><strong>Baixar clipe</strong><span class="muted small">MP4 9:16 · com suas fotos</span></a>';
        else if (st === "QUEUED" || st === "RENDERING") h += '<div class="entrega destaque"><span class="ico-clip"></span><strong>Montando o clipe…</strong><span class="muted small">fica pronto em 1–2 minutos; avisamos no WhatsApp</span></div>';
        else h += '<label class="entrega destaque" style="cursor:pointer"><span class="ico-clip"></span><strong>Clipe: suba as fotos</strong><span class="muted small">até 8 fotos, o clipe sai na hora</span><input type="file" id="inFotos3" accept="image/jpeg,image/png,image/webp" multiple hidden></label>';
      } else h += '<a class="entrega" href="#/checkout/' + s.id + '"><span class="ico-clip"></span><strong>Quero o clipe</strong><span class="muted small">com suas fotos, formato Reels</span></a>';
      h += '<a class="entrega" href="#/m/' + s.slug + '"><span class="ico-link"></span><strong>Página da música</strong><span class="muted small">capa + player pra compartilhar</span></a>';
      $("#entregas").innerHTML = h;
      var f3 = $("#inFotos3"); if (f3) f3.addEventListener("change", function () { var files = Array.prototype.slice.call(this.files, 0, 8); subirFotos(s.id, files, function () { API.clip(s.id, 0).then(renderMusica); }); });
      // "Enviar o arquivo": baixa o MP3/MP4 no aparelho e abre a folha de compartilhar do sistema (WhatsApp, Instagram,
      // Telegram...). Sai do próprio celular da pessoa — nada passa pelo WhatsApp do servidor, custo zero pra gente.
      var podeArquivo = !!(navigator.share && navigator.canShare);
      var sf = $("#shareFiles"); sf.innerHTML = ""; sf.hidden = !podeArquivo; if (sf.previousElementSibling) sf.previousElementSibling.hidden = !podeArquivo;
      if (podeArquivo) {
        var alvos = [];
        s.tracks.forEach(function (t, i) { if (t) alvos.push({ rotulo: "enviar MP3 " + (s.tracks.length > 1 ? "v" + (i + 1) : ""), url: t.downloadUrl, nome: (s.slug || "musica") + (s.tracks.length > 1 ? "-v" + (i + 1) : "") + ".mp3", tipo: "audio/mpeg", dica: "WhatsApp, Telegram, e-mail" }); });
        if (s.hasClip && s.clip && s.clip.status === "DONE" && s.clip.url) alvos.push({ rotulo: "postar o clipe", url: s.clip.url, nome: (s.slug || "clipe") + ".mp4", tipo: "video/mp4", dica: "Instagram, Status, TikTok" });
        alvos.forEach(function (a) {
          var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ink"; b.innerHTML = esc(a.rotulo) + " <small>" + a.dica + "</small>";
          b.addEventListener("click", function () {
            b.disabled = true; b.textContent = "preparando…";
            fetch(a.url).then(function (r) { return r.blob(); }).then(function (blob) {
              var file = new File([blob], a.nome, { type: a.tipo });
              if (!navigator.canShare({ files: [file] })) throw new Error("sem suporte");
              return navigator.share({ files: [file], title: s.titulo || s.nome, text: "Música feita pra " + s.nome + " 🎵" });
            }).catch(function (e) { if (e && e.name !== "AbortError") { toast("seu navegador não compartilha arquivos; baixe e envie pelo app"); } })
              .finally(function () { b.disabled = false; b.innerHTML = esc(a.rotulo) + " <small>" + a.dica + "</small>"; });
          });
          sf.appendChild(b);
        });
      }
      // e-mail: mostra o que já foi, permite cadastrar/reenviar
      var emSalvo = ""; try { emSalvo = localStorage.getItem("refrao:email") || ""; } catch (e) {}
      $("#inEmail2").value = emSalvo; $("#emailInfo").textContent = emSalvo ? "Os MP3 e os links foram para " + emSalvo + ". Quer em outro e-mail? Digite abaixo." : "Digite seu e-mail e a gente manda os MP3 e os links.";
      $("#btnEmail").onclick = function () {
        var em = $("#inEmail2").value.trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { toast("esse e-mail não parece certo"); return; }
        var b = this; b.disabled = true; b.textContent = "enviando…";
        API.email(s.id, em).then(function (r) { toast(r.mock ? "e-mail simulado (modo teste)" : "e-mail enviado!"); try { localStorage.setItem("refrao:email", em); } catch (e) {} $("#emailInfo").textContent = "Enviado para " + em + "."; })
          .catch(function (e) { toast(e.message); }).finally(function () { b.disabled = false; b.textContent = "enviar por e-mail"; });
      };
      // redes: Instagram/TikTok precisam do arquivo (Reels/Status); com Web Share vai direto, sem ela abre o app e explica
      var sr = $("#shareRedes"); sr.innerHTML = "";
      [["Instagram", "https://www.instagram.com/", "ig"], ["TikTok", "https://www.tiktok.com/upload", "tt"], ["Status do WhatsApp", "https://wa.me/", "st"]].forEach(function (r) {
        var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost rede-" + r[2]; b.textContent = r[0];
        b.addEventListener("click", function () {
          var alvo = (s.hasClip && s.clip && s.clip.status === "DONE" && s.clip.url) ? { url: s.clip.url, nome: (s.slug || "clipe") + ".mp4", tipo: "video/mp4" } : (s.tracks[0] ? { url: s.tracks[0].downloadUrl, nome: (s.slug || "musica") + ".mp3", tipo: "audio/mpeg" } : null);
          if (navigator.share && navigator.canShare && alvo) {
            b.disabled = true;
            fetch(alvo.url).then(function (x) { return x.blob(); }).then(function (blob) { var f = new File([blob], alvo.nome, { type: alvo.tipo }); if (!navigator.canShare({ files: [f] })) throw new Error("x"); return navigator.share({ files: [f], title: s.titulo || s.nome }); })
              .catch(function (e) { if (!e || e.name !== "AbortError") { toast("baixe o arquivo e poste pelo app do " + r[0]); window.open(r[1], "_blank"); } }).finally(function () { b.disabled = false; });
          } else { toast("no celular, baixe o " + (alvo && alvo.tipo === "video/mp4" ? "clipe" : "MP3") + " e poste pelo app do " + r[0]); window.open(r[1], "_blank"); }
        });
        sr.appendChild(b);
      });
      var link = location.origin + "/m/" + s.slug, txt = "Ouve a música que fiz pra " + s.nome + " 🎵 " + link;
      $("#shareWpp").href = "https://wa.me/?text=" + encodeURIComponent(txt);
      $("#shareCopy").onclick = function () { (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { toast("link copiado"); }).catch(function () { prompt("copie o link:", link); }); };
      $("#shareNative").hidden = !navigator.share; $("#shareNative").onclick = function () { navigator.share({ title: s.titulo || s.nome, text: txt, url: link }).catch(function () {}); };
      $("#btnPublicar").disabled = s.publicStatus !== "private"; $("#btnPublicar").textContent = s.publicStatus === "approved" ? "publicada no mural" : s.publicStatus === "pending" ? "aguardando aprovação" : "publicar no mural";
      $("#btnPublicar").onclick = function () { API.publish(s.id).then(renderMusica).catch(function (e) { toast(e.message); }); };
      $("#musicaLetra").textContent = s.letra || "";
      var studio = CFG.planos.find(function (p) { return p.id === "studio"; }); if (studio) $("#btnStudio").textContent = "ver plano Studio · " + brl(studio.preco) + "/mês";
    }).catch(function (e) { toast(e.message); });
  }

  // ============================================================
  //  PÁGINA PÚBLICA
  // ============================================================
  views.publica = function (slug) {
    API.pub(slug).then(function (m) {
      $("#pubCover").style.setProperty("--accent", ui(m.ritmo).cor);
      $("#pubTitulo").textContent = m.titulo || m.nome; $("#pubSub").textContent = (m.ritmoNome || "").toLowerCase();
      $("#pubMeta").textContent = (m.plays || 0).toLocaleString("pt-BR") + " plays · feita com " + CFG.brand;
      $("#pubLetra").textContent = m.letra || ""; fillWaves($("#pubWaves"), 40);
      var p = $("#pubPlay"), np = p.cloneNode(true); p.parentNode.replaceChild(np, p);
      np.addEventListener("click", function () { var was = np.classList.contains("is-playing"); stopAll(); if (was) return; np.classList.add("is-playing"); $("#pubWaves").classList.add("is-playing"); var el = new Audio(m.previewUrl); audio.el = el; el.play(); API.pubPlay(slug).catch(function () {}); el.onended = function () { np.classList.remove("is-playing"); $("#pubWaves").classList.remove("is-playing"); }; });
    }).catch(function () { toast("música não encontrada"); go("#/"); });
  };

  // ============================================================
  //  PAINEL DO CLIENTE (login por código no WhatsApp)
  // ============================================================
  views.painel = function () { carregarPainel(); };
  function carregarPainel() {
    API.me().then(function (me) {
      $("#painelLogin").hidden = true; $("#painelConteudo").hidden = false;
      $("#painelWpp").textContent = "+" + me.whatsapp; $("#painelPlano").textContent = me.plan === "studio" ? "Studio · renova em " + new Date(me.planRenewsAt).toLocaleDateString("pt-BR") : "plano avulso";
      $("#painelIndic").textContent = me.referrals; $("#painelRef").textContent = location.origin + "/#/criar?ref=" + me.refCode; $("#painelCred").textContent = me.credits;
      var box = $("#listaMusicas"); box.innerHTML = me.songs.length ? "" : '<p class="muted">nenhuma música ainda. <a class="link" href="#/criar">criar a primeira</a></p>';
      me.songs.forEach(function (s) {
        var d = document.createElement("div"); d.className = "musica-row"; d.style.setProperty("--accent", ui(s.ritmo).cor);
        var st = s.status === "FAILED" ? '<span class="status falha">falhou</span>' : s.ready ? (s.paid ? '<span class="status">liberada</span>' : '<span class="status pendente">prévia</span>') : '<span class="status pendente">gravando</span>';
        var acoes = s.ready ? (s.paid ? '<a class="btn btn-ghost" href="#/musica/' + s.id + '">baixar</a>' : '<a class="btn btn-ghost" href="#/previa/' + s.id + '">ouvir</a><a class="btn btn-palco" href="#/checkout/' + s.id + '">liberar</a>') : '<a class="btn btn-ghost" href="#/gerando/' + s.id + '">acompanhar</a>';
        d.innerHTML = '<div class="thumb"></div><div><strong>' + esc(s.titulo || s.nome) + '</strong><span class="muted small">' + esc(s.ritmoNome) + ' · ' + new Date(s.createdAt).toLocaleDateString("pt-BR") + ' </span>' + st + '</div><div class="acoes">' + acoes + '</div>';
        box.appendChild(d);
      });
    }).catch(function () { $("#painelLogin").hidden = false; $("#painelConteudo").hidden = true; });
  }
  $("#loginWpp").addEventListener("input", function () { this.value = maskWpp(this.value); });
  $("#btnOtp").addEventListener("click", function () {
    var w = $("#loginWpp").value; if (!wppOk(w)) return toast("coloque o WhatsApp com DDD");
    var b = this; b.disabled = true; $("#loginErro").hidden = true;
    API.otp(w).then(function (r) { $("#otpStep").hidden = false; $("#loginCode").focus(); if (r.mock && r.code) { $("#loginCode").value = r.code; toast("modo teste: código preenchido"); } else toast("código enviado no WhatsApp"); }).catch(function (e) { $("#loginErro").textContent = e.message; $("#loginErro").hidden = false; }).finally(function () { b.disabled = false; });
  });
  $("#btnVerify").addEventListener("click", function () {
    API.verify($("#loginWpp").value, $("#loginCode").value.trim()).then(function () { carregarPainel(); }).catch(function (e) { $("#loginErro").textContent = e.message; $("#loginErro").hidden = false; });
  });
  $("#btnSair").addEventListener("click", function () { API.logout().then(function () { carregarPainel(); }); });

  // ============================================================
  //  ADMIN
  // ============================================================
  var adm = { range: "1d" };
  views.admin = function () { carregarAdmin(); };
  function carregarAdmin() {
    API.admin.stats(adm.range).then(function (s) {
      $("#adminLogin").hidden = true; $("#adminConteudo").hidden = false;
      $("#adminTitulo").textContent = adm.range === "1d" ? "Hoje" : adm.range === "7d" ? "Últimos 7 dias" : "Últimos 30 dias";
      $("#kpis").innerHTML = [[s.gerados, "músicas geradas"], [s.previas, "prévias prontas"], [s.vendas, "vendas"], [s.conversao + "%", "prévia → venda"], [brl(s.receita), "receita"]].map(function (k) { return '<div class="kpi"><div class="v">' + k[0] + '</div><div class="l">' + k[1] + '</div></div>'; }).join("");
      var max = Math.max(1, s.funil[0][1]);
      $("#funil").innerHTML = s.funil.map(function (f) { return '<div class="funil-row"><span>' + f[0] + '</span><i style="width:' + (f[1] / max * 100) + '%"></i><span>' + f[1] + '</span></div>'; }).join("");
      $("#custoIa").textContent = "R$ " + s.custoIaPorVenda.toFixed(2).replace(".", ","); $("#custoIaSub").textContent = s.geracoesPorVenda + " gerações por venda · " + s.leads + " leads · " + s.clipes + " clipes · " + s.pendentesMural + " no mural p/ aprovar · " + s.clipesFila + " clipes na fila";
      $("#provedores").innerHTML = Object.entries(s.provedores).map(function (p) { return "<li><span>" + p[0] + "</span><em class='" + (p[1] === "mock" ? "mock" : "") + "'>" + esc(p[1]) + "</em></li>"; }).join("");
      $("#fila").innerHTML = "<tr><th>id</th><th>nome</th><th>ritmo</th><th>status</th><th>pago</th><th>quando</th><th></th></tr>" + s.fila.map(function (f) { return "<tr><td>" + f.id.slice(0, 8) + "…</td><td>" + esc(f.nome) + "</td><td>" + esc(f.ritmo) + "</td><td>" + esc(f.status) + (f.error ? "<br><small class='erro'>" + esc(f.error) + "</small>" : "") + "</td><td>" + (f.paid ? "sim" : "não") + "</td><td>" + new Date(f.created_at).toLocaleString("pt-BR") + "</td><td>" + (f.status === "FAILED" ? "<button class='btn btn-ghost' data-retry='" + f.id + "'>refazer</button>" : "") + (!f.paid ? " <button class='btn btn-ghost' data-unlock='" + f.id + "'>liberar</button>" : "") + "</td></tr>"; }).join("");
      bindAdminActions($("#fila"));
    }).catch(function () { $("#adminLogin").hidden = false; $("#adminConteudo").hidden = true; });
  }
  function bindAdminActions(root) {
    $$("[data-retry]", root).forEach(function (b) { b.onclick = function () { API.admin.retry(b.dataset.retry).then(function () { toast("reenviada ao estúdio"); carregarAdmin(); }); }; });
    $$("[data-unlock]", root).forEach(function (b) { b.onclick = function () { if (confirm("Liberar esta música sem pagamento?")) API.admin.unlock(b.dataset.unlock).then(function () { toast("liberada"); carregarAdmin(); }); }; });
    $$("[data-mural]", root).forEach(function (b) { b.onclick = function () { API.admin.muralSet(b.dataset.mural, b.dataset.approve === "1").then(function () { toast("ok"); adminTab("mural"); }); }; });
  }
  $("#btnAdminLogin").addEventListener("click", function () { API.admin.login($("#adminPass").value).then(carregarAdmin).catch(function (e) { $("#adminErro").textContent = e.message; $("#adminErro").hidden = false; }); });
  $("#adminPass").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#btnAdminLogin").click(); });
  $$("#adminRange button").forEach(function (b) { b.addEventListener("click", function () { adm.range = b.dataset.r; $$("#adminRange button").forEach(function (x) { x.classList.toggle("is-on", x === b); }); carregarAdmin(); }); });
  function adminTab(tab) {
    $$("#adminNav button").forEach(function (b) { b.classList.toggle("is-on", b.dataset.tab === tab); });
    ["geral", "musicas", "pedidos", "mural", "cupons", "leads"].forEach(function (t) { $("#tab" + t[0].toUpperCase() + t.slice(1)).hidden = t !== tab; });
    if (tab === "musicas") API.admin.songs($("#adminBusca").value).then(function (list) { $("#adminMusicas").innerHTML = "<tr><th>quando</th><th>nome</th><th>WhatsApp</th><th>ritmo</th><th>status</th><th>faixas</th><th>pago</th><th></th></tr>" + list.map(function (s) { return "<tr><td>" + new Date(s.created_at).toLocaleString("pt-BR") + "</td><td>" + esc(s.nome) + "<br><small>" + s.id + "</small></td><td>" + esc(s.whatsapp || "—") + "</td><td>" + esc(s.ritmoNome) + "</td><td>" + esc(s.status) + "</td><td>" + s.tracks + "</td><td>" + (s.paid ? s.plan : "não") + "</td><td><a class='btn btn-ghost' href='#/previa/" + s.id + "'>ouvir</a> " + (s.status === "FAILED" ? "<button class='btn btn-ghost' data-retry='" + s.id + "'>refazer</button>" : "") + (!s.paid ? "<button class='btn btn-ghost' data-unlock='" + s.id + "'>liberar</button>" : "") + "</td></tr>"; }).join(""); bindAdminActions($("#adminMusicas")); });
    if (tab === "pedidos") API.admin.orders().then(function (list) { $("#adminPedidos").innerHTML = "<tr><th>quando</th><th>música</th><th>WhatsApp</th><th>plano</th><th>extras</th><th>total</th><th>status</th></tr>" + list.map(function (o) { return "<tr><td>" + new Date(o.created_at).toLocaleString("pt-BR") + "</td><td>" + esc(o.nome) + "</td><td>" + esc(o.whatsapp) + "</td><td>" + esc(o.plan) + "</td><td>" + esc(JSON.parse(o.bumps || "[]").join(", ") || "—") + "</td><td>" + brl(o.total) + "</td><td>" + esc(o.status) + "</td></tr>"; }).join(""); });
    if (tab === "mural") API.admin.mural().then(function (list) { $("#adminMural").innerHTML = "<tr><th>música</th><th>WhatsApp</th><th>status</th><th>plays</th><th></th></tr>" + (list.map(function (s) { return "<tr><td>" + esc(s.titulo || s.nome) + "</td><td>" + esc(s.whatsapp || "—") + "</td><td>" + esc(s.public_status) + "</td><td>" + s.plays + "</td><td>" + (s.public_status === "pending" ? "<button class='btn btn-pix' data-mural='" + s.id + "' data-approve='1'>aprovar</button> " : "") + "<button class='btn btn-ghost' data-mural='" + s.id + "' data-approve='0'>tirar</button></td></tr>"; }).join("") || "<tr><td colspan='5' class='muted'>nada pendente</td></tr>"); bindAdminActions($("#adminMural")); });
  }
  function adminLeads() {
    API.admin.leads().then(function (list) {
      $("#adminLeads").innerHTML = "<tr><th>quando</th><th>e-mail</th><th>WhatsApp</th><th>nome</th><th>música</th><th>pagou</th></tr>" + (list.map(function (l) {
        return "<tr><td>" + new Date(l.created_at).toLocaleString("pt-BR") + "</td><td>" + esc(l.email || "—") + "</td><td>" + esc(l.whatsapp || "—") + "</td><td>" + esc(l.nome || "") + "</td><td>" + esc(l.musica || "") + "</td><td>" + (l.paid ? "sim" : "não") + "</td></tr>";
      }).join("") || "<tr><td colspan='6'>nenhum lead ainda</td></tr>");
    });
  }
  function adminCupons() {
    API.admin.cupons().then(function (list) {
      $("#adminCupons").innerHTML = "<tr><th>código</th><th>%</th><th>origem</th><th>quem</th><th>usos</th><th>vence</th></tr>" + (list.map(function (c) {
        return "<tr><td><strong>" + esc(c.code) + "</strong></td><td>" + c.pct + "%</td><td>" + esc(c.source) + "</td><td>" + esc(c.handle || "—") + "</td><td>" + c.uses + "/" + c.max_uses + (c.used_by ? "<br><small>pedido " + esc(c.used_by) + "</small>" : "") + "</td><td>" + (c.expires_at ? new Date(c.expires_at).toLocaleDateString("pt-BR") : "—") + "</td></tr>";
      }).join("") || "<tr><td colspan='6'>nenhum cupom ainda</td></tr>");
    });
  }
  $("#btnCupomNovo").addEventListener("click", function () {
    var b = this; b.disabled = true;
    API.admin.cupomNovo({ handle: $("#cupomHandle").value, whatsapp: $("#cupomWpp").value, pct: $("#cupomPct").value, enviar: $("#cupomEnviar").checked })
      .then(function (c) { toast("cupom " + c.code + (c.enviado ? " enviado no WhatsApp" : " gerado")); $("#cupomHandle").value = ""; $("#cupomWpp").value = ""; adminCupons(); })
      .catch(function (e) { toast(e.message); }).finally(function () { b.disabled = false; });
  });
  $$("#adminNav button").forEach(function (b) { b.addEventListener("click", function () { adminTab(b.dataset.tab); if (b.dataset.tab === "cupons") adminCupons(); if (b.dataset.tab === "leads") adminLeads(); }); });
  $("#adminBusca").addEventListener("input", function () { clearTimeout(this._t); this._t = setTimeout(function () { adminTab("musicas"); }, 300); });

  // ============================================================
  //  BOOT
  // ============================================================
  // o config vem injetado no HTML pelo servidor (window.__CFG): a landing pinta sem esperar a API
  function aplicarConfig(c) {
    CFG = c; c.ritmos.forEach(function (r) { RITMO_NOME[r.id] = r.nome; });
    $$("[data-brand]").forEach(function (el) { el.textContent = c.brand; });
    document.title = c.brand + " — seu nome cantado em 60 segundos";
  }
  if (window.__CFG) { aplicarConfig(window.__CFG); initLanding(); route(); }
  else API.config().then(function (c) { aplicarConfig(c); initLanding(); route(); }).catch(function () { initLanding(); route(); toast("não consegui falar com o servidor"); });
})();
