// Локации: карточки с фотографиями, адресом, сценами сценария, планами и постановочным реквизитом.
// Фото можно бросить прямо на карточку; программа уменьшает их сама.
import { store, $, $$, uid, esc, toast, replaceHash, download, safeName, storeImage, pickFile, scenesOf, numbering, normalizeLocation, objectsOf, objKey, setObjectGeo, setObjectBase, locName } from './store.js';
import { srcOf } from './storage.js';
import { planSVG } from './shapes.js';
import { createPlan } from './plan.js';
import { baseOf, saveBase, hasEnv, locOfPlan, baseCount, bindPlan } from './interior.js';
import { pointerDrag } from './dragsort.js';
import { CATS, sceneInfo, sceneItems } from './breakdown.js';
import { planSelect } from './scenes.js';

const PHOTO_MAX = 2400; // по длинной стороне: хватает для экрана и печати, файл около 0,5–1 МБ
const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const project = () => store.project;
const locOf = id => project().locations.find(l => l.id === id);
let openId = '';

const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`;
};

export function sceneTitle(p, id) {
  const scenes = scenesOf(p), i = scenes.findIndex(s => s.id === id);
  return i < 0 ? null : { n: i + 1, text: scenes[i].text || 'Без названия' };
}

export function newLocation(data = {}) {
  const l = normalizeLocation({ object: `Объект ${objectsOf(project()).length + 1}`, sub: '', ...data });
  // у подобъекта известного объекта адрес уже есть
  const same = project().locations.find(x => objKey(x.object) === objKey(l.object) && x.geo);
  if (same && !l.geo) l.geo = same.geo;
  project().locations.push(l);
  store.touch();
  return l;
}

// Фото -> уменьшенный JPEG в хранилище проекта. Идут по очереди, чтобы не съесть память на десятках снимков.
export async function addPhotos(l, files) {
  files = [...files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|gif|bmp)$/i.test(f.name));
  if (!files.length) return toast('Это не фотографии');
  let ok = 0;
  for (const f of files) {
    toast(files.length > 1 ? `Сжимаю фото ${ok + 1} из ${files.length}…` : 'Сжимаю фото…');
    try {
      const { src, ratio } = await storeImage(f, PHOTO_MAX);
      l.photos.push({ id: uid(), src, ratio, name: f.name.replace(/\.[^.]+$/, '') });
      ok++;
      store.touch();
      rerender();
    } catch { /* формат не открылся, например HEIC в браузере без поддержки */ }
  }
  toast(ok === files.length ? `Добавлено фото: ${ok}` : `Добавлено ${ok} из ${files.length}: остальные не открылись`);
}

function rerender() {
  if (document.body.dataset.view === 'locations') renderLocations();
  if (document.body.dataset.view === 'location' && openId) renderLocation(openId);
}

// ---------- все локации ----------

export function renderLocations() {
  const p = project(), base = `#/p/${p.id}`;
  const tile = l => {
    const sc = l.sceneIds.map(id => sceneTitle(p, id)).filter(Boolean);
    const cover = l.photos[0];
    return `<a class="loc-tile" href="${base}/loc/${l.id}" data-loc="${l.id}">
      <span class="thumb loc-thumb">${cover ? `<img src="${esc(srcOf(cover.src))}" alt="" loading="lazy">` : '<span class="thumb-empty">Перетащите сюда фото</span>'}</span>
      <span class="tile-name">${esc(l.sub || l.object)}</span>
      <span class="tile-meta">${[sc.length ? 'Сцены ' + sc.map(s => s.n).join(', ') : 'Сцены не выбраны', l.photos.length ? plural(l.photos.length, 'фото', 'фото', 'фото') : ''].filter(Boolean).join(' · ')}</span>
    </a>`;
  };
  const geoText = g => !g ? '<i>адрес не указан</i>' : /^https?:\/\//i.test(g.trim()) ? `<a href="${esc(g)}" target="_blank" rel="noopener">метка на карте</a>` : esc(g);
  const objects = objectsOf(p).map(o => `<section class="lo-obj">
      <header class="lo-head"><h2>${esc(o.name)}</h2><span class="lo-geo">${geoText(o.geo)}${o.base ? ` · база: ${esc(o.base)}` : ''}</span><span class="grow"></span>
        <button class="linkbtn" data-act="new-sub" data-object="${esc(o.name)}">+ подобъект</button></header>
      <div class="loc-grid">${o.locs.map(tile).join('')}</div></section>`).join('');
  $('#view-locations').innerHTML = `<div class="page">
    <header class="page-head"><h1>Локации</h1><button class="act main" data-act="new-loc">Новый объект</button></header>
    <p class="page-hint">Локации собраны по объектам: у объекта (дом, стадион) один адрес, внутри — подобъекты (гостиная, кухня). Фотографии можно перетащить прямо на карточку: программа сама их уменьшит. Правая кнопка мыши по карточке: удалить.</p>
    ${objects}
    <div class="loc-grid lo-newrow"><button class="loc-tile loc-new" data-act="new-loc" data-loc="new"><span class="thumb">${PLUS}</span><span class="tile-name">Новый объект</span></button></div></div>`;
}

