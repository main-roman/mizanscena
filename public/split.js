// Боковая панель на половину экрана: сцена из сценария, локация или план Shot Designer.
// Слева остаётся то, с чем работали; справа то, что нужно подсмотреть, с кнопкой «открыть целиком».
import { store, $, esc, reduced, scenesOf } from './store.js';
import { srcOf } from './storage.js';
import { planSVG } from './shapes.js';
import { sceneHTML } from './scenes.js';
import { sidesHTML, sidesData, sidesPDF, sidesWord, SIDES_OPTS } from './sides.js';
import { sceneInfo } from './breakdown.js';
import { castList, dayInfo, shiftNo } from './schedmodel.js';

const panel = () => $('#split');
// Другие разделы добавляют свои виды окошка: registerKind('shot', { exists, name, render(el, ref, head), after(el) })
const KINDS = {};
export const registerKind = (k, def) => { KINDS[k] = def; };
const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
let kind = '', ref = ''; // что открыто: scene | loc | plan и его id

function photoSet(p, r) {
  const [set, id, photoId] = String(r).split('|');
  if (set === 'loc') {
    const l = p.locations.find(x => x.id === id);
    if (!l || !l.photos.length) return null;
    const list = l.photos.map(ph => ({ src: ph.src, name: ph.name }));
    return { title: l.name, list, i: Math.max(0, l.photos.findIndex(ph => ph.id === photoId)), ids: l.photos.map(ph => ph.id), set, id };
  }
  if (set === 'shot') {
    const sh = p.shots.find(x => x.id === id);
    const list = sh ? (Array.isArray(sh.frames) && sh.frames.length ? sh.frames : sh.frame ? [sh.frame] : []) : [];
    if (!list.length) return null;
    const ids = list.map((x, k) => String(k)), i = Math.max(0, ids.indexOf(photoId));
    return { title: 'Раскадровка', list: list.map(src => ({ src, name: '' })), i, ids, set, id };
  }
  return null;
}
const sceneOf = (p, id) => { const sc = scenesOf(p), i = sc.findIndex(s => s.id === id); return i < 0 ? null : { i, n: i + 1, text: sc[i].text || 'Без названия' }; };
const exists = (k, id) => {
  const p = store.project;
  if (!p) return false;
  if (k === 'scene') return !!sceneOf(p, id);
  if (k === 'loc') return p.locations.some(l => l.id === id);
  if (k === 'plan') return p.plans.some(x => x.id === id);
  if (k === 'sides') return p.schedule.days.some(d => d.id === id.split('|')[0]);
  if (k === 'photo') return !!photoSet(p, id);
  if (KINDS[k]) return KINDS[k].exists(p, id);
  return false;
};

// путь внутри окошка: из сцены в план, из плана в локацию… — чтобы можно было вернуться
let trail = [];
const nameOf = (k, id) => {
  const p = store.project;
  if (k === 'scene') { const s = sceneOf(p, id); return s ? `Сцена ${s.n}` : 'Сцена'; }
  if (k === 'loc') return (p.locations.find(x => x.id === id) || {}).name || 'Локация';
  if (k === 'sides') return 'Выборка';
  if (k === 'photo') return 'Фото';
  if (KINDS[k]) return KINDS[k].name(p, id);
  return (p.plans.find(x => x.id === id) || {}).name || 'План';
};

function open(k, id) {
  if (!exists(k, id)) return;
  const first = !kind;
  if (kind && !(kind === k && ref === id)) {
    trail.push({ kind, ref, top: $('.split-scroll', panel())?.scrollTop || 0 });
    if (trail.length > 30) trail.shift();
  }
  kind = k; ref = id;
  render(first);
  $('.views').classList.add('split-on');
}

