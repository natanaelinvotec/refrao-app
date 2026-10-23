/* ============================================================
   REFRÃO — camada de movimento e toque
   - inclinação 3D + foco de luz seguindo o mouse (e o dedo) nas caixas
   - botões magnéticos, onda ao tocar, elevação ao passar por cima
   - capa com nomes de exemplo digitando sozinhos, contador que sobe
   - disco que gira, barra do topo que encolhe, transição entre telas
   Tudo só com transform/opacity; desligado com prefers-reduced-motion.
   ============================================================ */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  // ---------- inclinação 3D + luz (delegado: funciona para elementos criados depois) ----------
  var TILT = ".tilt, .sleeve, .disc, .ticket, .tile, .entrega, .pick, .mural-item, .card, .cta-dialog, .slip, .kpi, .musica-row, .box, .indique, .upsell-studio, .player";
  function setLight(el, x, y) {
    var r = el.getBoundingClientRect();
    var px = (x - r.left) / r.width, py = (y - r.top) / r.height;
    el.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
    el.style.setProperty("--my", (py * 100).toFixed(1) + "%");
    var max = el.classList.contains("sleeve") || el.classList.contains("disc") ? 6 : 4;
    el.style.setProperty("--rx", ((0.5 - py) * max).toFixed(2) + "deg");
    el.style.setProperty("--ry", ((px - 0.5) * max).toFixed(2) + "deg");
  }
  function clearLight(el) { el.style.removeProperty("--rx"); el.style.removeProperty("--ry"); el.classList.remove("is-lit"); }
  if (!reduce) {
    document.addEventListener("pointermove", function (e) {
      var el = e.target.closest && e.target.closest(TILT); if (!el) return;
      if (e.pointerType === "touch" && !el.classList.contains("sleeve") && !el.classList.contains("disc")) return;
      el.classList.add("is-lit"); setLight(el, e.clientX, e.clientY);
    }, { passive: true });
    document.addEventListener("pointerleave", function (e) { var el = e.target.closest && e.target.closest(TILT); if (el) clearLight(el); }, true);
    document.addEventListener("pointerout", function (e) { var el = e.target.closest && e.target.closest(TILT); if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) clearLight(el); }, { passive: true });
    // no celular: a capa inclina com o movimento do aparelho
    if (window.DeviceOrientationEvent && !fine) {
      window.addEventListener("deviceorientation", function (e) {
        var s = document.querySelector(".sleeve.is-on-screen, .sleeve"); if (!s || e.beta == null) return;
        s.style.setProperty("--rx", Math.max(-6, Math.min(6, (e.beta - 40) / 8)).toFixed(2) + "deg");
        s.style.setProperty("--ry", Math.max(-6, Math.min(6, e.gamma / 8)).toFixed(2) + "deg");
      }, { passive: true });
    }
  }

  // ---------- botões magnéticos (só com mouse) ----------
  if (fine && !reduce) {
    document.addEventListener("pointermove", function (e) {
      var b = e.target.closest && e.target.closest(".btn, .play-big, .mini-play, .cell"); if (!b) return;
      var r = b.getBoundingClientRect();
      b.style.setProperty("--tx", ((e.clientX - r.left - r.width / 2) * 0.18).toFixed(1) + "px");
      b.style.setProperty("--ty", ((e.clientY - r.top - r.height / 2) * 0.18).toFixed(1) + "px");
    }, { passive: true });
    document.addEventListener("pointerout", function (e) { var b = e.target.closest && e.target.closest(".btn, .play-big, .mini-play, .cell"); if (b) { b.style.setProperty("--tx", "0px"); b.style.setProperty("--ty", "0px"); } }, { passive: true });
  }

  // ---------- onda ao tocar / clicar ----------
  document.addEventListener("pointerdown", function (e) {
    if (reduce) return;
    var el = e.target.closest && e.target.closest(".btn, .tile, .chip, .ritmo, .pick, .versao, .cell, .entrega, .nichos a, .mural-item, .ticket-stub .btn, .card-tab summary");
    if (!el) return;
    var r = el.getBoundingClientRect(), w = document.createElement("span"); w.className = "ripple";
    var size = Math.max(r.width, r.height) * 1.6;
    w.style.width = w.style.height = size + "px";
    w.style.left = (e.clientX - r.left - size / 2) + "px"; w.style.top = (e.clientY - r.top - size / 2) + "px";
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.appendChild(w); setTimeout(function () { w.remove(); }, 650);
  }, { passive: true });

  // ---------- capa: nomes de exemplo digitando sozinhos enquanto está vazia ----------
  var nomes = ["Dona Cida", "Açaí do Pedro", "Maria Professora", "Júlia e Rafa", "Oficina Soares", "Pod do Zé"];
  var input = document.getElementById("heroNome"), title = document.getElementById("coverTitle");
  if (input && title && !reduce) {
    var ni = 0, ci = 0, apagando = false, timer;
    function tick() {
      if (document.activeElement === input || input.value) { title.classList.remove("is-typing"); timer = setTimeout(tick, 1500); return; }
      var alvo = nomes[ni % nomes.length];
      if (!apagando) { ci++; title.textContent = alvo.slice(0, ci); title.classList.add("is-typing"); if (ci >= alvo.length) { apagando = true; timer = setTimeout(tick, 1600); return; } timer = setTimeout(tick, 70 + Math.random() * 60); }
      else { ci--; title.textContent = alvo.slice(0, ci) || "Seu nome"; if (ci <= 0) { apagando = false; ni++; timer = setTimeout(tick, 500); return; } timer = setTimeout(tick, 35); }
    }
    timer = setTimeout(tick, 1800);
    input.addEventListener("focus", function () { title.classList.remove("is-typing"); if (!input.value) title.textContent = "Seu nome"; });
  }

  // ---------- contador que sobe ----------
  var stat = document.getElementById("statMusicas");
  if (stat && !reduce) {
    var mo = new MutationObserver(function () {
      var alvo = parseInt(stat.textContent.replace(/\D/g, ""), 10); if (!alvo || stat.dataset.counted) return;
      stat.dataset.counted = "1"; var t0 = performance.now();
      (function frame(t) { var k = Math.min(1, (t - t0) / 1200), e = 1 - Math.pow(1 - k, 3); stat.textContent = Math.round(alvo * e).toLocaleString("pt-BR"); if (k < 1) requestAnimationFrame(frame); })(t0);
    });
    mo.observe(stat, { childList: true });
  }

  // ---------- barra do topo encolhe ao rolar; capa some suave ----------
  var topbar = document.querySelector(".topbar"), last = 0;
  window.addEventListener("scroll", function () {
    var y = window.scrollY;
    if (topbar) topbar.classList.toggle("is-compact", y > 40);
    last = y;
  }, { passive: true });

  // ---------- transição entre telas (rotas) ----------
  window.addEventListener("hashchange", function () {
    var v = document.querySelector(".view.is-on"); if (!v || reduce) return;
    v.classList.remove("is-entering"); void v.offsetWidth; v.classList.add("is-entering");
    setTimeout(function () { v.classList.remove("is-entering"); }, 700);
  });

  // ---------- disco: gira devagar sempre, rápido tocando; segue o dedo ----------
  var disc = document.querySelector(".disc");
  if (disc && !reduce) {
    disc.classList.add("is-idle");
    disc.addEventListener("pointerenter", function () { disc.classList.add("is-hover"); });
    disc.addEventListener("pointerleave", function () { disc.classList.remove("is-hover"); });
  }
})();