$('#view-locations').addEventListener('click', e => {
  const ns = e.target.closest('[data-act="new-sub"]');
  if (ns) { const l = newLocation({ object: ns.dataset.object, sub: 'Новый подобъект' }); location.hash = `#/p/${project().id}/loc/${l.id}`; return; }
  if (!e.target.closest('[data-act="new-loc"]')) return;
  const l = newLocation();
  location.hash = `#/p/${project().id}/loc/${l.id}`;
});

// бросить фото на карточку
for (const id of ['#view-locations', '#view-location']) {
  const host = $(id);
  const target = e => id === '#view-locations' ? e.target.closest('[data-loc]') : $('.loc', host);
  host.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    $$('.drop', host).forEach(x => x.classList.remove('drop'));
    const t = target(e);
    if (t) t.classList.add('drop');
  });
  host.addEventListener('dragleave', e => { if (!host.contains(e.relatedTarget)) $$('.drop', host).forEach(x => x.classList.remove('drop')); });
  host.addEventListener('drop', async e => {
    $$('.drop', host).forEach(x => x.classList.remove('drop'));
    const t = target(e);
    if (!t || !e.dataTransfer.files.length) return;
    e.preventDefault();
    const l = id === '#view-location' ? locOf(openId) : t.dataset.loc === 'new' ? newLocation() : locOf(t.dataset.loc);
    if (l) addPhotos(l, e.dataTransfer.files);
  });
}

// ---------- одна локация ----------

const mapUrl = geo => /^https?:\/\//i.test(geo) ? geo : `https://yandex.ru/maps/?text=${encodeURIComponent(geo)}`;

export function mountLocation(id) {
  openId = id;
  renderLocation(id);
}

