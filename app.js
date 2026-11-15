// Lumi no celular: lê e grava as mesmas tarefas, lembretes, hábitos e notas do PC (via Supabase).
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
const fmtWhen = (ms) => {
  const d = new Date(ms), t = new Date(), tm = new Date(); tm.setDate(t.getDate() + 1);
  const day = d.toDateString() === t.toDateString() ? 'hoje' : d.toDateString() === tm.toDateString() ? 'amanhã' : d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return `${day} às ${fmtClock(ms)}`;
};
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }

// ---------- Dados (cache local das linhas de lumi_items) ----------
const db = { task: new Map(), reminder: new Map(), note: new Map(), habit: new Map(), snippet: new Map(), timer: new Map(), doc: new Map() };
const list = (kind) => [...db[kind].values()];
const docv = (id) => db.doc.get(id) ?? null;
let user = null;

function applyRow(row) {
  const m = db[row.kind];
  if (!m) return;
  if (row.deleted || row.data == null) m.delete(row.id);
  else m.set(row.id, { ...row.data, id: row.id });
}
async function loadAll() {
  const { data, error } = await sb.from('lumi_items').select('kind,id,data,deleted').eq('deleted', false);
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
      if (p.new && p.new.kind) { applyRow(p.new); renderAll(); }
    })
    .subscribe();
}

// ---------- Personagem ----------
const settings = () => docv('settings') ?? {};
function say(text, mood = 'happy') {
  $('#bubble').textContent = text;
  if ($('#speak-toggle').checked && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ''));
    u.lang = 'pt-BR'; u.pitch = 1.5; u.rate = 1.08;
    const v = speechSynthesis.getVoices().find((x) => /pt-BR/i.test(x.lang));
    if (v) u.voice = v;
    u.onstart = () => LumiFace.mood('talking');
    u.onend = () => LumiFace.mood(mood, 1800);
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } else LumiFace.mood(mood, 2500);
}
let lookKey = '';
function applyLook() {
  const s = settings();
  document.documentElement.style.setProperty('--lumi', s.color || '#7cc8ff');
  const key = `${s.eyes}|${s.accessory}`;
  if (key !== lookKey) { lookKey = key; LumiFace.setLook({ eyes: s.eyes || 'oval', acc: s.accessory || 'nenhum' }); }
}

// ---------- Abas ----------
function showTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  $('#views').scrollTop = 0;
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });

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
let busy = false;
async function ask(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  showTab('chat');
  addMsg('me', text);
  const typing = addMsg('bot typing', '…');
  LumiFace.mood('thinking');
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/lumi-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY },
      body: JSON.stringify({ text, history: history.slice(-12) }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'erro');
    typing.remove();
    addMsg('bot', j.text);
    history.push({ role: 'user', text }, { role: 'assistant', text: j.text });
    if (j.copy) { try { await navigator.clipboard.writeText(j.copy); toast('Copiado! 📋'); } catch { toast('Toque em Notas → Textos rápidos para copiar'); } }
    say(j.text, j.mood || 'feliz');
    if (j.changed?.length) loadAll();
  } catch (e) {
    typing.remove();
    addMsg('bot', 'Ops: ' + e.message);
    say('Algo deu errado. 😕', 'sad');
  } finally { busy = false; }
}
$('#ask').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#ask-input').value; $('#ask-input').value = ''; ask(v); });
$('#suggestions').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') ask(e.target.textContent); });

// Voz pelo microfone do celular (Chrome no Android e Safari no iPhone)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
$('#mic').addEventListener('click', () => {
  if (!SR) return toast('Use o microfone do teclado para ditar 🎙');
  if (rec) { rec.stop(); return; }
  rec = new SR();
  rec.lang = 'pt-BR'; rec.interimResults = true; rec.maxAlternatives = 1;
  let final = '';
  $('#mic').classList.add('on'); LumiFace.mood('listening'); $('#bubble').textContent = 'Pode falar! 👂';
  rec.onresult = (e) => {
    let interim = '';
    for (const r of e.results) (r.isFinal ? (final = r[0].transcript) : (interim += r[0].transcript));
    $('#bubble').textContent = (final || interim) + '…';
  };
  rec.onend = () => { $('#mic').classList.remove('on'); rec = null; if (final) ask(final); else LumiFace.mood('idle'); };
  rec.onerror = () => { $('#mic').classList.remove('on'); rec = null; };
  rec.start();
});

