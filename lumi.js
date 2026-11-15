// A personagem Lumi: uma bolinha de luz com olhos grandes, desenhada em SVG.
(function () {
  const MOUTHS = {
    idle: 'M43 64 Q50 69 57 64',
    happy: 'M40 62 Q50 75 60 62',
    laughing: 'M40 61 Q50 77 60 61 Z',
    love: 'M41 62 Q50 73 59 62',
    talking: 'M45 63 Q50 70 55 63 Q50 65 45 63',
    listening: 'M45 64 Q50 68 55 64',
    thinking: 'M44 66 Q50 64 56 65',
    surprised: 'M47 66 a3 3.5 0 1 0 6 0 a3 3.5 0 1 0 -6 0',
    sad: 'M42 69 Q50 62 58 69',
    crying: 'M41 70 Q50 61 59 70',
    angry: 'M42 67 Q50 63 58 67',
    sleeping: 'M45 65 Q50 67 55 65',
    cool: 'M42 64 Q52 70 59 62',
    proud: 'M39 61 Q50 76 61 61 Z'
  };
  // Nomes em português (usados pela IA e pela tela de expressões) → nomes internos.
  const PT = {
    repouso: 'idle', feliz: 'happy', rindo: 'laughing', carinho: 'love', descolada: 'cool', surpresa: 'surprised',
    pensando: 'thinking', triste: 'sad', chorando: 'crying', brava: 'angry', conseguiu: 'proud', dormindo: 'sleeping',
    ouvindo: 'listening', falando: 'talking'
  };
  const LABELS = {
    idle: 'Repouso', listening: 'Ouvindo', thinking: 'Pensando', talking: 'Falando', happy: 'Feliz', laughing: 'Rindo',
    love: 'Carinho', cool: 'Descolada', surprised: 'Surpresa', angry: 'Brava', sad: 'Triste', crying: 'Chorando',
    sleeping: 'Dormindo', proud: 'Conseguiu!'
  };

  // Formatos de olho (um olho, centrado em cx; o outro é espelhado).
  const EYES = {
    oval: (cx) => `<ellipse cx="${cx}" cy="49" rx="4.6" ry="7" fill="#0b1622"/><circle cx="${cx + 1.6}" cy="46" r="1.6" fill="#fff"/>`,
    redondos: (cx) => `<circle cx="${cx}" cy="49" r="6.2" fill="#0b1622"/><circle cx="${cx + 2}" cy="46.5" r="2.2" fill="#fff"/><circle cx="${cx - 2}" cy="51.5" r="0.9" fill="#fff"/>`,
    felizes: (cx) => `<path d="M${cx - 5} 51 Q${cx} 43 ${cx + 5} 51" fill="none" stroke="#0b1622" stroke-width="3.2" stroke-linecap="round"/>`,
    pixel: (cx) => `<rect x="${cx - 4}" y="43" width="8" height="11" rx="1" fill="#0b1622"/><rect x="${cx}" y="44.5" width="2.6" height="2.6" fill="#fff"/>`,
    sonolentos: (cx) => `<path d="M${cx - 5.5} 48 h11 v2 a5.5 5 0 0 1 -11 0 z" fill="#0b1622"/><circle cx="${cx + 1.6}" cy="51" r="1.2" fill="#fff"/>`
  };
  const EYE_ARC = (cx) => `<path d="M${cx - 5} 51 Q${cx} 43 ${cx + 5} 51" fill="none" stroke="#0b1622" stroke-width="3.2" stroke-linecap="round"/>`;
  const EYE_CLOSED = (cx) => `<path d="M${cx - 5} 48 Q${cx} 54 ${cx + 5} 48" fill="none" stroke="#0b1622" stroke-width="3" stroke-linecap="round"/>`;
  const EYE_HEART = (cx) => `<path d="M${cx} 54 l-5.5 -5.6 a3.2 3.2 0 0 1 5.5 -4 a3.2 3.2 0 0 1 5.5 4 z" fill="#ff5c8a"/>`;
  const EYE_STAR = (cx) => `<path d="M${cx} 42 l2 4.6 5 .4 -3.8 3.3 1.2 4.9 -4.4 -2.7 -4.4 2.7 1.2 -4.9 -3.8 -3.3 5 -.4z" fill="#ffd34d" stroke="#0b1622" stroke-width=".8"/>`;

  // Acessórios desenhados para o formato de bolinha da Lumi.
  const ACCESSORIES = {
    nenhum: { label: 'Nenhum', svg: '' },
    coroa: { label: 'Coroa', svg: '<path d="M35 23 L37 9 L44 16 L50 6 L56 16 L63 9 L65 23 Z" fill="#ffc83d" stroke="#c98a00" stroke-width="1"/><circle cx="50" cy="16" r="2" fill="#ff5c8a"/><circle cx="41" cy="19" r="1.4" fill="#5ce0ff"/><circle cx="59" cy="19" r="1.4" fill="#5ce0ff"/>' },
    fones: { label: 'Fones', svg: '<path d="M19 50 A31 31 0 0 1 81 50" fill="none" stroke="#2b2f3a" stroke-width="4"/><rect x="12" y="42" width="10" height="17" rx="5" fill="#ff6b8b"/><rect x="78" y="42" width="10" height="17" rx="5" fill="#ff6b8b"/>' },
    natal: { label: 'Natal', svg: '<path d="M27 27 Q44 0 74 12 L72 27 Z" fill="#e6343c"/><rect x="24" y="23" width="52" height="7" rx="3.5" fill="#fff"/><circle cx="75" cy="12" r="4.5" fill="#fff"/>' },
    flor: { label: 'Florzinha', svg: '<g transform="translate(70 22)"><circle cx="0" cy="-5" r="4" fill="#ff9ec7"/><circle cx="4.8" cy="-1.5" r="4" fill="#ff9ec7"/><circle cx="3" cy="4" r="4" fill="#ff9ec7"/><circle cx="-3" cy="4" r="4" fill="#ff9ec7"/><circle cx="-4.8" cy="-1.5" r="4" fill="#ff9ec7"/><circle r="3" fill="#ffd34d"/></g>' },
    festa: { label: 'Festa', svg: '<path d="M41 22 L53 -2 L61 22 Z" fill="#9b6bff"/><path d="M45 15 L58 14 M48 8 L56 8" stroke="#ffd34d" stroke-width="2.4"/><circle cx="53" cy="-3" r="3.2" fill="#ff5c8a"/>' },
    gorro: { label: 'Gorro', svg: '<path d="M22 31 Q50 -2 78 31 Z" fill="#4f7bff"/><rect x="20" y="27" width="60" height="8" rx="4" fill="#3558d4"/><circle cx="50" cy="6" r="5" fill="#fff"/>' },
    aureola: { label: 'Anjinho', svg: '<ellipse cx="50" cy="9" rx="17" ry="4.5" fill="none" stroke="#ffd34d" stroke-width="3"/>' },
    chifres: { label: 'Diabinho', svg: '<path d="M30 28 L25 9 L40 22 Z" fill="#e6343c"/><path d="M70 28 L75 9 L60 22 Z" fill="#e6343c"/>' },
    laco: { label: 'Laço', svg: '<g transform="translate(68 21) rotate(20)"><path d="M0 0 L-10 -6 L-10 6 Z M0 0 L10 -6 L10 6 Z" fill="#ff5c8a"/><circle r="2.6" fill="#e0306a"/></g>' },
    cartola: { label: 'Mordomo', svg: '<rect x="37" y="2" width="26" height="20" rx="2" fill="#1c1f27"/><rect x="37" y="15" width="26" height="4" fill="#8b5cf6"/><rect x="29" y="20" width="42" height="5" rx="2.5" fill="#1c1f27"/>' },
    oculos: { label: 'Óculos', svg: '<g fill="none" stroke="#1c1f27" stroke-width="2.2"><circle cx="40" cy="49" r="9"/><circle cx="60" cy="49" r="9"/><path d="M49 48 L51 48 M31 47 L21 44 M69 47 L79 44"/></g>' },
    broto: { label: 'Brotinho', svg: '<path d="M50 20 L50 9" stroke="#3fae5f" stroke-width="2.4" stroke-linecap="round"/><path d="M50 12 Q42 4 37 9 Q43 15 50 12 Z" fill="#5fd38a"/><path d="M50 10 Q57 2 63 6 Q57 13 50 10 Z" fill="#5fd38a"/>' }
  };

  let seq = 0;
  const instances = [];
  let eyeStyle = 'oval';
  let accessory = 'nenhum';

  function eyeGroup(cx) {
    return `<g class="eye">
      <g class="e-open">${(EYES[eyeStyle] || EYES.oval)(cx)}</g>
      <g class="e-arc">${EYE_ARC(cx)}</g>
      <g class="e-closed">${EYE_CLOSED(cx)}</g>
      <g class="e-heart">${EYE_HEART(cx)}</g>
      <g class="e-star">${EYE_STAR(cx)}</g>
    </g>`;
  }

  function build(inst) {
    const id = inst.id;
    inst.slot.innerHTML = `
      <svg class="lumi" viewBox="0 0 100 100" data-mood="${current}">
        <defs>
          <radialGradient id="${id}-aura"><stop offset="40%" stop-color="var(--lumi)" stop-opacity=".55"/><stop offset="100%" stop-color="var(--lumi)" stop-opacity="0"/></radialGradient>
          <radialGradient id="${id}-core" cx="38%" cy="32%" r="75%"><stop offset="0%" stop-color="#ffffff"/><stop offset="35%" stop-color="var(--lumi)"/><stop offset="100%" stop-color="color-mix(in srgb, var(--lumi) 60%, #1b2a6b)"/></radialGradient>
        </defs>
        <circle class="aura" cx="50" cy="50" r="49" fill="url(#${id}-aura)"/>
        <g class="orbit"><circle cx="50" cy="12" r="2.5" fill="#fff"/><circle cx="88" cy="50" r="1.8" fill="#fff" opacity=".7"/></g>
        <g class="body">
          <circle cx="50" cy="52" r="33" fill="url(#${id}-core)"/>
          <ellipse cx="38" cy="38" rx="8" ry="5" fill="#fff" opacity=".35" transform="rotate(-25 38 38)"/>
          <g class="eyes">${eyeGroup(40)}${eyeGroup(60)}</g>
          <g class="tears"><path d="M36 56 q-2 5 0 7 q2 -2 0 -7z" fill="#7fd3ff"/><path d="M64 56 q-2 5 0 7 q2 -2 0 -7z" fill="#7fd3ff"/></g>
          <ellipse class="cheek" cx="32" cy="60" rx="4.5" ry="2.6"/>
          <ellipse class="cheek" cx="68" cy="60" rx="4.5" ry="2.6"/>
          <path class="mouth" d="${MOUTHS[current] || MOUTHS.idle}"/>
          <g class="brows"><path d="M34 39 L45 42" stroke="#0b1622" stroke-width="2.6" stroke-linecap="round"/><path d="M66 39 L55 42" stroke="#0b1622" stroke-width="2.6" stroke-linecap="round"/></g>
          <g class="shades"><rect x="31" y="43" width="17" height="10" rx="4" fill="#0b1622"/><rect x="52" y="43" width="17" height="10" rx="4" fill="#0b1622"/><path d="M48 47 L52 47" stroke="#0b1622" stroke-width="2"/><path d="M34 45 L40 45" stroke="#fff" stroke-width="1.4" opacity=".6"/></g>
          <g class="accessory">${(ACCESSORIES[accessory] || ACCESSORIES.nenhum).svg}</g>
        </g>
        <path class="spark" d="M84 22 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z"/>
        <path class="spark" d="M14 70 l1.4 3.5 3.5 1.4 -3.5 1.4 -1.4 3.5 -1.4 -3.5 -3.5 -1.4 3.5 -1.4z"/>
        <text class="zzz" x="74" y="28">z</text>
        <circle class="fly" r="1.6" fill="#0b1622" opacity="0"/>
        <circle class="ball" r="4" fill="#ff8a5c" opacity="0"/>
      </svg>`;
    const svg = inst.slot.querySelector('svg');
    Object.assign(inst, {
      svg, mouth: svg.querySelector('.mouth'), eyes: svg.querySelector('.eyes'),
      fly: svg.querySelector('.fly'), ball: svg.querySelector('.ball')
    });
  }

  function create(slot, opts = {}) {
    const inst = { id: 'l' + seq++, slot, fixedMood: opts.mood || null };
    if (inst.fixedMood) {
      // Instância estática (para as galerias de expressões, olhos e acessórios)
      const saved = [current, eyeStyle, accessory];
      current = inst.fixedMood;
      if (opts.eyes) eyeStyle = opts.eyes;
      if (opts.accessory) accessory = opts.accessory;
      build(inst);
      [current, eyeStyle, accessory] = saved;
      inst.static = true;
    } else {
      build(inst);
      instances.push(inst);
    }
    return inst;
  }

  let current = 'idle';
  let revertTimer = null;
  let lastActivity = Date.now();
  let playing = false;

  function apply(m) {
    for (const i of instances) {
      i.svg.dataset.mood = m;
      i.mouth.setAttribute('d', MOUTHS[m] || MOUTHS.idle);
    }
  }

  /** Muda a expressão (nome em português ou interno). Com `ms`, volta ao normal depois. */
  function mood(m, ms) {
    m = PT[m] || m;
    if (!MOUTHS[m]) m = 'happy';
    clearTimeout(revertTimer);
    current = m;
    apply(m);
    if (m !== 'sleeping') lastActivity = Date.now();
    if (ms) revertTimer = setTimeout(() => mood('idle'), ms);
  }

  function look(dx, dy) {
    for (const i of instances) i.eyes.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function poke() {
    lastActivity = Date.now();
    if (current === 'sleeping') mood('surprised', 900);
  }

  function setLook({ eyes, acc }) {
    if (eyes) eyeStyle = eyes;
    if (acc) accessory = acc;
    for (const i of instances) build(i);
  }

  // Comportamentos quando está à toa: olha em volta, persegue mosquinha, brinca com a bolinha e cochila.
  setInterval(() => {
    if (current !== 'idle' || playing) return;
    if (Date.now() - lastActivity > 4 * 60 * 1000) return mood('sleeping');
    const r = Math.random();
    if (r < 0.08) chaseFly();
    else if (r < 0.14) playBall();
    else if (r < 0.6) look((Math.random() * 6 - 3).toFixed(1), (Math.random() * 4 - 2).toFixed(1));
    else look(0, 0);
  }, 2600);

  function animateOn(prop, fn, seconds) {
    const big = instances[instances.length - 1];
    if (!big) return;
    playing = true;
    const el = big[prop];
    const start = performance.now();
    el.setAttribute('opacity', '1');
    const step = (t) => {
      const k = (t - start) / 1000;
      if (k > seconds || current !== 'idle') { el.setAttribute('opacity', '0'); look(0, 0); playing = false; return; }
      const [x, y] = fn(k);
      el.setAttribute('cx', x);
      el.setAttribute('cy', y);
      look(((x - 50) / 42 * 3.5).toFixed(2), ((y - 48) / 30 * 2.5).toFixed(2));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function chaseFly() {
    animateOn('fly', (k) => [50 + Math.cos(k * 2.3) * 42 + Math.sin(k * 7) * 4, 46 + Math.sin(k * 3.1) * 30], 4);
  }
  function playBall() {
    // A bolinha quica de um lado para o outro na frente da Lumi.
    animateOn('ball', (k) => [50 + Math.sin(k * 1.6) * 40, 92 - Math.abs(Math.sin(k * 4.2)) * 26], 5);
  }

  window.LumiFace = {
    create, mood, look, poke, setLook, MOUTHS, LABELS, ACCESSORIES, EYES: Object.keys(EYES),
    get current() { return current; }
  };
})();