export function renderLocation(id) {
  const p = project(), l = locOf(id), base = `#/p/${p.id}`;
  if (!l) return;
  const scenes = scenesOf(p), nums = numbering(p);
  const obj = objectsOf(p).find(o => o.key === objKey(l.object)) || {};
  const ogeo = obj.geo || l.geo, obase = obj.base || l.base; // адрес и база группы — общие для объекта
  const linked = l.sceneIds.map(sid => ({ id: sid, t: sceneTitle(p, sid) })).filter(x => x.t);
  const free = scenes.map((s, i) => ({ s, i })).filter(({ s }) => !l.sceneIds.includes(s.id));
  // похоже по названию: сцены, в заголовке которых встречается название локации
  const key = l.name.toLowerCase().replace(/^(инт|нат|экст)\.?\s*/, '').split(/[\s.,]+/).filter(w => w.length > 3);
  const looks = s => key.some(w => (s.text || '').toLowerCase().includes(w));
  // планы сцены: привязанные к этой сцене и к этой локации (или ещё ни к какой)
  const scenePlans = sid => p.plans.filter(x => x.sceneId === sid && (!x.locationId || x.locationId === l.id));
  const sceneIds = new Set(scenes.map(s => s.id));
  const otherPlans = p.plans.filter(x => x.locationId === l.id && !linked.some(s => s.id === x.sceneId));
  const nobody = p.plans.filter(x => !x.locationId && !sceneIds.has(x.sceneId));
  syncProps(p, l, linked);
  // на карточке сцены план крупно и без света: здесь важна расстановка, а не приборы
  const bigTile = x => `<button class="plan-tile plan-big" data-plan-open="${x.id}" title="Показать рядом"><span class="thumb">${planSVG({ ...x, objects: x.objects.filter(o => o.type !== 'light') }, { pad: 0.5 })}</span><span class="tile-name">${esc(x.name)}</span></button>`;
  const tile = x => `<button class="plan-tile" data-plan-open="${x.id}" title="Показать рядом"><span class="thumb">${planSVG(x, { pad: 0.8 })}</span><span class="tile-name">${esc(x.name)}</span></button>`;

  // реквизит — рыжие ячейки, как в режиссёрском и разборе; × убирает, в поле — новый предмет и Enter
  const chip = x => `<span class="lp-chip" data-prop="${x.id}"><span class="lp-t" data-lp-edit title="Щёлкните, чтобы исправить">${esc(x.text)}</span><button data-act="del-prop" title="Убрать" aria-label="Убрать">×</button></span>`;
  const group = (sid, title = '') => `<div class="props-group" data-scene="${sid}">${title ? `<h3>${title}</h3>` : ''}
      <div class="lp-chips">${l.props.filter(x => x.sceneId === sid && x.text.trim()).map(chip).join('')}
      <input class="props-add lp-add" type="text" placeholder="${sid ? '+ предмет для этой сцены' : '+ предмет'}" aria-label="Добавить предмет"></div></div>`;
  const lost = [...new Set(l.props.map(x => x.sceneId).filter(sid => sid && !linked.some(s => s.id === sid)))];

  const info = sceneInfo(p);
  const sceneCard = s => {
    const plans = scenePlans(s.id);
    return `<article class="loc-sc" data-scene="${s.id}">
      <header class="loc-sc-head"><button class="loc-sc-title" data-scene-open="${s.id}" title="Показать текст сцены рядом"><b>Сцена ${s.t.n}</b><span>${esc(s.t.text)}</span></button>
        <button class="act" data-scene-open="${s.id}">Текст сцены</button>
        <button class="ico" data-act="unlink" data-scene="${s.id}" title="Отвязать сцену от локации" aria-label="Отвязать сцену">${X}</button></header>
      <div class="loc-sc-body">
        <div><h4>Реквизит этой сцены</h4>${group(s.id)}</div>
        <div><h4>Планы мизансцены</h4>
          <div class="loc-plans loc-drop">${plans.map(bigTile).join('') || '<p class="tile-hint">Перетащите сюда план справа</p>'}</div>
          ${plans.length ? '<p class="tile-hint">Правая кнопка по плану: другая сцена, отвязать или удалить</p>' : ''}
        </div>
      </div></article>`;
  };

  $('#view-location').innerHTML = `<div class="loc">
    <div class="loc-main">
      <div class="lo-names">
        <label><span>Объект</span><input class="proj-name" data-key="object" list="lo-objects" value="${esc(l.object)}" placeholder="Дом, стадион, улица" aria-label="Объект" spellcheck="false"></label>
        <label><span>Подобъект</span><input class="proj-name lo-sub" data-key="sub" value="${esc(l.sub)}" placeholder="Гостиная, кухня — или пусто, если весь объект" aria-label="Подобъект" spellcheck="false"></label>
        <datalist id="lo-objects">${objectsOf(p).filter(o => objKey(o.name) !== objKey(l.object)).map(o => `<option value="${esc(o.name)}">`).join('')}</datalist>
      </div>
      <div class="loc-geo">
        <input type="text" data-key="geo" value="${esc(ogeo)}" placeholder="Адрес объекта или ссылка на карту" aria-label="Адрес объекта или ссылка на карту">
        <a class="act${ogeo ? '' : ' off'}" id="loc-map" href="${ogeo ? esc(mapUrl(ogeo)) : '#'}" target="_blank" rel="noopener">На карте</a>
      </div>
      ${(() => { const n = p.locations.filter(x => x !== l && objKey(x.object) === objKey(l.object)).length; return n ? `<p class="page-hint lo-shared">Адрес и база группы общие для всего объекта «${esc(l.object)}»: ещё ${plural(n, 'подобъект', 'подобъекта', 'подобъектов')}.</p>` : ''; })()}
      <div class="loc-geo lo-base"><input type="text" data-key="base" value="${esc(obase)}" placeholder="База группы, парковка: где встают машины, грим, кейтеринг — общая для объекта" aria-label="База группы, парковка"></div>

      <section class="loc-sec">
        <header class="loc-sec-head"><h2>Фотографии${l.photos.length ? ` <span>${l.photos.length}</span>` : ''}</h2>
          ${l.photos.length > 1 ? '<button class="act" data-act="get-all">Скачать все</button>' : ''}
          <button class="act" data-act="add-photos">Добавить фото</button></header>
        <div class="ph-grid">${l.photos.map((ph, i) => `<button class="ph" data-ph="${ph.id}" title="${esc(ph.name || 'Фото ' + (i + 1))}"><img src="${esc(srcOf(ph.src))}" alt="" loading="lazy"></button>`).join('')}
          <button class="ph ph-add" data-act="add-photos">${PLUS}<span>Перетащите фото сюда или нажмите</span></button></div>
        ${l.photos.length ? '<p class="page-hint">Правая кнопка мыши по фото: скачать, сделать обложкой или удалить.</p>' : ''}
      </section>

      <section class="loc-sec">
        <header class="loc-sec-head"><h2>Реквизит во всех сценах</h2></header>
        <p class="page-hint">Постановочный реквизит, который нужен на этой локации всегда. Что отличается в отдельной сцене, пишите в карточке сцены ниже.</p>
        ${group('')}
      </section>

      <section class="loc-sec">
        <header class="loc-sec-head"><h2>Сцены${linked.length ? ` <span>${linked.length}</span>` : ''}</h2>
          ${free.length ? `<select class="loc-link" data-act="link" aria-label="Привязать сцену"><option value="">Привязать сцену…</option>
            ${free.filter(x => looks(x.s)).map(({ s, i }) => `<option value="${s.id}">★ ${i + 1}. ${esc(s.text)}</option>`).join('')}
            ${free.filter(x => !looks(x.s)).map(({ s, i }) => `<option value="${s.id}">${i + 1}. ${esc(s.text)}</option>`).join('')}</select>` : ''}</header>
        ${linked.map(sceneCard).join('') || `<p class="empty">${scenes.length ? 'Выберите сцены, которые снимаются здесь. Звёздочкой отмечены похожие по названию.' : 'Сцены появятся, когда в сценарии будут строки «Время и место».'}</p>`}
        ${lost.map(sid => group(sid, 'Реквизит сцены, которая больше не привязана')).join('')}
      </section>
    </div>

    <aside class="loc-side">
      <p class="sub">Заметки</p>
      <textarea class="loc-note" data-key="note" rows="5" placeholder="Контакты, доступ, электричество, парковка">${esc(l.note)}</textarea>
      <p class="sub">Интерьер для мизансцен</p>
      ${(() => {
        const b = baseOf(p, l), mine = p.plans.filter(x => hasEnv(x) && locOfPlan(p, x) === l);
        return `${b ? `<div class="loc-base"><span class="thumb">${planSVG({ name: '', objects: b.objects, wallColor: b.wallColor, floorColor: b.floorColor, phases: [] }, { pad: 0.8 })}</span>
          <small>${baseCount(b)} предм. из плана «${esc(b.from || '')}». Новые мизансцены этой локации начинаются с этого интерьера.</small></div>`
          : '<p class="empty">Пока нет: первый план локации со стенами или мебелью станет базой.</p>'}
        ${mine.length ? `<select class="loc-link" data-act="set-base" aria-label="Взять интерьер из плана"><option value="">${b ? 'Заменить базу интерьером плана…' : 'Взять интерьер из плана…'}</option>
          ${mine.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>` : ''}`;
      })()}
      <p class="sub">Планы локации без сцены</p>
      ${otherPlans.length ? `<div class="loc-plans">${otherPlans.map(tile).join('')}</div>` : '<p class="empty">Нет.</p>'}
      ${nobody.length ? `<p class="sub">Планы без сцены и локации</p><div class="loc-plans">${nobody.map(tile).join('')}</div>` : ''}
      ${otherPlans.length || nobody.length ? '<p class="tile-hint">Перетащите план на сцену слева — он привяжется к сцене и к этой локации. Или правая кнопка → «В сцену».</p>' : ''}
      <div class="actions proj-danger"><button class="act danger" data-act="remove">Удалить локацию</button></div>
    </aside>
  </div>`;
}