function back() {
  let prev;
  while ((prev = trail.pop()) && !exists(prev.kind, prev.ref)); // удалённое пропускаем
  if (!prev) return;
  kind = prev.kind; ref = prev.ref;
  render(true, true);
  const sc = $('.split-scroll', panel());
  if (sc) sc.scrollTop = prev.top;
}
export const openScene = id => open('scene', id);
export const openLocation = id => open('loc', id);
export const openPlan = id => open('plan', id);
// выборка дня: ref = «id дня|персонаж» (пустой персонаж — для группы)
export const openSides = (dayId, char = '') => open('sides', `${dayId}|${char}`);
// фото в окошке справа: набор фото локации (листаются) или картинка кадра раскадровки
// фото — в отдельном окошке поверх экрана: основной экран не сдвигается
export const openPhoto = (set, id, photoId = '') => showWin(`${set}|${id}|${photoId}`);
export const openKind = (k, id) => open(k, id);
export const splitKind = () => kind;
export const splitRef = () => ref;

export function closeSplit() {
  if (!kind) return;
  kind = ''; ref = ''; trail = [];
  $('.views').classList.remove('split-on');
}

// после правок соавтора или ИИ: показываем свежее, если открытое ещё есть
export function refreshSplit() {
  if (!kind) return;
  if (!exists(kind, ref)) return closeSplit();
  const top = $('.split-scroll', panel())?.scrollTop || 0;
  render(true, true);
  $('.split-scroll', panel()).scrollTop = top;
}

