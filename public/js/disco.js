/* ============================================================
   REFRÃO · TEMA "DISCOTECA 2000" — peças decorativas
   - fundo (estrelas, luz de canhão, feixes, piso em grade)
   - letreiro LED no topo
   - globo de espelhos em canvas sobre a capa
   - cursor estrela com faíscas (só mouse)
   Não mexe em nenhuma regra de negócio: só adiciona elementos e desenha.
   ============================================================ */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  var $ = function (s, c) { return (c || document).querySelector(s); };

  // ---------- fundo ----------
  var bg = document.createElement("div"); bg.className = "bg"; bg.setAttribute("aria-hidden", "true");
  bg.innerHTML = '<div class="stars"></div><div class="glow"></div><div class="beam"></div><div class="beam b2"></div><div class="floor"></div>';
  document.body.prepend(bg);

  // ---------- letreiro LED ----------
  var frases = "★  SEU NOME NO REFRÃO  ★  PRONTA EM 2 MINUTOS  ★  CLIPE COM AS SUAS FOTOS  ★  FORRÓ · SERTANEJO · PAGODE · PISEIRO · FUNK · GOSPEL  ★  PIX NA HORA  ★  MÚSICA COM O SEU NOME  ★  ";
  var tk = document.createElement("div"); tk.className = "ticker"; tk.setAttribute("aria-hidden", "true");
  tk.innerHTML = "<span>" + frases + frases + "</span>";
  var topbar = $(".topbar"); if (topbar) topbar.before(tk); else document.body.prepend(tk);

  // ---------- título: "cantado" em magenta ----------
  var claim = $(".sleeve-claim");
  if (claim && !$(".n", claim)) claim.innerHTML = claim.textContent.replace(/\bcantado\b/, '<span class="n">cantado</span>');

  // ---------- globo de espelhos ----------
  var art = $(".sleeve-art");
  if (art) {
    var g = document.createElement("div"); g.className = "globo"; g.setAttribute("aria-hidden", "true");
    var cv = document.createElement("canvas"); cv.width = 360; cv.height = 360; g.appendChild(cv); art.prepend(g);
    var ctx = cv.getContext("2d"), W = cv.width, R = W * .42, cx = W / 2, cy = W / 2, a = 0;
    var cores = ["#ff2bd6", "#19e6ff", "#b8ff3c", "#ffd23f", "#ffffff"];
    var visivel = true;
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visivel = es[0].isIntersecting; }).observe(g);
    function frame() {
      if (visivel) {
        ctx.clearRect(0, 0, W, W); a += reduce ? 0 : .006;
        var grad = ctx.createRadialGradient(cx - R * .35, cy - R * .35, R * .1, cx, cy, R); grad.addColorStop(0, "#2a2e45"); grad.addColorStop(1, "#05060c");
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
        var lat = 14, lon = 28;
        for (var i = 1; i < lat; i++) {
          var phi = Math.PI * i / lat, y = cy - R * Math.cos(phi), rr = R * Math.sin(phi);
          for (var j = 0; j < lon; j++) {
            var th = 2 * Math.PI * j / lon + a * (1 + i % 2 * .1), z = Math.cos(th); if (z < -.05) continue;
            var x = cx + rr * Math.sin(th);
            var lum = Math.max(0, z) * (.55 + .45 * Math.sin(th * 3 + a * 7 + i)), fl = Math.sin(th * 5 + a * 11 + i * 2) > .985;
            var w = Math.max(2, (2 * Math.PI * rr / lon) * Math.max(.2, z)), h = Math.max(2, (Math.PI * R / lat) * .9);
            ctx.fillStyle = fl ? cores[(i + j) % cores.length] : "rgba(" + (200 + 55 * lum | 0) + "," + (210 + 45 * lum | 0) + "," + (235 + 20 * lum | 0) + "," + (.15 + .75 * lum) + ")";
            ctx.fillRect(x - w / 2, y - h / 2, w, h);
            if (fl) { ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 18; ctx.fillRect(x - w / 2, y - h / 2, w, h); ctx.shadowBlur = 0; }
          }
        }
        var hi = ctx.createRadialGradient(cx - R * .3, cy - R * .4, 0, cx - R * .3, cy - R * .4, R * .9); hi.addColorStop(0, "rgba(255,255,255,.35)"); hi.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = hi; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      }
      if (!reduce) requestAnimationFrame(frame);
    }
    frame();
    // matiz do holográfico acompanha o mouse (o motion.js já cuida de --mx/--my/--rx/--ry)
    art.addEventListener("pointermove", function (e) { var r = art.getBoundingClientRect(); art.style.setProperty("--h", ((e.clientX - r.left) / r.width * 360 | 0) + "deg"); }, { passive: true });
  }

  // ---------- cursor estrela + faíscas ----------
  if (fine && !reduce) {
    document.body.classList.add("has-cur");
    var cur = document.createElement("div"); cur.className = "cur"; cur.setAttribute("aria-hidden", "true"); document.body.appendChild(cur);
    var lastS = 0;
    document.addEventListener("pointermove", function (e) {
      cur.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px) translate(-50%,-50%)";
      if (performance.now() - lastS > 40) {
        lastS = performance.now();
        var s = document.createElement("span"); s.className = "spark"; s.style.left = e.clientX + "px"; s.style.top = e.clientY + "px";
        s.style.setProperty("--dx", (Math.random() * 60 - 30) + "px"); s.style.setProperty("--dy", (Math.random() * 60 - 10) + "px");
        document.body.appendChild(s); setTimeout(function () { s.remove(); }, 700);
      }
    }, { passive: true });
    document.addEventListener("pointerleave", function () { cur.style.opacity = "0"; });
    document.addEventListener("pointerenter", function () { cur.style.opacity = "1"; });
  }
})();
