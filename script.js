/* ═══════════════════════════════════════════════
   Creamos Guatemala · Gestión de Impacto
   script.js  —  Sistema de caminata con física real
═══════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─── DOM ───────────────────────────────────── */
  const slides      = Array.from(document.querySelectorAll('.slide'));
  const navDots     = document.getElementById('navDots');
  const prevBtn     = document.getElementById('prevBtn');
  const nextBtn     = document.getElementById('nextBtn');
  const totalSlides = slides.length;

  let current   = 0;
  let animating = false;
  let iframeTimer = null;

  /* ─── Índices ───────────────────────────────── */
  const IFRAME_IDX  = 1;
  const WALK_IDX    = 3;
  const MAP_IDX     = 4;
  const FORMULA_IDX = 5;
  const REFRESH_MS  = 15000;

  /* ─── Walk slide elements ───────────────────── */
  const walkSlide   = document.getElementById('slide-walk');
  const walkCards   = walkSlide ? Array.from(walkSlide.querySelectorAll('.walk-card')) : [];
  const walkWorldEl = walkSlide ? walkSlide.querySelector('.walk-world') : null;
  const walkFloorEl = walkSlide ? walkSlide.querySelector('.walk-floor') : null;
  const walkBgEl    = document.getElementById('walk-bg');
  const walkIdxEl   = document.getElementById('walk-index');

  let currentCard  = 0;
  let cardAnimating = false;
  let rafId        = null;
  let floorOffset  = 0;

  /* ══════════════════════════════════════════════
     FÍSICA DE CAMINATA — Corrección de física real
     ─────────────────────────────────────────────
     La tarjeta está FIJA en el espacio.
     Lo que se mueve es la CÁMARA (el observador).
     El crecimiento de la tarjeta es consecuencia
     de la perspectiva: tamaño = P / (P + d)

     La cámara = walkWorldEl (contiene la perspectiva).
     Al aplicar translateY/rotate/translateX suaves
     a walkWorldEl, se simula el movimiento de cabeza
     del observador mientras camina — como un estabilizador.

     Valores deliberadamente pequeños:
     como una cámara con gimbal estabilizador.
  ══════════════════════════════════════════════ */

  const P          = 1800;    // focal length de perspectiva (px)
  const D_START    = 9500;    // distancia inicial de la tarjeta (muy lejos)
  const STEP_HZ    = 1.5;     // pasos por segundo — ritmo caminata normal
  const BOB_AMP    = 2.5;     // px — cabeza sube/baja (muy sutil, como estabilizador)
  const ROLL_AMP   = 0.15;    // grados — inclinación por paso (apenas perceptible)
  const SWAY_AMP   = 1.8;     // px — balanceo lateral (mínimo)

  /* Cancela animación activa y limpia cámara */
  function stopRaf() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (walkWorldEl) walkWorldEl.style.transform = '';
  }

  /* ── Movimiento de la cámara (observador caminando) ──
     Aplicado a walkWorldEl = el contenedor de perspectiva = la "cámara".
     La tarjeta NO se toca. Este transform mueve el punto de vista,
     dando la ilusión de que el observador está caminando.

     Fórmula del bob:
       sin(2φ): sube y baja dos veces por zancada (izq + der)
       sin(φ):  roll alterna con cada paso
      -sin(φ):  sway en contra del roll (comportamiento físico real)
  */
  function applyWalkerCamera(elapsedMs, envelope) {
    if (!walkWorldEl) return;
    const φ    = elapsedMs * 0.001 * STEP_HZ * Math.PI * 2;
    const bob  =  Math.sin(2 * φ) * BOB_AMP  * envelope;   // 2 bobs por zancada
    const roll =  Math.sin(φ)     * ROLL_AMP * envelope;   // lean alterna
    const sway = -Math.sin(φ)     * SWAY_AMP * envelope;   // contra el roll
    walkWorldEl.style.transform =
      `translateY(${-bob}px) rotate(${roll}deg) translateX(${sway}px)`;
  }

  /* ─── La tarjeta actual se abalanza y pasa ─────
     La tarjeta crece (perspectiva: estás avanzando
     hacia ella) y desaparece (la atraviesas).
     La tarjeta en sí usa scale() — su posición no cambia,
     su tamaño aparente sí, como dictaría la perspectiva
     al acercarte a algo que está fijo. */
  function walkThrough(card, onDone) {
    stopRaf();
    card.classList.remove('active');
    const DUR = 950;
    const t0  = performance.now();

    function frame(now) {
      const elapsed = now - t0;
      const t = Math.min(elapsed / DUR, 1);

      /* Perspectiva: te acercas, d decrece de 0 hacia negativo (pasas la tarjeta).
         d = -1500 * t   (0 = estás en la tarjeta, -1500 = ya la pasaste)
         scale = P / (P + d) donde d es negativo → scale > 1 */
      const d     = -1500 * t;
      const escala = P / Math.max(P + d, 60);   // crece hasta ~6x y se corta
      card.style.transform = `scale(${Math.min(escala, 6)})`;

      /* Desaparece rápido — la atraviesas */
      card.style.opacity = String(Math.max(0, 1 - t * 3.2));

      /* Cámara: caminas, pero el bob empieza y termina suave */
      const env = Math.sin(Math.min(t, 0.95) * Math.PI) * 0.7;
      applyWalkerCamera(elapsed, env);

      if (t < 1) {
        rafId = requestAnimationFrame(frame);
      } else {
        card.style.transform = '';
        card.style.opacity   = '';
        stopRaf();
        if (onDone) onDone();
      }
    }

    rafId = requestAnimationFrame(frame);
  }

  /* ─── Te acercas a la siguiente tarjeta ────────
     FÍSICA REAL: la tarjeta está fija en Z=0.
     Tú (la cámara) avanzas.
     La distancia decrece a velocidad constante (caminar uniforme).
     El tamaño aparente sigue 1/d — no lineal:
       • primero crece muy despacio (objeto lejano, cambio de ángulo sólido mínimo)
       • luego crece más rápido conforme te acercas
     Exactamente lo que describes: "imagina caminar 8 metros". */
  function walkToward(card, onDone) {
    stopRaf();
    const DUR = 2500;   // ms — tiempo de caminata (8 metros a ritmo normal)
    const t0  = performance.now();

    /* Tarjeta empieza invisible en la distancia */
    card.style.transform = `scale(${P / (P + D_START)})`;
    card.style.opacity   = '0';

    function frame(now) {
      const elapsed = now - t0;
      const t = Math.min(elapsed / DUR, 1);

      /* ── Distancia decrece linealmente (velocidad de caminata constante) */
      const d      = D_START * (1 - t);
      const escala = P / (P + d);          // fórmula de perspectiva 1/d
      card.style.transform = `scale(${escala})`;

      /* ── Opacidad: el objeto emerge de la distancia
         A distancias largas, la iluminación y atmósfera
         lo hacen casi invisible. Aparece gradualmente. */
      const opacidad = Math.pow(Math.max(0, (t - 0.06) / 0.94), 2.2);
      card.style.opacity = String(Math.min(opacidad, 1));

      /* ── Cámara: bob del observador (estabilizador)
         Envelope: arranque suave → paso completo → parada suave.
         Los pasos son consistentes y fluidos durante toda la caminata. */
      const env = t < 0.07  ? t / 0.07           // arranca
                : t > 0.93  ? (1 - t) / 0.07     // para
                : 1.0;
      applyWalkerCamera(elapsed, env);

      /* ── Piso: textura se desplaza bajo tus pies */
      if (walkFloorEl) {
        floorOffset += (55 / 60);   // ~55px/seg de scroll, frame-rate independiente
        walkFloorEl.style.backgroundPositionY = `${-floorOffset}px`;
      }

      if (t < 1) {
        rafId = requestAnimationFrame(frame);
      } else {
        /* Llegaste. Tarjeta a su estado natural, cámara quieta. */
        card.style.transform = '';
        card.style.opacity   = '';
        if (walkFloorEl) walkFloorEl.style.backgroundPositionY = '';
        card.classList.add('active');
        stopRaf();
        if (onDone) onDone();
      }
    }

    rafId = requestAnimationFrame(frame);
  }

  /* ─── Orquesta la transición completa ──────── */
  function runCardTransition(fromIdx, toIdx) {
    cardAnimating = true;
    const from = walkCards[fromIdx];
    const to   = walkCards[toIdx];

    crossfadeBg(to.dataset.bg);

    // 1. Atraviesas la tarjeta actual (~0.8s)
    walkThrough(from, () => {
      // 2. Breve corredor vacío mientras terminas de pasar
      setTimeout(() => {
        currentCard = toIdx;
        updateWalkIndex();

        // 3. Te acercas a la siguiente (~4.5s)
        floorOffset = 0;
        walkToward(to, () => {
          cardAnimating = false;
        });
      }, 100);
    });
  }

  /* ─── Helpers walk ──────────────────────────── */
  function crossfadeBg(src) {
    if (!walkBgEl || !src) return;
    walkBgEl.style.transition = 'opacity 0.6s ease';
    walkBgEl.style.opacity    = '0';
    setTimeout(() => {
      walkBgEl.style.backgroundImage = `url('${src}')`;
      walkBgEl.style.opacity = '1';
    }, 380);
  }

  function updateWalkIndex() {
    if (walkIdxEl) walkIdxEl.textContent = `${currentCard + 1} / ${walkCards.length}`;
  }

  function resetWalkCards(startIdx) {
    stopRaf();
    currentCard   = startIdx ?? 0;
    cardAnimating = false;
    floorOffset   = 0;
    walkCards.forEach((c, i) => {
      c.classList.remove('active');
      c.style.transform = '';
      c.style.opacity   = '';
      if (i === currentCard) c.classList.add('active');
    });
    if (walkBgEl) {
      walkBgEl.style.transition     = 'none';
      walkBgEl.style.opacity        = '1';
      walkBgEl.style.backgroundImage = `url('${walkCards[currentCard].dataset.bg}')`;
    }
    if (walkFloorEl) walkFloorEl.style.backgroundPositionY = '';
    updateWalkIndex();
  }

  /* ─── Nav dentro del walk slide ─────────────── */
  function goNextCard() {
    if (cardAnimating || currentCard >= walkCards.length - 1) return false;
    runCardTransition(currentCard, currentCard + 1);
    return true;
  }
  function goPrevCard() {
    if (cardAnimating || currentCard <= 0) return false;
    runCardTransition(currentCard, currentCard - 1);
    return true;
  }

  /* ══════════════════════════════════════════════
     Navegación entre slides
  ══════════════════════════════════════════════ */
  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.classList.add('nav__dot');
    dot.setAttribute('aria-label', `Slide ${i + 1}`);
    if (i === 0) dot.classList.add('active');
    dot.addEventListener('click', e => { e.stopPropagation(); goTo(i); });
    navDots.appendChild(dot);
  });

  function goTo(index) {
    if (index < 0 || index >= totalSlides || index === current || animating) return;
    animating = true;
    const prev = current;
    current    = index;

    slides[prev].classList.remove('active');
    slides[current].classList.add('active');
    navDots.children[prev].classList.remove('active');
    navDots.children[current].classList.add('active');
    setTimeout(() => { animating = false; }, 680);

    if (current === WALK_IDX) resetWalkCards(index > prev ? 0 : walkCards.length - 1);
    if (current === IFRAME_IDX) startIframeRefresh(); else stopIframeRefresh();
    onSlideEnter(current);
  }

  function next() {
    if (current === WALK_IDX && goNextCard()) return;
    goTo(current + 1);
  }
  function prev() {
    if (current === WALK_IDX && goPrevCard()) return;
    goTo(current - 1);
  }

  prevBtn.addEventListener('click', e => { e.stopPropagation(); prev(); });
  nextBtn.addEventListener('click', e => { e.stopPropagation(); next(); });

  document.addEventListener('click', e => {
    if (e.target.closest('.nav') || e.target.closest('.effect-toggle')) return;
    if (slides[current].classList.contains('slide--iframe')) return;
    next();
  });

  document.addEventListener('keydown', e => {
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case ' ':
        e.preventDefault(); next(); break;
      case 'ArrowLeft': case 'ArrowUp':
        e.preventDefault(); prev(); break;
      case 'Escape': goTo(0); break;
    }
  });

  /* ══════════════════════════════════════════════
     Iframe auto-refresh
  ══════════════════════════════════════════════ */
  function startIframeRefresh() {
    stopIframeRefresh();
    const iframe = document.querySelector('.iframe-shell iframe');
    if (!iframe) return;
    iframeTimer = setInterval(() => {
      const src = iframe.src; iframe.src = '';
      setTimeout(() => { iframe.src = src; }, 80);
    }, REFRESH_MS);
  }
  function stopIframeRefresh() {
    if (iframeTimer) { clearInterval(iframeTimer); iframeTimer = null; }
  }

  /* ══════════════════════════════════════════════
     Callbacks de slide
  ══════════════════════════════════════════════ */
  function onSlideEnter(i) {
    if (i === MAP_IDX)     { resetMap();     setTimeout(animateMap,     300); }
    if (i === FORMULA_IDX) { resetFormula(); setTimeout(animateFormula, 150); }
  }

  /* ── Mapa ─────────────────────────────────── */
  const TOTAL_FP   = 49;
  const STEP_DELAY = 260;

  function resetMap() {
    for (let i = 1; i <= TOTAL_FP; i++) {
      const el = document.getElementById(`fp-${i}`);
      if (el) el.classList.remove('show');
    }
    const impacto = document.getElementById('impacto-reveal');
    if (impacto) impacto.classList.remove('show');
  }
  function animateMap() {
    for (let i = 1; i <= TOTAL_FP; i++) {
      setTimeout(() => {
        const el = document.getElementById(`fp-${i}`);
        if (el) el.classList.add('show');
      }, i * STEP_DELAY);
    }
    /* IMPACTO: aparece 700ms después del último paso — la persona llegó */
    const impacto = document.getElementById('impacto-reveal');
    if (impacto) {
      setTimeout(() => impacto.classList.add('show'), TOTAL_FP * STEP_DELAY + 700);
    }
  }

  /* ── Fórmula ──────────────────────────────── */
  function resetFormula() {
    document.querySelectorAll('.formula__term, .formula__result')
            .forEach(el => el.classList.remove('show'));
  }
  function animateFormula() {
    document.querySelectorAll('.formula__term').forEach((el, i) => {
      setTimeout(() => el.classList.add('show'), i * 220);
    });
    const res = document.querySelector('.formula__result');
    if (res) {
      const d = parseInt(res.style.getPropertyValue('--d')) || 960;
      setTimeout(() => res.classList.add('show'), d);
    }
  }

  /* ── Toggle ambiente ──────────────────────── */
  let currentEffect = 'a';
  document.body.classList.add('effect-a');

  const toggle = document.createElement('div');
  toggle.className = 'effect-toggle';
  toggle.innerHTML = `
    <span class="effect-toggle__label">Ambiente</span>
    <button class="effect-toggle__btn active" data-effect="a">Estático</button>
    <button class="effect-toggle__btn"        data-effect="b">Balanceo</button>
  `;
  document.body.appendChild(toggle);

  toggle.querySelectorAll('.effect-toggle__btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const chosen = btn.dataset.effect;
      if (chosen === currentEffect) return;
      currentEffect = chosen;
      document.body.classList.remove('effect-a', 'effect-b');
      document.body.classList.add(`effect-${chosen}`);
      toggle.querySelectorAll('.effect-toggle__btn').forEach(b =>
        b.classList.toggle('active', b.dataset.effect === chosen));
    });
  });

  /* ── Init ───────────────────────────────── */
  resetWalkCards(0);

})();