const head = (title, full, nav = '', extra = '') => `<header class="split-head">${trail.length ? `<button class="act split-back" data-split="back" title="Вернуться"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 6l-6 6 6 6"/></svg>${esc(nameOf(trail[trail.length - 1].kind, trail[trail.length - 1].ref))}</button>` : ''}${nav}
  <span class="split-title">${title}</span>
  ${kind === 'scene' ? '<button class="ico" data-split="page" title="Открыть страницу сцены на весь экран" aria-label="На весь экран"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>' : ''}
  ${extra}<button class="act" data-split="full">${full}</button>
  <button class="ico" data-split="close" title="Закрыть" aria-label="Закрыть">${X}</button></header>`;

function render(jump, keep) {
  const p = store.project, el = panel();
  el.closest('.views')?.classList.toggle('split-photo-on', kind === 'photo');
  if (kind === 'photo') {
    const st = photoSet(p, ref), ph = st.list[st.i];
    const nav = st.list.length > 1 ? `<button class="ico" data-split="ph-prev" title="Предыдущее фото (←)" aria-label="Предыдущее"${st.i > 0 ? '' : ' disabled'}><svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg></button>
      <button class="ico" data-split="ph-next" title="Следующее фото (→)" aria-label="Следующее"${st.i < st.list.length - 1 ? '' : ' disabled'}><svg viewBox="0 0 24 24"><path d="M10 6l6 6-6 6"/></svg></button>` : '';
    el.innerHTML = head(`<b>${esc(st.title)}</b>${st.list.length > 1 ? ` ${st.i + 1} из ${st.list.length}` : ''}`, 'Скачать', nav)
      + `<div class="split-scroll split-photo"><img src="${esc(srcOf(ph.src))}" alt="">${st.list.length > 1 ? `<div class="sp-strip">${st.list.map((x, k) => `<button class="${k === st.i ? 'on' : ''}" data-split-ph="${k}"><img src="${esc(srcOf(x.src))}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}</div>`;
    return;
  }
  if (KINDS[kind]) {
    KINDS[kind].render(el, ref, head, keep);
    return;
  }
  if (kind === 'scene') {
    // страница сцены с разбором; весь сценарий — кнопкой «Сценарий целиком»
    const sc = sceneOf(p, ref), all = scenesOf(p);
    const nav = `<button class="ico" data-split="prev" title="Предыдущая сцена" aria-label="Предыдущая сцена"${sc.i > 0 ? '' : ' disabled'}><svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg></button>
      <button class="ico" data-split="next" title="Следующая сцена" aria-label="Следующая сцена"${sc.i < all.length - 1 ? '' : ' disabled'}><svg viewBox="0 0 24 24"><path d="M10 6l6 6-6 6"/></svg></button>`;
    el.innerHTML = head(`<b>Сцена ${sc.n}</b> ${esc(sc.text)}`, 'Сценарий целиком', nav)
      + `<div class="split-scroll split-page split-scn">${sceneHTML(p, ref, true)}</div>`;
    if (!keep) $('.split-scroll', el).scrollTop = 0;
    return;
  }
  if (kind === 'sides') {
    const [dayId, char] = ref.split('|'), day = p.schedule.days.find(d => d.id === dayId), info = sceneInfo(p);
    const di = dayInfo(p, day, info, castList(p, info)), n = shiftNo(p, day) || p.schedule.days.indexOf(day) + 1;
    const pick = (c, label, list) => `<button class="sides-who${c === char ? ' on' : ''}" data-sides-for="${esc(c)}">${label}<small>сц. ${list.map(s => s.n).join(', ')}</small></button>`;
    el.innerHTML = head(`<b>Выборка</b> смена ${n}`, 'PDF', '', '<button class="act" data-split="word" title="Документ Word">Word</button>')
      + `<div class="split-scroll split-sides"><div class="sides-pick">${pick('', 'Для группы', di.scenes)}${di.cast.map(c => pick(c.char, esc(c.char.charAt(0) + c.char.slice(1).toLowerCase()) + (c.actor ? ` — ${esc(c.actor)}` : ''), di.scenes.filter(s => s.chars.includes(c.char)))).join('')}</div>
        <div class="sides-opts">${SIDES_OPTS.map(([k, t]) => `<label><input type="checkbox" data-sides-opt="${k}"${p.schedule.info.sides[k] ? ' checked' : ''}><span>${t}</span></label>`).join('')}</div>
        ${di.scenes.length ? sidesHTML(p, day, char) : '<p class="empty">В этом дне нет сцен.</p>'}</div>`;
    if (!keep) $('.split-scroll', el).scrollTop = 0;
    return;
  }
  if (kind === 'loc') {
    const l = p.locations.find(x => x.id === ref);
    const scenes = l.sceneIds.map(id => ({ id, t: sceneOf(p, id) })).filter(x => x.t);
    const props = sid => l.props.filter(x => x.sceneId === sid && x.text.trim());
    const list = items => items.length ? `<ul class="sp-props">${items.map(x => `<li${x.ready ? ' class="ready"' : ''}>${esc(x.text)}</li>`).join('')}</ul>` : '';
    el.innerHTML = head(`<b>Локация</b> ${esc(l.name)}`, 'Открыть локацию') + `<div class="split-scroll split-page">
      ${l.geo ? `<p class="sp-geo"><a href="${esc(/^https?:\/\//i.test(l.geo) ? l.geo : 'https://yandex.ru/maps/?text=' + encodeURIComponent(l.geo))}" target="_blank" rel="noopener">${esc(l.geo)}</a></p>` : ''}
      ${l.photos.length ? `<div class="sp-photos">${l.photos.map(ph => `<button class="sp-ph" data-sp-photo="${ph.id}" title="Открыть фото"><img src="${esc(srcOf(ph.src))}" alt="" loading="lazy"></button>`).join('')}</div>` : '<p class="empty">Фотографий пока нет.</p>'}
      ${l.note ? `<p class="sp-note">${esc(l.note)}</p>` : ''}
      ${l.interior && l.interior.objects.length ? `<h3>Базовый интерьер</h3><div class="sp-plan">${planSVG({ name: '', objects: l.interior.objects, wallColor: l.interior.wallColor, floorColor: l.interior.floorColor, phases: [] }, { pad: 0.8 })}</div><p class="sp-links">из плана «${esc(l.interior.from || '')}»</p>` : ''}
      ${props('').length ? `<h3>Реквизит во всех сценах</h3>${list(props(''))}` : ''}
      ${scenes.map(s => `<h3><button class="linkbtn" data-scene-open="${s.id}">Сцена ${s.t.n}. ${esc(s.t.text)}</button></h3>${list(props(s.id))}`).join('')}
    </div>`;
    return;
  }
  if (kind === 'plan') {
    const x = p.plans.find(q => q.id === ref), sc = sceneOf(p, x.sceneId), l = p.locations.find(q => q.id === x.locationId);
    el.innerHTML = head(`<b>План</b> ${esc(x.name)}`, 'Открыть план') + `<div class="split-scroll split-page">
      <div class="sp-plan">${planSVG(x, { pad: 0.8 })}</div>
      <p class="sp-links">${sc ? `<button class="linkbtn" data-scene-open="${x.sceneId}">Сцена ${sc.n}. ${esc(sc.text)}</button>` : 'Без сцены'}
        ${l ? ` · <button class="linkbtn" data-loc-open="${l.id}">${esc(l.name)}</button>` : ''}</p>
      ${x.note ? `<p class="sp-note">${esc(x.note)}</p>` : ''}
    </div>`;
  }
}