const view = $('#view-location');
view.addEventListener('input', e => {
  const l = locOf(openId);
  if (!l) return;
  const key = e.target.dataset.key, li = e.target.closest('[data-prop]');
  if (key) {
    l[key] = e.target.value;
    if (key === 'object' || key === 'sub') { l.name = locName(l); $('#crumb').textContent = l.name; }
    if (key === 'base') setObjectBase(project(), l, l.base);
    if (key === 'geo') { setObjectGeo(project(), l, l.geo); const a = $('#loc-map'); a.href = l.geo ? mapUrl(l.geo.trim()) : '#'; a.classList.toggle('off', !l.geo.trim()); }
    store.touch();
  } else if (li && e.target.dataset.k === 'text') {
    const x = l.props.find(q => q.id === li.dataset.prop);
    if (x) { x.text = e.target.value; store.touch(); }
  }
});
view.addEventListener('change', e => {
  const l = locOf(openId);
  if (!l) return;
  if (e.target.dataset.key === 'object' || e.target.dataset.key === 'sub') {
    l.object = l.object.trim(); l.sub = l.sub.trim(); l.name = locName(l);
    // перешли в известный объект — берём его адрес
    if (e.target.dataset.key === 'object') { const same = project().locations.find(x => x !== l && objKey(x.object) === objKey(l.object) && x.geo); if (same) l.geo = same.geo; const sb = project().locations.find(x => x !== l && objKey(x.object) === objKey(l.object) && x.base); if (sb) l.base = sb.base; }
    $('#crumb').textContent = l.name; store.touch(); renderLocation(l.id); // подсказки сцен зависят от названия
  }
  if (e.target.dataset.k === 'ready') {
    const li = e.target.closest('[data-prop]'), x = l.props.find(q => q.id === li.dataset.prop);
    if (x) { x.ready = e.target.checked; li.classList.toggle('ready', x.ready); store.touch(); }
  }
  if (e.target.dataset.act === 'link-plan' && e.target.value) {
    const pl = project().plans.find(x => x.id === e.target.value);
    if (pl) { pl.sceneId = e.target.dataset.scene; pl.locationId = l.id; store.touch(); renderLocation(l.id); toast(`План «${pl.name}» привязан к сцене`); }
    return;
  }
  if (e.target.dataset.act === 'set-base' && e.target.value) {
    const pl = project().plans.find(x => x.id === e.target.value);
    if (pl) { saveBase(l, pl); store.touch(); renderLocation(l.id); toast(`Интерьер плана «${pl.name}» стал базой локации`); }
    return;
  }
  if (e.target.dataset.act === 'link' && e.target.value) { l.sceneIds.push(e.target.value); store.touch(); renderLocation(l.id); }
});
view.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const l = locOf(openId);
  if (!l) return;
  if (e.target.matches('.props-add')) {
    const text = e.target.value.trim();
    if (!text) return;
    const sid = e.target.closest('.props-group').dataset.scene;
    l.props.push({ id: uid(), text, sceneId: sid, ready: false });
    store.touch();
    renderLocation(l.id);
    $(`.props-group[data-scene="${sid}"] .props-add`, view).focus();
  } else if (e.target.dataset.k === 'text') {
    e.target.closest('.props-group').querySelector('.props-add').focus();
  } else if (['object', 'sub', 'geo', 'base'].includes(e.target.dataset.key)) e.target.blur();
});
view.addEventListener('click', async e => {
  const l = locOf(openId);
  if (!l) return;
  const ph = e.target.closest('[data-ph]');
  if (ph) { showPhoto(l, ph.dataset.ph); return; }
  if (e.target.closest('#loc-map.off')) { e.preventDefault(); $('[data-key="geo"]', view).focus(); return; }
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'add-photos') { const files = await pickFile('image/*', true); if (files && files.length) addPhotos(l, files); }
  if (act === 'get-all') { for (let i = 0; i < l.photos.length; i++) { await savePhoto(l, l.photos[i]); await new Promise(r => setTimeout(r, 250)); } }
  if (act === 'take') {
    l.props.push({ id: uid(), text: b.dataset.text, sceneId: b.dataset.scene, ready: false });
    store.touch(); renderLocation(l.id);
  }
  if (act === 'unlink') { l.sceneIds = l.sceneIds.filter(x => x !== b.dataset.scene); store.touch(); renderLocation(l.id); }
  if (act === 'del-prop') {
    const id = b.closest('[data-prop]').dataset.prop, x = l.props.find(q => q.id === id);
    if (x && x.auto) { l.propsSkip = l.propsSkip || []; l.propsSkip.push(x.sceneId + '|' + x.text.toLowerCase()); }
    l.props = l.props.filter(q => q.id !== id); store.touch(); renderLocation(l.id);
  }
  if (act === 'new-plan') {
    const sid = b.dataset.scene || '', t = sid && sceneTitle(project(), sid);
    location.hash = `#/p/${project().id}/plan/${createPlan({ name: t ? `${l.name} (сц. ${t.n})` : l.name, objects: [], locationId: l.id, sceneId: sid })}`;
  }
  if (act === 'remove') {
    if (!confirm(`Удалить локацию «${l.name}» вместе с её фото и списком реквизита?`)) return;
    const p = project();
    p.locations = p.locations.filter(x => x.id !== l.id);
    p.plans.forEach(x => { if (x.locationId === l.id) x.locationId = ''; });
    store.touch();
    replaceHash(`#/p/${p.id}/locations`);
    toast('Локация удалена');
  }
});

