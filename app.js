// Lumi no celular: lê e grava as mesmas tarefas, lembretes, hábitos e notas do PC (via Supabase)
// e controla o PC de longe (música, volume, rotinas e pedidos), com o PC ligado.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const SUPABASE_URL = 'https://hdzvvpuzqqidznssgwmk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GVM5NEBaI7trMxXgXqwG7w_XMwzZIWF'; // chave pública (os dados são protegidos por login)
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayKey = () => new Date().toLocaleDateString('sv-SE');
const fmtClock = (ms) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtLeft = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
const fmtDay = (ms) => {
  const d = new Date(ms), t = new Date(), tm = new Date(); tm.setDate(t.getDate() + 1);
  return d.toDateString() === t.toDateString() ? 'hoje' : d.toDateString() === tm.toDateString() ? 'amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
};
const fmtWhen = (ms) => `${fmtDay(ms)} às ${fmtClock(ms)}`;
const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60e3); return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : m < 1440 ? `há ${Math.round(m / 60)} h` : fmtWhen(ms); };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400); }

// ---------- Vibração ----------
const HAPTIC_KEY = 'lumi-haptic';
let hapticOn = true;
try { hapticOn = localStorage.getItem(HAPTIC_KEY) !== '0'; } catch {}
const buzz = (p = 12) => { if (hapticOn && navigator.vibrate) try { navigator.vibrate(p); } catch {} };
document.addEventListener('click', (e) => { if (e.target.closest('button')) buzz(); }, true);

// ---------- Dados (cache local das linhas de lumi_items) ----------
const db = { task: new Map(), reminder: new Map(), note: new Map(), habit: new Map(), snippet: new Map(), timer: new Map(), doc: new Map(), alert: new Map(), proposal: new Map() };
const list = (kind) => [...db[kind].values()];
const list_ = list;
const docv = (id) => db.doc.get(id) ?? null;
const strip = (o) => { const { id, ...rest } = o; return rest; };
let user = null;

function applyRow(row) {
  const m = db[row.kind];
  if (!m) return;
  if (row.deleted || row.data == null) m.delete(row.id);
  else m.set(row.id, { ...row.data, id: row.id });
}
async function loadAll() {
  const { data, error } = await sb.from('lumi_items').select('kind,id,data,deleted').eq('deleted', false).neq('kind', 'cmd');
  if (error) throw error;
  Object.values(db).forEach((m) => m.clear());
  (data ?? []).forEach(applyRow);
  renderAll();
}
async function put(kind, id, data) {
  // null (ex.: Pomodoro parado) vira "apagado" na nuvem
  applyRow({ kind, id, data, deleted: data == null });
  renderAll();
  const { error } = await sb.from('lumi_items').upsert({ kind, id, data: data ?? {}, deleted: data == null }, { onConflict: 'user_id,kind,id' });
  if (error) toast('Não salvou: ' + error.message);
}
async function del(kind, id) {
  db[kind].delete(id);
  renderAll();
  const { error } = await sb.from('lumi_items').update({ deleted: true }).eq('kind', kind).eq('id', id);
  if (error) toast('Não apagou: ' + error.message);
}
let channel = null;
function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('lumi-items')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lumi_items', filter: `user_id=eq.${user.id}` }, (p) => {
      const row = p.new;
      if (!row || !row.kind) return;
      if (row.kind === 'cmd') return onCommandDone(row);
      applyRow(row); renderAll();
    })
    .subscribe();
}

// ---------- Personagem ----------
const settings = () => docv('settings') ?? {};
let speakNext = false; // a próxima resposta sai falada (pergunta feita por voz)
function say(text, mood = 'feliz', { speak } = {}) {
  $('#bubble').textContent = text;
  if (speak ?? $('#speak-toggle').checked) speakText(text, mood);
  else LumiFace.mood(mood, 2500);
}

// ---------- Áudio (voz do Gemini, a mesma do PC) ----------
let ac = null;
/** O iPhone só deixa tocar som depois de um toque: destrava o áudio no primeiro toque. */
function unlockAudio() {
  try {
    if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state !== 'running') ac.resume();
    const b = ac.createBuffer(1, 1, 22050), src = ac.createBufferSource();
    src.buffer = b; src.connect(ac.destination); src.start(0);
    // A voz do celular (reserva) também precisa ser destravada por um toque, uma vez.
    if (!unlockAudio.tts && 'speechSynthesis' in window) { unlockAudio.tts = true; const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
  } catch {}
}
document.addEventListener('touchend', unlockAudio, { passive: true });
document.addEventListener('click', unlockAudio);
let playing = null;
let speakSeq = 0;
let ttsBlockedUntil = 0;
function stopSpeaking() { speakSeq++; try { playing && playing.stop(); } catch {} playing = null; try { speechSynthesis.cancel(); } catch {} }
const b64ToBuf = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer;
async function speakText(text, mood) {
  stopSpeaking();
  const clean = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();
  if (!clean) return LumiFace.mood(mood, 2500);
  const seq = ++speakSeq;
  try {
    // A cota de voz do Gemini acabou há pouco: vai direto para a voz do celular (sem esperar o erro).
    if (Date.now() < ttsBlockedUntil) throw new Error('cota');
    // Respostas longas: a primeira frase vai sozinha para começar a falar antes; o resto é gerado junto.
    const m = clean.length >= 140 && /^(.{20,160}?[.!?…])\s+(.+)$/s.exec(clean);
    const parts = m ? [m[1], m[2]] : [clean];
    const jobs = parts.map((p) => callFn('lumi-voice', { action: 'tts', text: p }));
    jobs.forEach((j) => j.catch(() => {}));
    for (let i = 0; i < jobs.length; i++) {
      let j;
      try { j = await jobs[i]; } catch (e) { if (i === 0) throw e; break; }
      if (seq !== speakSeq) return;
      if (!j.audio) { if (i === 0) throw new Error('sem áudio'); continue; }
      unlockAudio();
      const buf = await ac.decodeAudioData(b64ToBuf(j.audio));
      if (seq !== speakSeq) return;
      await new Promise((resolve) => {
        const src = ac.createBufferSource();
        src.buffer = buf; src.connect(ac.destination);
        src.onended = () => { if (playing === src) playing = null; resolve(); };
        playing = src; LumiFace.mood('talking'); src.start(0);
      });
      if (seq !== speakSeq) return;
    }
    LumiFace.mood(mood, 1800);
  } catch (e) {
    if (seq !== speakSeq) return;
    if (e.status === 429) ttsBlockedUntil = Date.now() + 10 * 60e3;
    // Reserva: voz do próprio celular
    if (!('speechSynthesis' in window)) return LumiFace.mood(mood, 2500);
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'pt-BR'; u.rate = 1.05;
    const v = speechSynthesis.getVoices().find((x) => /pt-BR/i.test(x.lang));
    if (v) u.voice = v;
    u.onstart = () => LumiFace.mood('talking');
    u.onend = () => LumiFace.mood(mood, 1800);
    speechSynthesis.speak(u);
  }
}
let lookKey = '';
function applyLook() {
  const s = settings();
  document.documentElement.style.setProperty('--lumi', s.color || '#7cc8ff');
  const key = `${s.eyes}|${s.accessory}`;
  if (key !== lookKey) { lookKey = key; LumiFace.setLook({ eyes: s.eyes || 'oval', acc: s.accessory || 'nenhum' }); }
}

