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
const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
let kind = '', ref = ''; // что открыто: scene | loc | plan и его id

const sceneOf = (p, id) => { const sc = scenesOf(p), i = sc.findIndex(s => s.id === id); return i < 0 ? null : { i, n: i + 1, text: sc[i].text || 'Без названия' }; };
const exists = (k, id) => {
  const p = store.project;
  if (!p) return false;
  if (k === 'scene') return !!sceneOf(p, id);
  if (k === 'loc') return p.locations.some(l => l.id === id);
  if (k === 'plan') return p.plans.some(x => x.id === id);
  if (k === 'sides') return p.schedule.days.some(d => d.id === id.split('|')[0]);
  return false;
};

// путь внутри окошка: из сцены в план, из плана в локацию… — чтобы можно было вернуться
let trail = [];
const nameOf = (k, id) => {
  const p = store.project;
  if (k === 'scene') { const s = sceneOf(p, id); return s ? `Сцена ${s.n}` : 'Сцена'; }
  if (k === 'loc') return (p.locations.find(x => x.id === id) || {}).name || 'Локация';
  if (k === 'sides') return 'Выборка';
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
      ${props('').length ? `<h3>Реквизит во всех сценах</h3>${list(props(''))}` : ''}
      ${scenes.map(s => `<h3><button class="linkbtn" data-scene-open="${s.id}">Сцена ${s.t.n}. ${esc(s.t.text)}</button></h3>${list(props(s.id))}`).join('')}
    </div>`;
    return;
  }
  if (kind === 'plan') {
    const x = p.plans.find(q => q.id === ref), sc = sceneOf(p, x.sceneId), l = p.locations.find(q => q.id === x.locationId);
    el.innerHTML = head(`<b>План</b> ${esc(x.name)}`, 'Открыть в Shot Designer') + `<div class="split-scroll split-page">
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

// фото локации в боковой панели открываются на весь экран, со стрелками и скачиванием
document.addEventListener('click', async e => {
  const ph = e.target.closest('[data-sp-photo]');
  if (!ph || !panel().contains(ph) || kind !== 'loc') return;
  const l = store.project.locations.find(x => x.id === ref);
  if (l) (await import('./locations.js')).showPhoto(l, ph.dataset.spPhoto);
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