function go(step) {
  const all = scenesOf(store.project), i = all.findIndex(s => s.id === ref), next = all[i + step];
  if (!next) return;
  ref = next.id;
  // соседняя сцена: текст тот же, меняем подсветку и плавно едем к ней
  render(false);
}

// фото локации в окошке открываются тут же, в этом же окошке (назад — к локации)
document.addEventListener('click', e => {
  const ph = e.target.closest('[data-sp-photo]');
  if (!ph || !panel().contains(ph) || kind !== 'loc') return;
  openPhoto('loc', ref, ph.dataset.spPhoto);
});
// листать фото: стрелки в шапке, полоска миниатюр, клавиши ← →
function stepPhoto(k) {
  const st = photoSet(store.project, ref);
  if (!st) return;
  const i = Math.max(0, Math.min(st.list.length - 1, k));
  ref = `${st.set}|${st.id}|${st.ids[i]}`;
  render(false, true);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-split-ph]');
  if (!b || kind !== 'photo' || !panel().contains(b)) return;
  stepPhoto(+b.dataset.splitPh);
});
addEventListener('keydown', e => {
  if (kind !== 'photo' || e.target.closest('input, textarea, select, [contenteditable]')) return;
  const st = photoSet(store.project, ref);
  if (!st) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); stepPhoto(st.i - 1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); stepPhoto(st.i + 1); }
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-split]');
  if (!b || !panel().contains(b)) return;
  const act = b.dataset.split;
  if (act === 'close') closeSplit();
  if (act === 'back') back();
  if (act === 'prev') go(-1);
  if (act === 'next') go(1);
  if (act === 'page') { const id = ref; closeSplit(); location.hash = `#/p/${store.project.id}/scene/${id}`; }
  if (kind === 'photo') {
    const st = photoSet(store.project, ref);
    if (act === 'ph-prev') stepPhoto(st.i - 1);
    if (act === 'ph-next') stepPhoto(st.i + 1);
    if (act === 'full') savePhoto(st);
    return;
  }
  if (KINDS[kind] && KINDS[kind].action && KINDS[kind].action(act, ref)) return;
  if (kind === 'sides' && (act === 'full' || act === 'word')) {
    const [dayId, char] = ref.split('|'), p = store.project, day = p.schedule.days.find(d => d.id === dayId);
    if (!sidesData(p, day, char).scenes.length) return;
    if (act === 'word') sidesWord(p, day, char); else sidesPDF(p, day, char);
    return;
  }
  if (act === 'full') {
    const k = kind, id = ref, pid = store.project.id;
    closeSplit();
    location.hash = k === 'scene' ? `#/p/${pid}/script/${id}` : k === 'loc' ? `#/p/${pid}/loc/${id}` : `#/p/${pid}/plan/${id}`;
  }
});
async function savePhoto(st) {
  try {
    const ph = st.list[st.i], blob = await (await fetch(srcOf(ph.src))).blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${st.title}${st.list.length > 1 ? ' ' + (st.i + 1) : ''}.jpg`.replace(/[\\/:*?"<>|]+/g, ' ');
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch { /* не скачалось — окошко остаётся */ }
}
addEventListener('keydown', e => {
  if (e.key === 'Escape' && kind && !document.querySelector('dialog[open]') && !$('#ctx').classList.contains('on')) closeSplit();
});

// правки в окошке или на странице сцены: окошко показывает свежее
document.addEventListener('miz:scene-changed', () => { if (kind === 'scene') refreshSplit(); });

document.addEventListener('change', e => {
  const t = e.target.closest('[data-sides-opt]');
  if (!t || kind !== 'sides' || !panel().contains(t)) return;
  store.project.schedule.info.sides[t.dataset.sidesOpt] = t.checked;
  store.touch(); render(true);
});

// выборка: кому — группе или актёру; переключение не записывается в путь «назад»
document.addEventListener('click', e => {
  const b = e.target.closest('[data-sides-for]');
  if (!b || kind !== 'sides' || !panel().contains(b)) return;
  ref = ref.split('|')[0] + '|' + b.dataset.sidesFor;
  render(false);
});

// ---------- окошко фото поверх экрана ----------
// Перетаскивается за шапку, тянется за любой край и угол. Место и размер запоминаются.
// Листается стрелками в шапке, полоской миниатюр и клавишами ← →; закрывается крестиком или Escape.
let win = null, winRef = '';
const WIN_KEY = 'miz:photo-win';
const winBox = () => { try { return JSON.parse(localStorage.getItem(WIN_KEY) || 'null'); } catch { return null; } };
const fitBox = b => {
  const w = Math.min(Math.max(280, b.w), innerWidth - 16), h = Math.min(Math.max(220, b.h), innerHeight - 16);
  return { w, h, x: Math.min(Math.max(8, b.x), innerWidth - w - 8), y: Math.min(Math.max(8, b.y), innerHeight - h - 8) };
};
function placeWin(b) {
  b = fitBox(b);
  Object.assign(win.style, { left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px' });
  return b;
}
const saveBox = () => { const r = win.getBoundingClientRect(); try { localStorage.setItem(WIN_KEY, JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height })); } catch { /* не страшно */ } };

function showWin(r) {
  if (!photoSet(store.project, r)) return;
  winRef = r;
  if (!win) {
    win = document.createElement('div');
    win.className = 'photo-win';
    win.setAttribute('role', 'dialog');
    win.innerHTML = `<header class="pw-head"><b class="pw-title"></b><span class="pw-count"></span><span class="grow"></span>
        <button class="ico" data-pw="prev" title="Предыдущее (←)" aria-label="Предыдущее"><svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg></button>
        <button class="ico" data-pw="next" title="Следующее (→)" aria-label="Следующее"><svg viewBox="0 0 24 24"><path d="M10 6l6 6-6 6"/></svg></button>
        <button class="ico" data-pw="save" title="Скачать" aria-label="Скачать"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></button>
        <button class="ico" data-pw="close" title="Закрыть (Esc)" aria-label="Закрыть">${X}</button></header>
      <div class="pw-img"><img alt=""></div><div class="pw-strip"></div>
      ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map(d => `<i class="pw-rs pw-${d}" data-rs="${d}"></i>`).join('')}`;
    document.body.append(win);
    placeWin(winBox() || { w: Math.min(560, innerWidth * 0.42), h: Math.min(460, innerHeight * 0.6), x: innerWidth - Math.min(560, innerWidth * 0.42) - 24, y: 70 });
    win.addEventListener('click', e => {
      const b = e.target.closest('[data-pw]'), t = e.target.closest('[data-pw-i]');
      if (t) { stepWin(+t.dataset.pwI); return; }
      if (!b) return;
      const st = photoSet(store.project, winRef);
      if (b.dataset.pw === 'close') closeWin();
      if (b.dataset.pw === 'prev') stepWin(st.i - 1);
      if (b.dataset.pw === 'next') stepWin(st.i + 1);
      if (b.dataset.pw === 'save') savePhoto(st);
    });
    win.addEventListener('pointerdown', winGrab);
  }
  win.classList.remove('out');
  win.classList.add('on');
  drawWin();
}
function drawWin() {
  const st = photoSet(store.project, winRef);
  if (!st) return closeWin();
  const ph = st.list[st.i];
  win.querySelector('.pw-title').textContent = st.title;
  win.querySelector('.pw-count').textContent = st.list.length > 1 ? `${st.i + 1} из ${st.list.length}` : '';
  win.querySelector('.pw-img img').src = srcOf(ph.src);
  for (const k of ['prev', 'next']) { const b = win.querySelector(`[data-pw="${k}"]`); b.hidden = st.list.length < 2; b.disabled = k === 'prev' ? st.i === 0 : st.i >= st.list.length - 1; }
  const strip = win.querySelector('.pw-strip');
  strip.hidden = st.list.length < 2;
  strip.innerHTML = st.list.length < 2 ? '' : st.list.map((x, k) => `<button class="${k === st.i ? 'on' : ''}" data-pw-i="${k}"><img src="${esc(srcOf(x.src))}" alt="" loading="lazy"></button>`).join('');
  strip.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function stepWin(k) {
  const st = photoSet(store.project, winRef);
  if (!st) return;
  const i = Math.max(0, Math.min(st.list.length - 1, k));
  winRef = `${st.set}|${st.id}|${st.ids[i]}`;
  drawWin();
}
export function closeWin() {
  if (!win || !win.classList.contains('on')) return;
  win.classList.remove('on'); win.classList.add('out');
}
// перетащить за шапку, растянуть за край или угол
function winGrab(e) {
  if (e.button !== 0) return;
  const rs = e.target.closest('[data-rs]'), head = !rs && e.target.closest('.pw-head') && !e.target.closest('button');
  if (!rs && !head) return;
  e.preventDefault();
  const r = win.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, d = rs ? rs.dataset.rs : '';
  win.classList.add('moving');
  document.body.classList.add(rs ? 'pw-resizing' : 'pw-dragging');
  if (rs) document.body.style.setProperty('--pw-cursor', getComputedStyle(rs).cursor);
  const move = m => {
    const dx = m.clientX - sx, dy = m.clientY - sy;
    if (!rs) { placeWin({ x: r.left + dx, y: r.top + dy, w: r.width, h: r.height }); return; }
    let { left: x, top: y, width: w, height: h } = r;
    if (d.includes('e')) w = r.width + dx;
    if (d.includes('s')) h = r.height + dy;
    if (d.includes('w')) { w = Math.max(280, r.width - dx); x = r.right - w; }
    if (d.includes('n')) { h = Math.max(220, r.height - dy); y = r.bottom - h; }
    placeWin({ x, y, w, h });
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    win.classList.remove('moving'); document.body.classList.remove('pw-resizing', 'pw-dragging');
    saveBox();
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}
// клавиши: Escape закрывает окошко фото раньше боковой панели; ← → листают
addEventListener('keydown', e => {
  if (!win || !win.classList.contains('on') || (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]'))) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeWin(); return; }
  const st = photoSet(store.project, winRef);
  if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); stepWin(st.i - 1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); stepWin(st.i + 1); }
}, true);
addEventListener('resize', () => { if (win) placeWin(winBox() || { x: 0, y: 0, w: 560, h: 460 }); });
addEventListener('hashchange', () => { if (win && !store.project) closeWin(); });
