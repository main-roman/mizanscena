// Меню по правой кнопке на карточках планов Shot Designer и локаций — в любом разделе:
// отвязать план от сцены или локации, удалить план или локацию (с вопросом).
import { store, $, esc, toast } from './store.js';
import { sceneInfo } from './breakdown.js';
import { refreshSplit } from './split.js';
import { exportPlan } from './planexport.js';
import { bindPlan } from './interior.js';

const ctx = $('#ctx');
let target = null; // { kind: 'plan' | 'loc', id, sceneId, locId }

const hashParts = () => location.hash.replace(/^#\/?/, '').split('/').map(x => { try { return decodeURIComponent(x); } catch { return x; } });
const rerender = () => { dispatchEvent(new HashChangeEvent('hashchange')); refreshSplit(); };

function planOf(el) {
  if (el.dataset.planOpen) return el.dataset.planOpen;
  const a = el.matches('a[href*="/plan/"]') ? el : el.querySelector('a[href*="/plan/"]');
  return a ? hashOf(a.getAttribute('href'))[3] : '';
}
const hashOf = h => h.replace(/^#\/?/, '').split('/').map(x => { try { return decodeURIComponent(x); } catch { return x; } });

document.addEventListener('contextmenu', e => {
  const p = store.project;
  if (!p) return;
  const tile = e.target.closest('.plan-tile:not(.plan-new), [data-plan-open], .loc-tile[data-loc]:not(.loc-new)');
  if (!tile || tile.closest('#ctx, #split .split-head')) return;
  const view = document.body.dataset.view, parts = hashParts();
  let item = '';
  if (tile.matches('.loc-tile')) {
    const l = p.locations.find(x => x.id === tile.dataset.loc);
    if (!l) return;
    target = { kind: 'loc', id: l.id };
    item = `<h2>${esc(l.name)}</h2><div class="menu"><button data-menu="open">Открыть</button><button data-menu="del">Удалить локацию<small>фото и реквизит этой локации</small></button></div>`;
  } else {
    const id = planOf(tile), pl = p.plans.find(x => x.id === id);
    if (!pl) return;
    // откуда открыли: карточка сцены у локации, страница сцены или страница локации
    const sceneId = tile.closest('.loc-sc')?.dataset.scene || (view === 'scene' ? parts[3] : '') || '';
    const locId = view === 'location' ? parts[3] : '';
    target = { kind: 'plan', id, sceneId, locId };
    const sc = sceneInfo(p).find(x => x.id === pl.sceneId), l = p.locations.find(x => x.id === pl.locationId);
    const info = sceneInfo(p);
    item = `<h2>${esc(pl.name)}</h2><div class="menu"><button data-menu="open">Открыть план</button>`
      + (info.length ? `<label class="menu-row menu-scene"><span>${sc ? 'Другая сцена' : 'В сцену'}</span><select data-menu-scene aria-label="Привязать к сцене"><option value="">выбрать…</option>${info.filter(x => x.id !== pl.sceneId).map(x => `<option value="${x.id}">${x.n}. ${esc(x.place || x.text)}</option>`).join('')}</select></label>` : '')
      + (sc ? `<button data-menu="unscene">Отвязать от сцены<small>сейчас сцена ${sc.n}</small></button>` : '')
      + (l ? `<button data-menu="unloc">Отвязать от локации<small>${esc(l.name)}</small></button>` : '')
      + `<div class="menu-row"><span>Скачать</span><button data-menu="jpg">JPG</button><button data-menu="png">PNG</button><button data-menu="pdf">PDF</button></div>`
      + `<button data-menu="del">Удалить план<small>кадры останутся без плана</small></button></div>`;
  }
  e.preventDefault();
  ctx.dataset.kind = 'tile';
  ctx.innerHTML = item;
  ctx.classList.add('on');
  ctx.style.left = Math.max(8, Math.min(e.clientX + 6, innerWidth - ctx.offsetWidth - 8)) + 'px';
  ctx.style.top = Math.max(8, Math.min(e.clientY + 6, innerHeight - ctx.offsetHeight - 8)) + 'px';
});

ctx.addEventListener('change', e => {
  if (!e.target.matches('[data-menu-scene]') || ctx.dataset.kind !== 'tile' || !target || !e.target.value) return;
  const p = store.project, pl = p.plans.find(x => x.id === target.id);
  if (!pl) return;
  ctx.classList.remove('on');
  bindPlan(p, pl, e.target.value, target.locId);
  const n = (sceneInfo(p).find(x => x.id === e.target.value) || {}).n;
  store.touch(); rerender(); toast(`План «${pl.name}» — в сцене ${n}`);
});
ctx.addEventListener('click', e => {
  const b = e.target.closest('[data-menu]');
  if (!b || ctx.dataset.kind !== 'tile' || !target) return;
  ctx.classList.remove('on');
  const p = store.project, act = b.dataset.menu;
  if (target.kind === 'loc') {
    const l = p.locations.find(x => x.id === target.id);
    if (!l) return;
    if (act === 'open') location.hash = `#/p/${p.id}/loc/${l.id}`;
    if (act === 'del') {
      if (!confirm(`Удалить локацию «${l.name}» вместе с её фото и списком реквизита?`)) return;
      p.locations = p.locations.filter(x => x !== l);
      p.plans.forEach(x => { if (x.locationId === l.id) x.locationId = ''; });
      store.touch(); rerender(); toast('Локация удалена');
    }
    return;
  }
  const pl = p.plans.find(x => x.id === target.id);
  if (!pl) return;
  if (act === 'open') location.hash = `#/p/${p.id}/plan/${pl.id}`;
  if (act === 'jpg' || act === 'png' || act === 'pdf') exportPlan(pl, act);
  if (act === 'unscene') {
    // у кадров этого плана сцена остаётся: отвязывается только сам план
    pl.sceneId = '';
    store.touch(); rerender(); toast(`План «${pl.name}» отвязан от сцены`);
  }
  if (act === 'unloc') { pl.locationId = ''; store.touch(); rerender(); toast(`План «${pl.name}» отвязан от локации`); }
  if (act === 'del') {
    const n = p.shots.filter(s => s.planId === pl.id).length;
    if (!confirm(`Удалить план «${pl.name}» совсем, из всех разделов?${n ? ` Его кадры (${n}) останутся в режиссёрском сценарии без плана.` : ''}`)) return;
    p.shots.forEach(s => { if (s.planId === pl.id) { s.planId = ''; s.cameraId = ''; s.phaseId = ''; } });
    p.plans = p.plans.filter(x => x !== pl);
    store.touch(); rerender(); toast('План удалён');
  }
});

document.addEventListener('pointerdown', e => { if (ctx.dataset.kind === 'tile' && ctx.classList.contains('on') && !ctx.contains(e.target)) ctx.classList.remove('on'); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape' && ctx.dataset.kind === 'tile') ctx.classList.remove('on'); });
