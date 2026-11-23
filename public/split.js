// Боковая панель на половину экрана: сцена из сценария, локация или план Shot Designer.
// Слева остаётся то, с чем работали; справа то, что нужно подсмотреть, с кнопкой «открыть целиком».
import { store, $, esc, reduced, scenesOf } from './store.js';
import { srcOf } from './storage.js';
import { planSVG } from './shapes.js';

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
  return false;
};

function open(k, id) {
  if (!exists(k, id)) return;
  const first = !kind;
  kind = k; ref = id;
  render(first);
  $('.views').classList.add('split-on');
}
export const openScene = id => open('scene', id);
export const openLocation = id => open('loc', id);
export const openPlan = id => open('plan', id);

export function closeSplit() {
  if (!kind) return;
  kind = ''; ref = '';
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

const head = (title, full, nav = '') => `<header class="split-head">${nav}
  <span class="split-title">${title}</span>
  ${kind === 'scene' ? '<button class="act" data-split="page" title="Разбор, локация, кадры и планы этой сцены">Страница сцены</button>' : ''}
  <button class="act" data-split="full">${full}</button>
  <button class="ico" data-split="close" title="Закрыть" aria-label="Закрыть">${X}</button></header>`;

function render(jump, keep) {
  const p = store.project, el = panel();
  if (kind === 'scene') {
    const sc = sceneOf(p, ref), all = scenesOf(p);
    let on = false;
    const body = p.script.blocks.filter(b => b.text.trim() || b.type === 'scene').map(b => {
      if (b.type === 'scene') on = b.id === ref;
      return `<div data-type="${b.type}"${b.id ? ` data-id="${esc(b.id)}"` : ''}${on ? ' class="hl"' : ''}>${esc(b.text) || '<br>'}</div>`;
    }).join('');
    const nav = `<button class="ico" data-split="prev" title="Предыдущая сцена" aria-label="Предыдущая сцена"${sc.i > 0 ? '' : ' disabled'}><svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg></button>
      <button class="ico" data-split="next" title="Следующая сцена" aria-label="Следующая сцена"${sc.i < all.length - 1 ? '' : ' disabled'}><svg viewBox="0 0 24 24"><path d="M10 6l6 6-6 6"/></svg></button>`;
    el.innerHTML = head(`<b>Сцена ${sc.n}</b> ${esc(sc.text)}`, 'Открыть сценарий', nav + '')
      + `<div class="split-scroll"><div class="sheet split-sheet">${body}</div></div>`;
    const scroll = $('.split-scroll', el), h = $(`[data-id="${CSS.escape(ref)}"]`, el);
    if (h && !keep) setTimeout(() => scroll.scrollTo({ top: h.offsetTop - 18, behavior: jump || reduced.matches ? 'auto' : 'smooth' }), 30);
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
  const el = panel(), top = $('.split-scroll', el).scrollTop;
  render(false);
  $('.split-scroll', el).scrollTop = top;
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
  if (act === 'prev') go(-1);
  if (act === 'next') go(1);
  if (act === 'page') { const id = ref; closeSplit(); location.hash = `#/p/${store.project.id}/scene/${id}`; }
  if (act === 'full') {
    const k = kind, id = ref, pid = store.project.id;
    closeSplit();
    location.hash = k === 'scene' ? `#/p/${pid}/script/${id}` : k === 'loc' ? `#/p/${pid}/loc/${id}` : `#/p/${pid}/plan/${id}`;
  }
});
addEventListener('keydown', e => {
  if (e.key === 'Escape' && kind && !document.querySelector('dialog[open]') && !$('#ctx').classList.contains('on')) closeSplit();
});