// ---------- фото: меню по правой кнопке, скачивание, просмотр ----------

async function savePhoto(l, ph) {
  try {
    const blob = await (await fetch(srcOf(ph.src))).blob();
    const n = l.photos.indexOf(ph) + 1;
    download(blob, safeName(`${l.name} ${ph.name && !/^(IMG|DSC|PXL|photo|image)[_-]?\d/i.test(ph.name) ? ph.name : n}`) + '.jpg');
  } catch { toast('Не получилось скачать фото'); }
}

function removePhoto(l, ph) {
  if (!confirm('Удалить это фото из локации?')) return false;
  l.photos = l.photos.filter(x => x.id !== ph.id);
  store.touch();
  renderLocation(l.id);
  return true;
}

// Реквизит из разбора сцены сам попадает в реквизит этой сцены на локации (кроме убранного вручную)
function syncProps(p, l, linked) {
  const info = sceneInfo(p), skip = new Set(l.propsSkip || []);
  let added = 0;
  for (const s of linked) {
    const have = new Set(l.props.filter(x => x.sceneId === s.id || x.sceneId === '').map(x => x.text.toLowerCase()));
    for (const t of sceneItems(p, s.id, info, false).props) {
      const k = t.toLowerCase();
      if (have.has(k) || skip.has(s.id + '|' + k)) continue;
      l.props.push({ id: uid(), text: t, sceneId: s.id, ready: false, auto: true });
      have.add(k); added++;
    }
  }
  if (added) store.touch();
}