// ---------- Nível e XP (o mesmo do PC) ----------
function levelOf(points) {
  let level = 1, need = 50, acc = 0;
  while (points >= acc + need) { acc += need; level++; need = Math.round(need * 1.25); }
  return { level, points, inLevel: points - acc, need, pct: Math.round(((points - acc) / need) * 100) };
}
function addXp(points) {
  const before = levelOf((docv('xp') || {}).points || 0);
  const now = Math.max(0, before.points + points);
  put('doc', 'xp', { points: now });
  const after = levelOf(now);
  if (after.level > before.level) { buzz([30, 60, 30, 60, 80]); setTimeout(() => say(`Subi para o nível ${after.level}! 🎉`, 'conseguiu'), 400); }
}
function renderLevel() {
  const l = levelOf((docv('xp') || {}).points || 0);
  $('#lvl-n').textContent = `Nível ${l.level}`;
  $('#lvl-bar').style.width = l.pct + '%';
  $('#lvl-pts').textContent = `${l.inLevel}/${l.need} XP`;
}

// ---------- Abas ----------
function showTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  $('#ask').hidden = !(name === 'home' || name === 'chat');
  $('#views').scrollTop = 0;
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) showTab(g.dataset.goto); });

// ---------- Controle do PC ----------
const sentCmds = new Map();
const pcOnline = () => { const p = docv('pc'); return Boolean(p && Date.now() - (p.at || 0) < 11 * 60e3); };
async function sendCmd(data, label) {
  const id = uid();
  sentCmds.set(id, label || 'Pedido');
  const { error } = await sb.from('lumi_items').upsert({ kind: 'cmd', id, data: { ...data, at: Date.now(), from: 'celular' }, deleted: false }, { onConflict: 'user_id,kind,id' });
  if (error) return toast('Não enviei: ' + error.message);
  toast(pcOnline() ? `${label || 'Pedido'} enviado ao PC` : 'Enviado. O PC parece desligado: ele faz se ligar nos próximos 10 min.');
  setTimeout(() => { if (sentCmds.has(id)) { sentCmds.delete(id); toast('O PC não respondeu. Ele está ligado?'); } }, 25e3);
}
function onCommandDone(row) {
  if (!row.data?.done || !sentCmds.has(row.id)) return;
  sentCmds.delete(row.id);
  const r = String(row.data.result || 'feito');
  if (/^erro/i.test(r)) toast('PC: ' + r);
  else if (row.data.text) say(`O PC recebeu: "${row.data.text}" ✅`, 'conseguiu');
  else toast('PC: ' + r + ' ✅');
}
$('#pc-player').addEventListener('click', (e) => {
  const b = e.target.closest('[data-op]'); if (!b) return;
  const op = b.dataset.op;
  if (op === 'vol-up' || op === 'vol-down') return sendCmd({ action: 'volume', delta: op === 'vol-up' ? 10 : -10 }, 'Volume');
  if (op === 'mute') return sendCmd({ action: 'volume', mute: true }, 'Mudo');
  if (op === 'ask') { showTab('chat'); $('#ask-input').focus(); $('#ask-input').placeholder = 'Ex.: toca Jorge e Mateus no PC'; return; }
  sendCmd({ action: 'music', op }, op === 'toggle' ? 'Play/pausa' : op === 'next' ? 'Próxima' : 'Anterior');
});
$('#routine-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-routine]'); if (!b) return;
  const r = (settings().routines || []).find((x) => x.id === b.dataset.routine);
  if (r) sendCmd({ action: 'routine', id: r.id }, `Rotina "${r.name}"`);
});
$('#pc-ask').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('#pc-ask-input').value.trim(); if (!t) return;
  $('#pc-ask-input').value = '';
  sendCmd({ text: t }, 'Pedido');
});

function renderPlayer() {
  const np = docv('nowPlaying');
  const online = pcOnline();
  const status = `<span class="small muted"><span class="dot ${online ? 'on' : ''}"></span>PC ${online ? 'ligado' : 'desligado'}</span>`;
  const has = np && np.has;
  const vol = np && np.volume != null ? np.volume : null;
  $('#pc-player').innerHTML = `
    <div class="card-h"><span>${has ? (np.playing ? 'Tocando no PC' : 'Pausado no PC') : 'Música no PC'}</span>${status}</div>
    <div class="player"><div class="art">${has ? '♪' : '♫'}</div>
      <div class="np"><b>${has ? esc(np.title || 'Sem título') : 'Nada tocando'}</b><div>${has ? esc(np.artist || np.app || '') : 'Peça uma música para a Lumi'}</div></div></div>
    <div class="ctls">
      <button class="ctl" data-op="prev" aria-label="Anterior">⏮</button>
      <button class="ctl main" data-op="toggle" aria-label="Tocar ou pausar">${has && np.playing ? '⏸' : '▶'}</button>
      <button class="ctl" data-op="next" aria-label="Próxima">⏭</button>
      <button class="ctl" data-op="ask" aria-label="Pedir música">🔎</button>
    </div>
    <div class="vol"><button class="ctl" data-op="vol-down" style="flex:none;width:42px">−</button><span>🔊</span><span class="bar"><i style="width:${vol ?? 0}%"></i></span><span>${vol != null ? vol + '%' : '—'}</span><button class="ctl" data-op="vol-up" style="flex:none;width:42px">+</button></div>`;
}
function renderRoutines() {
  const rs = settings().routines || [];
  $('#routines-card').hidden = !rs.length;
  $('#routine-chips').innerHTML = rs.map((r) => `<button data-routine="${esc(r.id)}">▶ ${esc(r.name)}</button>`).join('');
}

// ---------- Conversa ----------
const history = [];
function addMsg(kind, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + kind; d.textContent = text;
  $('#chat-log').appendChild(d);
  $('#suggestions').style.display = 'none';
  $('#views').scrollTop = 1e9;
  return d;
}
async function callFn(name, body) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `erro ${r.status}`); e.status = r.status; throw e; }
  return j;
}
let busy = false;
async function ask(text) {
  text = String(text || '').trim();
  const photo = chatPhoto;
  if ((!text && !photo) || busy) return;
  if (!text) text = 'O que é isso?';
  busy = true;
  showTab('chat');
  addMsg('me', (photo ? '📷 ' : '') + text);
  if (photo) clearPhoto();
  const typing = addMsg('bot typing', '…');
  LumiFace.mood('thinking');
  try {
    const j = await callFn('lumi-chat', { text, history: history.slice(-12), images: photo ? [{ mime: photo.mime, data: photo.data }] : undefined });
    typing.remove();
    addMsg('bot', j.text);
    history.push({ role: 'user', text }, { role: 'assistant', text: j.text });
    if (j.copy) { try { await navigator.clipboard.writeText(j.copy); toast('Copiado! 📋'); } catch { toast('Toque em Mais → Textos para copiar'); } }
    say(j.text, j.mood || 'feliz', speakNext ? { speak: true } : {});
    speakNext = false;
    buzz([10, 40, 10]);
    if (j.changed?.length) loadAll();
  } catch (e) {
    typing.remove();
    addMsg('bot', 'Ops: ' + e.message);
    say('Algo deu errado. 😕', 'triste');
  } finally { busy = false; }
}
$('#ask').addEventListener('submit', (e) => { e.preventDefault(); unlockAudio(); const v = $('#ask-input').value; $('#ask-input').value = ''; if (v.trim() || chatPhoto) ask(v); });
$('#suggestions').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') ask(e.target.textContent); });