// ---------- Água ----------
async function water(delta) {
  let w = docv('water');
  if (!w || w.date !== todayKey()) w = { date: todayKey(), count: 0 };
  w = { ...w, count: Math.max(0, w.count + delta) };
  delete w.id;
  await put('doc', 'water', w);
  const goal = settings().waterGoal || 8;
  if (delta > 0) say(w.count >= goal ? 'Meta de água batida! 💧🎉' : `Mais um copo! ${w.count}/${goal} 💧`, w.count >= goal ? 'proud' : 'happy');
}
$('#water-btn').addEventListener('click', () => water(1));

// ---------- Tarefas ----------
const PRIO = ['', '🔵', '🟡', '🔴'];
const expanded = new Set();
const strip = (o) => { const { id, ...rest } = o; return rest; };
$('#task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('#task-input').value.trim();
  if (!text) return;
  $('#task-input').value = '';
  const t = { text, done: false, createdAt: Date.now(), priority: 0, subtasks: [], due: null };
  put('task', uid(), t);
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
  if (e.target.classList.contains('x')) return del('task', t.id);
  if (e.target.classList.contains('prio')) return put('task', t.id, { ...strip(t), priority: ((t.priority || 0) + 1) % 4 });
  if (e.target.classList.contains('check-box')) { if (!t.done) say('Mandou bem! ✅', 'proud'); return put('task', t.id, { ...strip(t), done: !t.done }); }
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
    return `<li data-id="${t.id}" class="task ${t.done ? 'done' : ''}">
      <div class="task-row"><button class="check-box" style="${t.done ? 'background:var(--lumi);border-color:var(--lumi)' : ''}"></button>
      <span class="grow">${esc(t.text)}${subs.length ? ` <span class="muted">· ${subs.filter((s) => s.done).length}/${subs.length}</span>` : ''}</span>
      <button class="x prio">${PRIO[t.priority || 0] || '⚑'}</button><button class="x">✕</button></div>
      ${open ? `<ul class="subs">${subs.map((s) => `<li class="sub-li ${s.done ? 'done' : ''}" data-sub="${s.id}"><button class="check-box"></button><span class="grow">${esc(s.text)}</span><button class="x">✕</button></li>`).join('')}</ul>
      <form class="sub-form row" data-task="${t.id}" style="margin:6px 0 0 34px"><input placeholder="Subtarefa…" /><button class="chip">+</button></form>` : ''}
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
  say('Lembrete agendado! ⏰', 'proud');
});
$('#rem-list').addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li && e.target.classList.contains('x')) del('reminder', li.dataset.id); });
function renderReminders() {
  const rem = list('reminder').filter((r) => !r.fired).sort((a, b) => a.at - b.at);
  $('#rem-list').innerHTML = rem.length ? rem.map((r) => `<li data-id="${r.id}">${r.alarm ? '🔔' : '⏰'}<span class="grow">${esc(r.text)}<br><span class="muted">${fmtWhen(r.at)}${r.repeat !== 'none' ? ' · ' + REP[r.repeat] : ''}${r.advanceMin ? ` · aviso ${r.advanceMin} min antes` : ''}</span></span><button class="x">✕</button></li>`).join('')
    : '<li class="empty">Sem lembretes agendados.</li>';
}

// ---------- Foco ----------
const PHASE = { focus: '🎯 Foco', short: '☕ Pausa', long: '🌴 Pausa longa' };
$('#pomo-start').addEventListener('click', () => { const min = settings().focusMin || 25; put('doc', 'focus', { phase: 'focus', cycle: 1, endsAt: Date.now() + min * 60e3, durationMs: min * 60e3 }); say('Foco ligado! 🍅', 'cool'); });
$('#pomo-stop').addEventListener('click', () => put('doc', 'focus', null));
$('#timer-presets').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const ms = Number(b.dataset.min) * 60e3;
  put('timer', uid(), { label: b.dataset.label || `${b.dataset.min} min`, endsAt: Date.now() + ms, durationMs: ms });
});
$('#timer-list').addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li && e.target.classList.contains('x')) del('timer', li.dataset.id); });
function renderFocus() {
  const f = docv('focus');
  const live = f && f.phase;
  $('#pomo-phase').textContent = live ? PHASE[f.phase] : 'parado';
  $('#pomo-phase').className = 'pill ' + (live ? 'ok' : '');
  $('#pomo-time').textContent = live ? fmtLeft(f.pausedLeft != null ? f.pausedLeft : f.endsAt - Date.now()) : fmtLeft((settings().focusMin || 25) * 60e3);
  $('#pomo-start').hidden = Boolean(live); $('#pomo-stop').hidden = !live;
  const now = Date.now();
  const timers = list('timer').filter((t) => t.endsAt > now - 60e3).sort((a, b) => a.endsAt - b.endsAt);
  $('#timer-list').innerHTML = timers.length ? timers.map((t) => `<li data-id="${t.id}"><span class="grow"><b>${esc(t.label)}</b><div class="timer-bar"><i style="width:${Math.min(100, 100 * (1 - (t.endsAt - now) / t.durationMs))}%"></i></div></span><span class="ttime">${fmtLeft(t.endsAt - now)}</span><button class="x">✕</button></li>`).join('') : '<li class="empty">Nenhum timer rodando.</li>';
}

// ---------- Hábitos e PC ----------
$('#habit-grid').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-habit]'); if (!card || e.target.tagName !== 'BUTTON') return;
  const delta = e.target.dataset.d === '+' ? 1 : -1;
  if (card.dataset.habit === 'agua') return water(delta);
  const log = { ...(docv('habitLog') ?? {}) }; delete log.id;
  const day = { ...(log[todayKey()] || {}) };
  day[card.dataset.habit] = Math.max(0, (day[card.dataset.habit] || 0) + delta);
  log[todayKey()] = day;
  await put('doc', 'habitLog', log);
  const h = db.habit.get(card.dataset.habit);
  if (delta > 0 && h && day[h.id] === h.goal) say(`${h.icon} ${h.name}: meta cumprida! 🎉`, 'proud');
});
function renderHabits() {
  const w = docv('water'); const wc = w && w.date === todayKey() ? w.count : 0;
  const goal = settings().waterGoal || 8;
  $('#water-count').textContent = wc; $('#water-goal').textContent = goal;
  const log = (docv('habitLog') ?? {})[todayKey()] || {};
  const card = (id, icon, name, c, g, unit) => `<div class="habit ${c >= g ? 'done' : ''}" data-habit="${id}"><div class="habit-top">${icon} ${esc(name)}</div><div><b>${c}</b>/${g} <span class="muted">${esc(unit)}</span></div><div class="timer-bar"><i style="width:${Math.min(100, 100 * c / g)}%"></i></div><div class="btns"><button data-d="-">−</button><button data-d="+">+</button></div></div>`;
  $('#habit-grid').innerHTML = card('agua', '💧', 'Água', wc, goal, 'copos') + list('habit').map((h) => card(h.id, h.icon, h.name, log[h.id] || 0, h.goal, h.unit)).join('');
  const p = docv('pc');
  const bar = (n, v, t) => `<div class="pc-line"><span>${n}</span><div class="timer-bar ${v >= 90 ? 'hot' : ''}"><i style="width:${v}%"></i></div><b>${t}</b></div>`;
  $('#pc-card').innerHTML = p ? bar('Processador', p.cpu, p.cpu + '%') + bar('Memória', p.mem, p.mem + '%') + (p.disk ? bar('Disco', p.disk.usedPct, p.disk.freeGB + ' GB livres') : '') + `<div class="muted">Visto ${fmtWhen(p.at)}</div>` : '<span class="muted">O PC ainda não enviou o estado.</span>';
}

// ---------- Notas e textos rápidos ----------
$('#notes-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $$('#notes-seg button').forEach((x) => x.classList.toggle('active', x === b));
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
  $('#note-list').innerHTML = notes.length ? notes.map((n) => `<li data-id="${n.id}"><span class="grow">${esc(n.text)}</span><button class="x">✕</button></li>`).join('') : '<li class="empty">Nenhuma nota.</li>';
  const snips = list('snippet');
  $('#snip-list').innerHTML = snips.length ? snips.map((s) => `<li data-id="${s.id}"><span class="snip-name">${esc(s.name)}</span><span class="grow">${esc(s.text)}</span><button class="x">✕</button></li>`).join('') : '<li class="empty">Salve seu pix, endereço, e-mail…</li>';
}

// ---------- Sistemas ----------
function renderSystems() {
  const s = docv('systems');
  if (!s || !s.sistemas) { $('#systems').innerHTML = '<div class="muted">O PC envia o resumo dos sistemas quando estiver ligado com o token do Supabase configurado.</div>'; return; }
  $('#systems').innerHTML = `<p class="muted">Atualizado ${fmtWhen(s.at)}</p>` + s.sistemas.map((p) => `<div class="sys"><h5>${esc(p.icon || '🗂')} ${esc(p.projeto)}</h5>${p.tabelas.map((t) => `<div class="l"><span>${esc(t.nome)}</span><span><b>${t.total == null ? '—' : t.total.toLocaleString('pt-BR')}</b>${t.novosHoje ? `<span class="new">+${t.novosHoje} hoje</span>` : ''}</span></div>`).join('')}</div>`).join('');
}

function renderAll() {
  applyLook();
  renderTasks(); renderReminders(); renderFocus(); renderHabits(); renderNotes(); renderSystems();
}

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
  say('Pronto! Vou te avisar por aqui. 🔔', 'proud');
}
$('#push-btn').addEventListener('click', () => enablePush().catch((e) => { $('#push-status').textContent = 'Erro: ' + e.message; }));
$('#push-test').addEventListener('click', async () => {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/lumi-push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY }, body: JSON.stringify({ action: 'test' }) });
  const j = await r.json().catch(() => ({}));
  toast(r.ok ? (j.sent ? 'Enviada! 🔔' : 'Ative as notificações primeiro') : 'Erro: ' + (j.error || r.status));
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
try { $('#speak-toggle').checked = localStorage.getItem(SPEAK_KEY) === '1'; } catch {}
$('#speak-toggle').addEventListener('change', () => { try { localStorage.setItem(SPEAK_KEY, $('#speak-toggle').checked ? '1' : '0'); } catch {} });
$('#logout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-btn').disabled = true; $('#login-err').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-pass').value });
  $('#login-btn').disabled = false;
  if (error) $('#login-err').textContent = error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message;
});

// ---------- Início ----------
LumiFace.create($('#lumi-login'));
LumiFace.create($('#lumi-face'));

async function start(session) {
  if (!session) { $('#login').hidden = false; $('#app').hidden = true; return; }
  user = session.user;
  $('#login').hidden = true; $('#app').hidden = false;
  $('#account').textContent = `Conectada como ${user.email}`;
  await loadAll();
  subscribe();
  const h = new Date().getHours();
  const name = settings().userName ? `, ${settings().userName}` : '';
  say(`${h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'}${name}! ✨`, 'happy');
  pushStatus();
}
let started = false;
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && !started) { started = true; start(session); }
  if (event === 'SIGNED_OUT') { started = false; start(null); }
});
sb.auth.getSession().then(({ data }) => { if (!started) { started = Boolean(data.session); start(data.session); } });

setInterval(() => {
  $('#hero-date').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + fmtClock(Date.now());
  if (user) renderFocus();
}, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && user) loadAll(); });

const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (!standalone) $('#install-hint').textContent = /iPhone|iPad/.test(navigator.userAgent) ? 'Dica: Compartilhar → Adicionar à Tela de Início para usar como app.' : 'Dica: menu ⋮ → Instalar app / Adicionar à tela inicial.';
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