// планы перетаскиваются мышью на карточку сцены
const unhot = () => { for (const x of view.querySelectorAll('.drop-hot')) x.classList.remove('drop-hot'); };
const sceneAt = (x, y) => { const el = document.elementFromPoint(x, y); return el && el.closest('.loc-sc[data-scene]'); };
pointerDrag(view, {
  pick(e) { const t = e.target.closest('.plan-tile[data-plan-open]'); return t ? { el: t, data: t.dataset.planOpen } : null; },
  move(id, x, y) { unhot(); const c = sceneAt(x, y); if (c) c.classList.add('drop-hot'); },
  drop(id, x, y) {
    const c = sceneAt(x, y), p = project(), pl = p.plans.find(q => q.id === id);
    if (!c || !pl || pl.sceneId === c.dataset.scene && pl.locationId === openId) return;
    bindPlan(p, pl, c.dataset.scene, openId);
    store.touch(); toast(`План «${pl.name}» — в сцене ${(sceneTitle(p, c.dataset.scene) || {}).n}`);
  },
  end() { unhot(); renderLocation(openId); },
  scroller: () => view,
});

const ctx = $('#ctx');
view.addEventListener('contextmenu', e => {
  const b = e.target.closest('[data-ph]');
  if (!b) return;
  e.preventDefault();
  const l = locOf(openId), i = l.photos.findIndex(x => x.id === b.dataset.ph);
  ctx.dataset.kind = 'photo';
  ctx.dataset.ph = b.dataset.ph;
  ctx.innerHTML = `<h2>Фото ${i + 1}</h2><div class="menu">
    <button data-menu="open">Открыть</button><button data-menu="save">Скачать</button>
    ${i > 0 ? '<button data-menu="cover">Сделать обложкой<small>первым в списке и на карточке</small></button>' : ''}
    <button data-menu="del">Удалить</button></div>`;
  ctx.classList.add('on');
  ctx.style.left = Math.min(e.clientX + 6, innerWidth - ctx.offsetWidth - 8) + 'px';
  ctx.style.top = Math.min(e.clientY + 6, innerHeight - ctx.offsetHeight - 8) + 'px';
});
ctx.addEventListener('click', e => {
  const b = e.target.closest('[data-menu]');
  if (!b || ctx.dataset.kind !== 'photo') return;
  ctx.classList.remove('on');
  const l = locOf(openId), ph = l && l.photos.find(x => x.id === ctx.dataset.ph);
  if (!ph) return;
  const act = b.dataset.menu;
  if (act === 'open') showPhoto(l, ph.id);
  if (act === 'save') savePhoto(l, ph);
  if (act === 'del') removePhoto(l, ph);
  if (act === 'cover') { l.photos = [ph, ...l.photos.filter(x => x !== ph)]; store.touch(); renderLocation(l.id); toast('Это фото теперь на карточке локации'); }
});
// меню закрывается кликом мимо и клавишей Escape (на плане это делает сам Shot Designer)
document.addEventListener('pointerdown', e => { if (ctx.dataset.kind === 'photo' && ctx.classList.contains('on') && !ctx.contains(e.target)) ctx.classList.remove('on'); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape' && ctx.dataset.kind === 'photo') ctx.classList.remove('on'); });

// просмотр фото — в окошке справа: листается стрелками, закрывается крестиком или Escape
export function showPhoto(l, id) { import('./split.js').then(m => m.openPhoto('loc', l.id, id)); }
// прежний просмотр на весь экран (оставлен для совместимости)
export function showPhotoFull(l, id) {
  let i = Math.max(0, l.photos.findIndex(x => x.id === id));
  const d = document.createElement('dialog');
  d.className = 'lightbox';
  const draw = () => {
    const ph = l.photos[i];
    d.innerHTML = `<img src="${esc(srcOf(ph.src))}" alt="">
      <div class="lb-bar"><span>${esc(l.name)} · ${i + 1} из ${l.photos.length}</span>
        <button class="act" data-lb="save">Скачать</button><button class="act" data-lb="close">Закрыть</button></div>
      ${l.photos.length > 1 ? `<button class="lb-nav prev" data-lb="prev" aria-label="Предыдущее"><svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg></button>
        <button class="lb-nav next" data-lb="next" aria-label="Следующее"><svg viewBox="0 0 24 24"><path d="M10 6l6 6-6 6"/></svg></button>` : ''}`;
  };
  const step = k => { i = (i + k + l.photos.length) % l.photos.length; draw(); };
  draw();
  d.addEventListener('click', e => {
    const b = e.target.closest('[data-lb]');
    if (!b) { if (e.target === d) d.close(); return; }
    if (b.dataset.lb === 'close') d.close();
    if (b.dataset.lb === 'save') savePhoto(l, l.photos[i]);
    if (b.dataset.lb === 'prev') step(-1);
    if (b.dataset.lb === 'next') step(1);
  });
  d.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); });
  d.addEventListener('close', () => { d.classList.add('out'); setTimeout(() => d.remove(), 200); });
  document.body.append(d);
  d.showModal();
}