// Voz pelo microfone: grava aqui e transcreve no Gemini (bem mais confiável que o ditado do navegador).
// Para sozinho quando você para de falar; toque de novo para parar antes.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function wavBase64(chunks, rate) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const ratio = rate / 16000, len = Math.floor(total / ratio);
  const all = new Float32Array(total); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const view = new DataView(new ArrayBuffer(44 + len * 2));
  const w = (p, str) => { for (let i = 0; i < str.length; i++) view.setUint8(p + i, str.charCodeAt(i)); };
  w(0, 'RIFF'); view.setUint32(4, 36 + len * 2, true); w(8, 'WAVE'); w(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); w(36, 'data'); view.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) {
    // média simples ao reduzir a taxa (evita chiado)
    const a = Math.floor(i * ratio), b = Math.min(total, Math.floor((i + 1) * ratio)); let sum = 0;
    for (let k = a; k < b; k++) sum += all[k];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, b - a)));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  const bytes = new Uint8Array(view.buffer); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function listen() {
  stopSpeaking();
  unlockAudio();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch { return toast('Permita o microfone para a Lumi nas configurações do celular 🎙'); }
  if (ac.state !== 'running') await ac.resume().catch(() => {});
  const src = ac.createMediaStreamSource(stream);
  const proc = ac.createScriptProcessor(4096, 1, 1);
  const mute = ac.createGain(); mute.gain.value = 0;
  src.connect(proc); proc.connect(mute); mute.connect(ac.destination);
  const chunks = [], rate = ac.sampleRate, t0 = Date.now();
  let floor = 0, n = 0, spoke = false, lastVoice = 0, done = false;
  const finish = (send) => {
    if (done) return; done = true;
    try { proc.disconnect(); src.disconnect(); mute.disconnect(); } catch {}
    stream.getTracks().forEach((t) => t.stop());
    $('#mic').classList.remove('on'); rec = null;
    if (!send || !spoke) { LumiFace.mood('idle'); $('#bubble').textContent = 'Não ouvi nada. Toque no 🎙 e fale.'; return; }
    transcribe(chunks, rate);
  };
  rec = { stop: () => finish(true) };
  proc.onaudioprocess = (e) => {
    if (done) return;
    const d = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(d);
    let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / (d.length / 4)), now = Date.now();
    if (n < 3) { floor = (floor * n + rms) / (n + 1); n++; return; } // mede o ruído do ambiente
    const voice = rms > Math.max(0.012, floor * 2.5);
    if (voice) { spoke = true; lastVoice = now; }
    $('#bubble').textContent = spoke ? 'Ouvindo… 👂' + (voice ? ' 🔊' : '') : 'Pode falar! 👂';
    if (spoke && now - lastVoice > 1300) finish(true);           // parou de falar
    else if (!spoke && now - t0 > 7000) finish(false);           // ninguém falou
    else if (now - t0 > 30000) finish(true);                     // limite de 30 s
  };
  $('#mic').classList.add('on'); LumiFace.mood('listening'); $('#bubble').textContent = 'Pode falar! 👂';
  buzz(20);
}
async function transcribe(chunks, rate) {
  LumiFace.mood('thinking'); $('#bubble').textContent = 'Entendendo… ✨';
  try {
    const j = await callFn('lumi-voice', { action: 'stt', audio: wavBase64(chunks, rate) });
    const text = (j.text || '').trim();
    if (!text) { LumiFace.mood('idle'); $('#bubble').textContent = 'Não entendi. Pode repetir? 🎙'; return; }
    speakNext = true;
    ask(text);
  } catch (e) {
    LumiFace.mood('triste', 2000);
    $('#bubble').textContent = 'Não consegui ouvir: ' + e.message;
  }
}
// Reserva: ditado do navegador (se a voz na nuvem não estiver pronta)
function listenBrowser() {
  if (!SR) return toast('Use o microfone do teclado para ditar 🎙');
  const r = new SR();
  r.lang = 'pt-BR'; r.interimResults = true; r.maxAlternatives = 1;
  let final = '';
  rec = r;
  $('#mic').classList.add('on'); LumiFace.mood('listening'); $('#bubble').textContent = 'Pode falar! 👂';
  r.onresult = (e) => { let interim = ''; for (const x of e.results) (x.isFinal ? (final = x[0].transcript) : (interim += x[0].transcript)); $('#bubble').textContent = (final || interim) + '…'; };
  r.onend = () => { $('#mic').classList.remove('on'); rec = null; if (final) { speakNext = true; ask(final); } else LumiFace.mood('idle'); };
  r.onerror = () => { $('#mic').classList.remove('on'); rec = null; };
  r.start();
}
let cloudVoice = null; // null = ainda não sei; true/false depois de perguntar ao servidor
async function checkCloudVoice() { try { cloudVoice = Boolean((await callFn('lumi-voice', { action: 'status' })).ready); } catch { cloudVoice = false; } }
$('#mic').addEventListener('click', () => {
  if (rec) { rec.stop(); return; }
  const canRecord = navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext);
  if (cloudVoice !== false && canRecord) listen(); else listenBrowser();
});

// ---------- Água e hábitos ----------
async function water(delta) {
  let w = docv('water');
  if (!w || w.date !== todayKey()) w = { date: todayKey(), count: 0 };
  w = { ...strip(w), count: Math.max(0, w.count + delta) };
  await put('doc', 'water', w);
  const goal = settings().waterGoal || 8;
  if (delta > 0) {
    addXp(w.count === goal ? 12 : 2);
    say(w.count >= goal ? 'Meta de água batida! 💧🎉' : `Mais um copo! ${w.count}/${goal} 💧`, w.count >= goal ? 'conseguiu' : 'feliz');
  }
}
$('#habit-grid').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-habit]'); if (!card || e.target.tagName !== 'BUTTON') return;
  const delta = e.target.dataset.d === '+' ? 1 : -1;
  if (card.dataset.habit === 'agua') return water(delta);
  const log = strip({ ...(docv('habitLog') ?? {}) });
  const day = { ...(log[todayKey()] || {}) };
  day[card.dataset.habit] = Math.max(0, (day[card.dataset.habit] || 0) + delta);
  log[todayKey()] = day;
  await put('doc', 'habitLog', log);
  const h = db.habit.get(card.dataset.habit);
  if (delta > 0 && h && day[h.id] === h.goal) { addXp(15); say(`${h.icon} ${h.name}: meta cumprida! 🎉`, 'conseguiu'); }
});
function renderHabits() {
  const w = docv('water'); const wc = w && w.date === todayKey() ? w.count : 0;
  const goal = settings().waterGoal || 8;
  const log = (docv('habitLog') ?? {})[todayKey()] || {};
  const card = (id, icon, name, c, g, unit) => `<div class="habit ${c >= g ? 'done' : ''}" data-habit="${esc(id)}"><div class="habit-top">${icon} ${esc(name)}</div><div><b>${c}</b>/${g} <span class="muted small">${esc(unit)}</span></div><div class="timer-bar"><i style="width:${Math.min(100, 100 * c / (g || 1))}%"></i></div><div class="btns"><button data-d="-">−</button><button data-d="+">+</button></div></div>`;
  $('#habit-grid').innerHTML = card('agua', '💧', 'Água', wc, goal, 'copos') + list('habit').map((h) => card(h.id, h.icon || '⭐', h.name, log[h.id] || 0, h.goal || 1, h.unit || '')).join('');
}

// ---------- Início ----------
function renderStats() {
  const pend = list('task').filter((t) => !t.done).length;
  const w = docv('water'); const wc = w && w.date === todayKey() ? w.count : 0;
  const goal = settings().waterGoal || 8;
  const endDay = new Date(); endDay.setHours(23, 59, 59, 999);
  const remToday = list('reminder').filter((r) => !r.fired && r.at <= endDay.getTime()).length;
  const f = docv('focus');
  const stat = (ico, val, label, go) => `<button class="stat" data-goto="${go}"><span class="ico">${ico}</span><b>${val}</b><span>${label}</span></button>`;
  $('#stats').innerHTML =
    stat('✓', pend, pend === 1 ? 'tarefa pendente' : 'tarefas pendentes', 'tasks') +
    stat('💧', `${wc}/${goal}`, 'copos de água', 'home') +
    stat('⏰', remToday, remToday === 1 ? 'lembrete hoje' : 'lembretes hoje', 'tasks') +
    stat('◔', f && f.phase ? fmtLeft(f.endsAt - Date.now()) : '—', f && f.phase ? PHASE[f.phase] : 'foco parado', 'focus');
}
let events = [];
async function loadEvents() {
  try { const j = await callFn('lumi-gcal', { action: 'events', days: 3 }); events = Array.isArray(j) ? j : []; } catch { events = []; }
  renderNext();
}
function renderNext() {
  const now = Date.now();
  const items = [
    ...list('reminder').filter((r) => !r.fired && r.at > now - 60e3).map((r) => ({ at: r.at, icon: r.alarm ? '🔔' : '⏰', text: r.text })),
    ...list('task').filter((t) => !t.done && t.due).map((t) => ({ at: new Date(t.due).getTime(), icon: '✓', text: t.text })),
    ...events.map((e) => ({ at: new Date(e.start).getTime(), icon: '📅', text: e.title, allDay: e.allDay })).filter((e) => e.at > now - 3600e3 || e.allDay),
  ].filter((x) => Number.isFinite(x.at)).sort((a, b) => a.at - b.at).slice(0, 6);
  $('#next-list').innerHTML = items.length
    ? items.map((x) => `<li><span>${x.icon}</span><span class="grow">${esc(x.text)}</span><span class="when">${x.allDay ? fmtDay(x.at) : fmtWhen(x.at)}</span></li>`).join('')
    : '<li class="empty">Nada marcado. Dia livre! 🌿</li>';
}
const WMO = (c) => (c === 0 ? ['☀️', 'céu limpo'] : c <= 2 ? ['🌤', 'poucas nuvens'] : c === 3 ? ['☁️', 'nublado'] : c <= 48 ? ['🌫', 'neblina'] : c <= 57 ? ['🌦', 'garoa'] : c <= 67 ? ['🌧', 'chuva'] : c <= 77 ? ['❄️', 'neve'] : c <= 82 ? ['🌦', 'pancadas'] : ['⛈', 'tempestade']);
async function loadWeather() {
  const s = settings();
  if (s.lat == null) { $('#weather').innerHTML = '<span class="muted">Defina sua cidade na Central da Lumi (PC).</span>'; return; }
  try {
    const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`)).json();
    const [ico, txt] = WMO(j.current.weather_code);
    $('#weather').innerHTML = `<div class="wx"><b>${ico} ${Math.round(j.current.temperature_2m)}°</b><div class="muted">${txt}<br>${Math.round(j.daily.temperature_2m_min[0])}° / ${Math.round(j.daily.temperature_2m_max[0])}° · 💧${j.daily.precipitation_probability_max[0]}%<br>${esc(s.city || '')}</div></div>`;
  } catch { $('#weather').innerHTML = '<span class="muted">Sem conexão.</span>'; }
}
async function loadQuotes() {
  try {
    const j = await (await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,BTC-BRL')).json();
    const row = (k, n, dec) => { const q = j[k]; if (!q) return ''; const p = Number(q.pctChange); return `<div class="q"><span>${n}</span><span>R$ ${Number(q.bid).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })} <span class="${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'}</span></span></div>`; };
    $('#quotes').innerHTML = row('USDBRL', 'Dólar', 2) + row('EURBRL', 'Euro', 2) + row('BTCBRL', 'Bitcoin', 0);
  } catch { $('#quotes').innerHTML = '<span class="muted">Sem conexão.</span>'; }
}