// ---------- исправить предмет: щелчок по ячейке ----------
// Исправленное название уходит и в разбор сцены (для общего реквизита локации — во все её сцены).
function renameProp(p, l, x, text) {
  const old = x.text.trim().toLowerCase();
  x.text = text;
  const scenes = x.sceneId ? [x.sceneId] : l.sceneIds;
  for (const it of p.breakdown || []) if (scenes.includes(it.sceneId) && it.text.trim().toLowerCase() === old) { it.text = text; it.auto = false; }
  // убранное раньше под старым именем больше не мешает
  if (l.propsSkip) l.propsSkip = l.propsSkip.filter(k => !scenes.some(sid => k === sid + '|' + old));
}
view.addEventListener('click', e => {
  const t = e.target.closest('[data-lp-edit]');
  if (!t || t.querySelector('input')) return;
  const l = locOf(openId), chipEl = t.closest('[data-prop]'), x = l && l.props.find(q => q.id === chipEl.dataset.prop);
  if (!x) return;
  const inp = document.createElement('input');
  inp.className = 'lp-edit'; inp.value = x.text; inp.setAttribute('aria-label', 'Предмет');
  inp.style.width = Math.max(80, t.offsetWidth + 24) + 'px';
  t.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = save => {
    if (done) return; done = true;
    const v = inp.value.trim(), p = project();
    if (save && v && v !== x.text) {
      renameProp(p, l, x, v); store.touch();
      toast('Исправлено и в разборе сцены');
    }
    renderLocation(l.id);
  };
  inp.addEventListener('keydown', k => { if (k.key === 'Enter') { k.preventDefault(); finish(true); } if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); finish(false); } });
  inp.addEventListener('blur', () => finish(true));
});