// ---------- Tarefas ----------
const PRIO = ['', '🔵', '🟡', '🔴'];
const expanded = new Set();
$('#task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#task-input').value.trim();
  if (!text) return;
  $('#task-input').value = '';
  put('task', uid(), { text, done: false, createdAt: Date.now(), priority: 0, subtasks: [], due: null });
});
$('#task-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]'); if (!li) return;
  const t = db.task.get(li.dataset.id); if (!t) return;
  const sub = e.target.closest('[data-sub]');
  if (sub) {
    const subs = t.subtasks.map((s) => (s.id === sub.dataset.sub ? { ...s, done: !s.done } : s));
    if (e.target.classList.contains('x')) return put('task', t.id, { ...strip(t), subtasks: t.subtasks.filter((s) => s.id !== sub.dataset.sub) });
    if (e.target.classList.contains('check-box')) return put('task', t.id, { ...strip(t), subtasks: subs });
    return;
  }
  if (e.target.closest('.sub-form')) return;
  if (e.target.classList.contains('x') && !e.target.classList.contains('prio')) return del('task', t.id);
  if (e.target.classList.contains('prio')) return put('task', t.id, { ...strip(t), priority: ((t.priority || 0) + 1) % 4 });
  if (e.target.classList.contains('check-box')) {
    if (!t.done) { buzz([15, 50, 25]); addXp(10); say('Mandou bem! ✅ +10 XP', 'conseguiu'); }
    return put('task', t.id, { ...strip(t), done: !t.done });
  }
  expanded.has(t.id) ? expanded.delete(t.id) : expanded.add(t.id); renderTasks();
});
$('#task-list').addEventListener('submit', (e) => {
  e.preventDefault();
  const id = e.target.dataset.task, input = e.target.querySelector('input');
  const t = db.task.get(id);
  if (!t || !input.value.trim()) return;
  put('task', id, { ...strip(t), subtasks: [...(t.subtasks || []), { id: uid(), text: input.value.trim(), done: false }] });
});
function renderTasks() {
  const tasks = list('task').sort((a, b) => a.done - b.done || (b.priority || 0) - (a.priority || 0) || b.createdAt - a.createdAt);
  $('#task-list').innerHTML = tasks.length ? tasks.map((t) => {
    const subs = t.subtasks || [];
    const open = expanded.has(t.id);
    return `<li data-id="${esc(t.id)}" class="task ${t.done ? 'done' : ''}">
      <div class="task-row"><button class="check-box" aria-label="Concluir"></button>
      <span class="grow">${esc(t.text)}${subs.length ? ` <span class="muted small">· ${subs.filter((s) => s.done).length}/${subs.length}</span>` : ''}${t.from ? ` <span class="who">👤 ${esc(t.from)}</span>` : ''}${t.due && !t.done ? `<br><span class="muted small">até ${fmtWhen(new Date(t.due).getTime())}</span>` : ''}</span>
      <button class="x prio" aria-label="Prioridade">${PRIO[t.priority || 0] || '⚑'}</button><button class="x" aria-label="Apagar">✕</button></div>
      ${open ? `<ul class="subs">${subs.map((s) => `<li class="sub-li ${s.done ? 'done' : ''}" data-sub="${esc(s.id)}"><button class="check-box"></button><span class="grow">${esc(s.text)}</span><button class="x">✕</button></li>`).join('')}</ul>
      <form class="sub-form row" data-task="${esc(t.id)}" style="margin:6px 0 0 34px"><input placeholder="Subtarefa…" /><button class="btn ghost">+</button></form>` : ''}
    </li>`;
  }).join('') : '<li class="empty">Nenhuma tarefa. Que paz! 🌿</li>';
}

// ---------- Lembretes ----------
const REP = { none: '', daily: '🔁 todo dia', weekdays: '🔁 dias úteis', weekly: '🔁 toda semana', monthly: '🔁 todo mês' };
function defaultAt() {
  const d = new Date(Date.now() + 3600e3); d.setMinutes(0, 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
$('#rem-at').value = defaultAt();
$('#rem-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#rem-text').value.trim();
  const at = new Date($('#rem-at').value).getTime();
  if (!text || !Number.isFinite(at)) return toast('Preencha o texto e o horário');
  if (at <= Date.now() && $('#rem-repeat').value === 'none') return toast('Esse horário já passou');
  put('reminder', uid(), { text, at, fired: false, preFired: false, repeat: $('#rem-repeat').value, advanceMin: Number($('#rem-advance').value), alarm: $('#rem-alarm').checked });
  $('#rem-text').value = ''; $('#rem-at').value = defaultAt();
  say('Lembrete agendado! ⏰', 'conseguiu');
});
$('#rem-list').addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li && e.target.classList.contains('x')) del('reminder', li.dataset.id); });
function renderReminders() {
  const rem = list('reminder').filter((r) => !r.fired).sort((a, b) => a.at - b.at);
  $('#rem-list').innerHTML = rem.length ? rem.map((r) => `<li data-id="${esc(r.id)}">${r.alarm ? '🔔' : '⏰'}<span class="grow">${esc(r.text)}<br><span class="muted small">${fmtWhen(r.at)}${r.repeat && r.repeat !== 'none' ? ' · ' + REP[r.repeat] : ''}${r.advanceMin ? ` · aviso ${r.advanceMin} min antes` : ''}</span></span><button class="x">✕</button></li>`).join('')
    : '<li class="empty">Sem lembretes agendados.</li>';
}

// ---------- Foco ----------
const PHASE = { focus: '🎯 Foco', short: '☕ Pausa', long: '🌴 Pausa longa' };
$('#pomo-start').addEventListener('click', () => { const min = settings().focusMin || 25; put('doc', 'focus', { phase: 'focus', cycle: 1, endsAt: Date.now() + min * 60e3, durationMs: min * 60e3 }); say('Foco ligado! 🍅', 'descolada'); });
$('#pomo-stop').addEventListener('click', () => put('doc', 'focus', null));
$('#timer-presets').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const ms = Number(b.dataset.min) * 60e3;
  put('timer', uid(), { label: b.dataset.label || b.textContent.trim(), endsAt: Date.now() + ms, durationMs: ms });
  toast(`Timer de ${b.textContent.trim()} ligado`);
});
$('#timer-list').addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li && e.target.classList.contains('x')) del('timer', li.dataset.id); });
function renderFocus() {
  const f = docv('focus');
  const live = f && f.phase;
  const left = live ? (f.pausedLeft != null ? f.pausedLeft : f.endsAt - Date.now()) : (settings().focusMin || 25) * 60e3;
  $('#pomo-phase').textContent = live ? `${PHASE[f.phase]} · ciclo ${f.cycle || 1}` : 'parado';
  $('#pomo-time').textContent = fmtLeft(left);
  $('#pomo-ring').style.setProperty('--p', live && f.durationMs ? Math.min(100, 100 * (1 - left / f.durationMs)) : 0);
  $('#pomo-start').hidden = Boolean(live); $('#pomo-stop').hidden = !live;
  const now = Date.now();
  const timers = list('timer').filter((t) => t.endsAt > now - 60e3).sort((a, b) => a.endsAt - b.endsAt);
  $('#timer-list').innerHTML = timers.length ? timers.map((t) => `<li data-id="${esc(t.id)}"><span class="grow"><b>${esc(t.label)}</b><div class="timer-bar"><i style="width:${Math.min(100, 100 * (1 - (t.endsAt - now) / t.durationMs))}%"></i></div></span><span class="ttime">${fmtLeft(t.endsAt - now)}</span><button class="x">✕</button></li>`).join('') : '<li class="empty">Nenhum timer rodando.</li>';
}

// ---------- PC e sistemas ----------
function renderPc() {
  const p = docv('pc');
  const bar = (n, v, t) => `<div class="pc-line"><span>${n}</span><div class="timer-bar ${v >= 90 ? 'hot' : ''}"><i style="width:${v}%"></i></div><b>${t}</b></div>`;
  $('#pc-card').innerHTML = `<div class="card-h"><span>Seu PC</span><span class="small muted"><span class="dot ${pcOnline() ? 'on' : ''}"></span>${p ? 'visto ' + ago(p.at) : 'sem dados'}</span></div>` +
    (p ? bar('Processador', p.cpu, p.cpu + '%') + bar('Memória', p.mem, p.mem + '%') + (p.disk ? bar('Disco', p.disk.usedPct, p.disk.freeGB + ' GB livres') : '') : '<span class="muted small">O PC ainda não enviou o estado.</span>');
  const s = docv('systems');
  $('#systems').innerHTML = !s || !s.sistemas ? '<div class="muted small">O PC envia o resumo dos sistemas quando estiver ligado.</div>'
    : `<p class="muted small">Atualizado ${ago(s.at)}</p>` + s.sistemas.map((x) => `<div class="sys"><h5>${esc(x.icon || '🗂')} ${esc(x.projeto)}</h5>${x.tabelas.map((t) => `<div class="l"><span>${esc(t.nome)}</span><span><b>${t.total == null ? '—' : t.total.toLocaleString('pt-BR')}</b>${t.novosHoje ? `<span class="new">+${t.novosHoje} hoje</span>` : ''}</span></div>`).join('')}</div>`).join('');
}

// ---------- Notas e textos rápidos ----------
$('#more-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#more-seg button').forEach((x) => x.classList.toggle('active', x === b));
  $$('.sub').forEach((v) => v.classList.toggle('active', v.dataset.subView === b.dataset.sub));
});
$('#note-form').addEventListener('submit', (e) => { e.preventDefault(); const t = $('#note-input').value.trim(); if (!t) return; $('#note-input').value = ''; put('note', uid(), { text: t, createdAt: Date.now() }); });
$('#note-list').addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li && e.target.classList.contains('x')) del('note', li.dataset.id); });
$('#snip-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#snip-name').value.trim(), text = $('#snip-text').value;
  if (!name || !text.trim()) return;
  put('snippet', uid(), { name, text });
  $('#snip-name').value = ''; $('#snip-text').value = '';
  toast(`Salvo! Diga "copia ${name}"`);
});
$('#snip-list').addEventListener('click', async (e) => {
  const li = e.target.closest('li[data-id]'); if (!li) return;
  const s = db.snippet.get(li.dataset.id);
  if (e.target.classList.contains('x')) return del('snippet', s.id);
  try { await navigator.clipboard.writeText(s.text); toast(`Copiei ${s.name}! 📋`); } catch { toast('Não consegui copiar'); }
});
function renderNotes() {
  const notes = list('note').sort((a, b) => b.createdAt - a.createdAt);
  $('#note-list').innerHTML = notes.length ? notes.map((n) => `<li data-id="${esc(n.id)}"><span class="grow">${esc(n.text)}</span><button class="x">✕</button></li>`).join('') : '<li class="empty">Nenhuma nota.</li>';
  const snips = list('snippet');
  $('#snip-list').innerHTML = snips.length ? snips.map((s) => `<li data-id="${esc(s.id)}"><span class="snip-name">${esc(s.name)}</span><span class="grow">${esc(s.text)}</span><button class="x">✕</button></li>`).join('') : '<li class="empty">Salve seu pix, endereço, e-mail…</li>';
}

// Avisos que o PC manda (novidades dos sistemas, resumo do dia, impressões, reuniões)
function renderAlerts() {
  const list = list_('alert').sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 8);
  $('#alerts-card').hidden = !list.length;
  $('#alert-list').innerHTML = list.map((a) => `<li><span>${esc(a.icon || '🔔')}</span><span class="grow"><b style="font-weight:600">${esc(a.title)}</b>${a.body ? `<br><span class="muted small">${esc(String(a.body).split(/\r?\n/)[0].slice(0, 140))}</span>` : ''}</span><span class="when">${ago(a.at || 0)}</span></li>`).join('');
}

// ---------- Fotos (câmera do celular) ----------
/** Reduz a foto (máx. 1600 px, JPEG) para mandar rápido para a IA. */
function shrinkImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    if (file.type === 'application/pdf') {
      const r = new FileReader();
      r.onload = () => resolve({ mime: 'application/pdf', data: String(r.result).split(',')[1], url: null, name: file.name });
      r.onerror = reject; r.readAsDataURL(file); return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', 0.82);
      URL.revokeObjectURL(url);
      resolve({ mime: 'image/jpeg', data: dataUrl.split(',')[1], url: dataUrl, name: file.name });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir a imagem.')); };
    img.src = url;
  });
}

// Foto no chat: aparece em cima do campo, com atalhos
let chatPhoto = null;
$('#ph-btn').addEventListener('click', () => $('#ph-file').click());
$('#ph-file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    chatPhoto = await shrinkImage(f);
    $('#ph-thumb').src = chatPhoto.url;
    $('#photo-strip').hidden = false;
    $('#ask-input').placeholder = 'Pergunte algo sobre a foto…';
    showTab('chat');
  } catch (err) { toast(err.message); }
});
function clearPhoto() { chatPhoto = null; $('#photo-strip').hidden = true; $('#ask-input').placeholder = 'Fale com a Lumi…'; }
$('#ph-x').addEventListener('click', clearPhoto);
$('#ph-quick').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b || !chatPhoto) return;
  if (b.dataset.proposal) { const ph = chatPhoto; clearPhoto(); return evaluateProposal([ph], ''); }
  ask(b.dataset.q);
});

// ---------- Pedidos de pessoas ----------
$('#req-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const from = $('#req-who').value.trim(), text = $('#req-what').value.trim();
  if (!from || !text) return toast('Preencha quem pediu e o quê.');
  const dueVal = $('#req-due').value;
  const due = dueVal ? new Date(dueVal) : null;
  await put('task', uid(), { text, done: false, createdAt: Date.now(), priority: 2, subtasks: [], due: due ? due.toISOString() : null, from });
  if (due && due.getTime() > Date.now()) await put('reminder', uid(), { text: `${from} pediu: ${text}`, at: due.getTime(), fired: false, preFired: false, repeat: 'none', advanceMin: 60, alarm: false });
  $('#req-what').value = ''; $('#req-due').value = '';
  buzz([15, 40, 15]);
  say(`Anotado: ${from} pediu "${text}"${due ? ' — te lembro no prazo' : ''}. 👤`, 'conseguiu');
});
$('#req-list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]'); if (!li) return;
  const t = db.task.get(li.dataset.id); if (!t) return;
  if (e.target.classList.contains('check-box')) { buzz([15, 50, 25]); addXp(10); say('Pedido entregue! ✅ +10 XP', 'conseguiu'); put('task', t.id, { ...strip(t), done: true }); }
});
function renderRequests() {
  const reqs = list('task').filter((t) => !t.done && t.from).sort((a, b) => (a.due ? new Date(a.due) : Infinity) - (b.due ? new Date(b.due) : Infinity));
  $('#req-list').innerHTML = reqs.map((t) => {
    const late = t.due && new Date(t.due).getTime() < Date.now();
    return `<li data-id="${esc(t.id)}"><button class="check-box" aria-label="Feito"></button><span class="grow"><b>${esc(t.from)}</b> · ${esc(t.text)}${t.due ? `<br><span class="small ${late ? 'late' : 'muted'}">${late ? 'atrasado · ' : 'até '}${fmtWhen(new Date(t.due).getTime())}</span>` : ''}</span></li>`;
  }).join('') || '<li class="empty">Ninguém te pediu nada pendente. 🌿</li>';
}

// ---------- Pendências e conversas (o PC manda) ----------
function renderPend() {
  const d = docv('pendencias');
  const itens = (d && d.itens) || [];
  $('#pend-card').hidden = !itens.length;
  $('#pend-when').textContent = d && d.at ? ago(d.at) : '';
  $('#pend-list').innerHTML = itens.map((p) => `<div class="pend-p"><b>${esc(p.icon)} ${esc(p.project)}</b>${p.items.map((i) => `<div class="pend-i"><span>${esc(i.label)}</span><strong>${i.n}</strong></div>`).join('')}</div>`).join('');
}
const waitTxt = (ms) => { const m = Math.round((Date.now() - ms) / 60e3); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${Math.round(m / 1440)}d`; };
function renderWait() {
  const d = docv('inboxWaiting');
  const itens = (d && d.itens) || [];
  $('#wait-card').hidden = !itens.length;
  $('#wait-list').innerHTML = itens.slice(0, 6).map((c) => `<li><span>${c.app === 'instagram' ? '📸' : '💬'}</span><span class="grow"><b>${esc(c.chat)}</b> <span class="tag ${c.label === 'pessoal' ? 'tag-p' : 'tag-c'}">${c.label === 'pessoal' ? '🏠 Pessoal' : '🏢 Corporativo'}</span><br><span class="muted small">${esc(c.preview || '')}</span></span><span class="when">${waitTxt(c.desde)}</span></li>`).join('');
}

// ---------- Propostas ----------
const REC_CLASS = { patrocinar: 'rec-patrocinar', negociar: 'rec-negociar', recusar: 'rec-recusar', 'pedir mais informações': 'rec-pedir' };
const PSTATUS = ['em análise', 'negociando', 'aprovada', 'recusada', 'arquivada'];
let prFiles = [];
$('#pr-photo').addEventListener('click', () => $('#pr-file').click());
$('#pr-file').addEventListener('change', async (e) => {
  const files = [...e.target.files].slice(0, 3); e.target.value = '';
  for (const f of files) { try { prFiles.push(await shrinkImage(f)); } catch (err) { toast(err.message); } }
  prFiles = prFiles.slice(0, 3);
  $('#pr-thumbs').innerHTML = prFiles.map((f) => (f.url ? `<img src="${f.url}" alt="" />` : '<span class="pdf">📄 PDF</span>')).join('');
  $('#pr-go').hidden = !prFiles.length;
});
$('#pr-go').addEventListener('click', () => { const files = prFiles; prFiles = []; $('#pr-thumbs').innerHTML = ''; $('#pr-go').hidden = true; evaluateProposal(files, $('#pr-note').value.trim()); $('#pr-note').value = ''; });
async function evaluateProposal(files, note) {
  showTab('more'); showSub('proposals');
  $('#pr-status').textContent = 'Lendo e avaliando com calma… (uns 20–40 s) ⭐';
  LumiFace.mood('thinking');
  try {
    const j = await callFn('lumi-chat', { mode: 'proposal', text: note, images: files.map((f) => ({ mime: f.mime, data: f.data })) });
    const p = j.proposal;
    applyRow({ kind: 'proposal', id: p.id, data: p, deleted: false });
    renderAll();
    $('#pr-status').textContent = '';
    buzz([20, 60, 20]);
    say(`${p.titulo}: nota ${p.nota}/10, recomendo ${p.recomendacao}. ${p.resumo}`, p.nota >= 7 ? 'conseguiu' : p.nota >= 5 ? 'pensando' : 'triste');
  } catch (err) { $('#pr-status').textContent = 'Não deu: ' + err.message; LumiFace.mood('triste', 2000); }
}
const ulist = (arr) => (arr && arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted small">—</p>');
function renderProposals() {
  const all = list('proposal').sort((a, b) => (b.at || 0) - (a.at || 0));
  const open = all.filter((p) => p.status === 'em análise' || p.status === 'negociando');
  $('#props-card').hidden = !open.length;
  $('#props-mini').innerHTML = open.slice(0, 3).map((p) => `<li><span class="score-mini ${p.nota >= 7 ? 's-hi' : p.nota >= 5 ? 's-mid' : 's-lo'}">${Number(p.nota).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span><span class="grow">${esc(p.titulo)}</span><span class="rec ${REC_CLASS[p.recomendacao] || ''}">${esc(p.recomendacao)}</span></li>`).join('');
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#pr-list')) return;
  $('#pr-list').innerHTML = all.map((p) => {
    const custo = p.valor_num && p.publico_num ? ` · R$ ${(p.valor_num / p.publico_num).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}/pessoa` : '';
    return `<div class="card pr" data-id="${esc(p.id)}">
      <div class="pr-h"><span class="score-mini lg ${p.nota >= 7 ? 's-hi' : p.nota >= 5 ? 's-mid' : 's-lo'}">${Number(p.nota).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span><b class="grow">${esc(p.titulo)}</b><span class="rec ${REC_CLASS[p.recomendacao] || ''}">${esc(p.recomendacao)}</span></div>
      <div class="muted small">${[p.organizador, p.data_evento, p.local].filter(Boolean).map(esc).join(' · ')}${p.valor ? `<br>💰 ${esc(p.valor)}${custo}` : ''}</div>
      <p class="pr-sum">${esc(p.resumo || '')}</p>
      <details><summary class="muted small">Ver avaliação completa</summary>
        <div class="pr-det"><h5>Aderência</h5><p>${esc(p.aderencia || '')}</p><h5>Contraproposta</h5><p>${esc(p.contraproposta || '')}</p>
        <h5>Contrapartidas</h5>${ulist(p.contrapartidas)}<h5>Riscos</h5>${ulist(p.riscos)}<h5>Perguntas ao organizador</h5>${ulist(p.perguntas)}</div>
      </details>
      <div class="row"><select class="pr-status">${PSTATUS.map((s) => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="btn ghost pr-ask">💬 Escrever resposta</button></div>
    </div>`;
  }).join('') || '<p class="muted small">Nenhuma proposta ainda. Tire uma foto acima. 📷</p>';
}
$('#pr-list').addEventListener('change', (e) => {
  const card = e.target.closest('.pr[data-id]'); if (!card || !e.target.classList.contains('pr-status')) return;
  const p = db.proposal.get(card.dataset.id); if (p) put('proposal', p.id, { ...strip(p), status: e.target.value });
});
$('#pr-list').addEventListener('click', (e) => {
  const card = e.target.closest('.pr[data-id]'); if (!card || !e.target.classList.contains('pr-ask')) return;
  const p = db.proposal.get(card.dataset.id); if (!p) return;
  ask(`Escreva uma resposta curta para o organizador da proposta "${p.titulo}" (${p.recomendacao}). Contraproposta sugerida: ${p.contraproposta || '—'}.`);
});
$('#props-open').addEventListener('click', () => { showTab('more'); showSub('proposals'); });
function showSub(name) {
  $$('#more-seg button').forEach((x) => x.classList.toggle('active', x.dataset.sub === name));
  $$('.sub').forEach((v) => v.classList.toggle('active', v.dataset.subView === name));
}

function renderAll() {
  applyLook();
  renderAlerts(); renderPend(); renderWait(); renderProposals(); renderRequests();
  renderLevel(); renderStats(); renderPlayer(); renderRoutines(); renderNext(); renderHabits();
  renderTasks(); renderReminders(); renderFocus(); renderNotes(); renderPc();
}

// ---------- Atualizar ----------
async function refresh(manual) {
  if (!user) return;
  if (manual) $('#refresh').classList.add('spin');
  try { await loadAll(); await Promise.all([loadWeather(), loadQuotes(), loadEvents()]); if (manual) toast('Atualizado ✨'); }
  catch (e) { if (manual) toast('Não atualizou: ' + e.message); }
  finally { $('#refresh').classList.remove('spin'); }
}
$('#refresh').addEventListener('click', () => refresh(true));

// ---------- Notificações (Web Push) ----------
const b64ToBytes = (b) => { const p = '='.repeat((4 - (b.length % 4)) % 4); const raw = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    $('#push-status').textContent = /iPhone|iPad/.test(navigator.userAgent) ? 'No iPhone, primeiro adicione a Lumi à Tela de Início (Compartilhar → Adicionar à Tela de Início) e abra por lá.' : 'Este navegador não aceita notificações.';
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { $('#push-status').textContent = 'Permissão negada nas configurações do celular.'; return; }
  const { data: vapid, error } = await sb.rpc('lumi_vapid_public');
  if (error || !vapid) { $('#push-status').textContent = 'O servidor ainda está preparando as notificações. Tente em 1 minuto.'; return; }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapid) });
  const j = sub.toJSON();
  const { error: e2 } = await sb.from('lumi_push_subs').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: navigator.userAgent.slice(0, 120) }, { onConflict: 'endpoint' });
  if (e2) { $('#push-status').textContent = 'Erro: ' + e2.message; return; }
  $('#push-status').textContent = '✅ Notificações ativas neste celular.';
  say('Pronto! Vou te avisar por aqui. 🔔', 'conseguiu');
}
$('#push-btn').addEventListener('click', () => enablePush().catch((e) => { $('#push-status').textContent = 'Erro: ' + e.message; }));
$('#push-test').addEventListener('click', async () => {
  try { const j = await callFn('lumi-push', { action: 'test' }); toast(j.sent ? 'Enviada! 🔔' : 'Ative as notificações primeiro'); }
  catch (e) { toast('Erro: ' + e.message); }
});
async function pushStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub && Notification.permission === 'granted') $('#push-status').textContent = '✅ Notificações ativas neste celular.';
}

// ---------- Calendário (feed ICS) ----------
async function calendarUrl() {
  let { data } = await sb.from('lumi_profile').select('ics_token').maybeSingle();
  if (!data) ({ data } = await sb.from('lumi_profile').insert({}).select('ics_token').single());
  return `${SUPABASE_URL}/functions/v1/lumi-ics?t=${data.ics_token}`;
}
$('#cal-btn').addEventListener('click', async () => { location.href = (await calendarUrl()).replace(/^https:/, 'webcal:'); });
$('#cal-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(await calendarUrl()); toast('Link copiado! 📅'); } catch { toast('Não consegui copiar'); } });

// ---------- Conta ----------
const SPEAK_KEY = 'lumi-speak';
try { $('#speak-toggle').checked = localStorage.getItem(SPEAK_KEY) !== '0'; } catch { $('#speak-toggle').checked = true; }
$('#speak-toggle').addEventListener('change', () => { try { localStorage.setItem(SPEAK_KEY, $('#speak-toggle').checked ? '1' : '0'); } catch {} });
$('#haptic-toggle').checked = hapticOn;
$('#haptic-toggle').addEventListener('change', () => { hapticOn = $('#haptic-toggle').checked; try { localStorage.setItem(HAPTIC_KEY, hapticOn ? '1' : '0'); } catch {} buzz(20); });
$('#logout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

// Login por código no e-mail (o mesmo do MailDesk)
async function sendCode() {
  const email = $('#login-email').value.trim();
  if (!email) return;
  $('#login-btn').disabled = true; $('#login-err').textContent = '';
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  $('#login-btn').disabled = false;
  if (error) {
    $('#login-err').textContent = /not allowed|not found/i.test(error.message) ? 'Esse e-mail não tem conta no MailDesk.'
      : /rate|seconds/i.test(error.message) ? 'Espere alguns segundos antes de pedir outro código.' : error.message;
    return;
  }
  $('#code-step').hidden = false;
  $('#login-btn').hidden = true;
  $('#login-code').focus();
}
async function verifyCode() {
  const { error } = await sb.auth.verifyOtp({ email: $('#login-email').value.trim(), token: $('#login-code').value.trim(), type: 'email' });
  if (error) $('#login-err').textContent = /expired|invalid/i.test(error.message) ? 'Código inválido ou vencido. Peça outro.' : error.message;
}
$('#login-form').addEventListener('submit', (e) => { e.preventDefault(); if ($('#code-step').hidden) sendCode(); else verifyCode(); });
$('#verify-btn').addEventListener('click', verifyCode);
$('#resend-btn').addEventListener('click', sendCode);

// ---------- Início ----------
LumiFace.create($('#lumi-login'));
LumiFace.create($('#lumi-face'));

function greet() {
  const h = new Date().getHours();
  const name = settings().userName ? `, ${settings().userName}` : '';
  return `${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}${name}!`;
}
async function start(session) {
  if (!session) { $('#login').hidden = false; $('#app').hidden = true; return; }
  user = session.user;
  $('#login').hidden = true; $('#app').hidden = false;
  $('#account').textContent = `Conectada como ${user.email}`;
  await loadAll();
  subscribe();
  $('#greet').textContent = greet();
  const pend = list('task').filter((t) => !t.done).length;
  say(pend ? `Você tem ${pend} ${pend === 1 ? 'tarefa pendente' : 'tarefas pendentes'}. Bora? ✨` : 'Tudo em dia por aqui! ✨', 'feliz');
  loadWeather(); loadQuotes(); loadEvents();
  checkCloudVoice();
  pushStatus();
}
let started = false;
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && !started) { started = true; start(session); }
  if (event === 'SIGNED_OUT') { started = false; start(null); }
});
sb.auth.getSession().then(({ data }) => { if (!started) { started = Boolean(data.session); start(data.session); } });

let lastMinute = -1;
setInterval(() => {
  if (!user) return;
  renderFocus();
  const m = new Date().getMinutes();
  if (m !== lastMinute) { lastMinute = m; $('#greet').textContent = greet(); renderStats(); renderPlayer(); }
  else if (docv('focus')?.phase) renderStats();
}, 1000);
setInterval(() => { if (user && !document.hidden) { loadWeather(); loadQuotes(); loadEvents(); } }, 15 * 60e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden && user) refresh(false); });

const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (!standalone) $('#install-hint').textContent = /iPhone|iPad/.test(navigator.userAgent) ? 'Dica: Compartilhar → Adicionar à Tela de Início para usar como app.' : 'Dica: menu ⋮ → Instalar app / Adicionar à tela inicial.';
if ('serviceWorker' in navigator) {
  // Quando sai versão nova, o app se recarrega sozinho (só se já havia uma versão antiga rodando).
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
}
