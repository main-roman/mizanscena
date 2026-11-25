// Раздел «Кадры». Первый экран — список сцен; в сцене — всё для съёмки: где и когда (из КПП и вызывного),
// солнце (восход, закат, режим и где оно стоит во время съёмки), свет из плана сцены, общий план мизансцены
// и раскадровка: у каждого кадра картинка, свой план с камерой, техника, что происходит в кадре и примечание.
// Кадры — те же, что в режиссёрском сценарии: порядок, картинки и тексты общие.
import { store, $, uid, esc, toast, storeImage, pickFile, scenesOf, numbering, shotAuto, SIZES, MOVES, framesOf, setFrames, addFrameFiles } from './store.js';
import { sunMapHTML, bindSunMaps } from './sunmap.js';
import { srcOf } from './storage.js';
import { planSVG, atPhase, caption, LIGHTS } from './shapes.js';
import { createPlan } from './plan.js';
import { bindPlan } from './interior.js';
import { sceneInfo } from './breakdown.js';
import { dayInfo, objectOf, shiftNo, timeline } from './schedmodel.js';
import { coordsOf, sunDay, sunAt, sideOf } from './sun.js';
import { pointerDrag, stackGhost } from './dragsort.js';
import { registerKind, openKind, openPhoto, closeSplit, refreshSplit, splitKind, splitRef } from './split.js';
import { seconds, clock } from './director.js';

const project = () => store.project;
const view = $('#view-plans');
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const PIC_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 10l8 4M16 10l-8 4" stroke="currentColor" stroke-width="1.8"/></svg>';
const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>';
let openScene = '', hover = '', misePick = '';
const title = t => t ? t.charAt(0) + t.slice(1).toLowerCase() : '';
const dateText = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }); };
const mapUrl = geo => /^https?:\/\//i.test(geo) ? geo : `https://yandex.ru/maps/?text=${encodeURIComponent(geo)}`;

// где и когда снимается сцена: первый день КПП с ней, время по плану дня
function shootOf(p, s, info) {
  const day = p.schedule.days.find(d => d.items.some(x => x.sceneId === s.id));
  if (!day) return null;
  const row = timeline(p, day, info).find(r => r.scene && r.scene.id === s.id);
  return { day, start: row ? row.start : '', end: row ? row.end : '', coords: dayInfo(p, day, info).coords };
}
// координаты объекта: из адреса любой его комнаты
function coordsOfScene(p, s) {
  const o = objectOf(p, s), key = String(o.name).toUpperCase();
  for (const l of p.locations.filter(l => String(l.object || '').toUpperCase() === key)) { const c = coordsOf(l.geo); if (c) return c; }
  return null;
}
// свет из планов сцены: «Солнце в окно (солнце) ×1, Заполняющий (софтбокс)»
function lightsOf(p, plans) {
  const count = new Map();
  for (const pl of plans) for (const o of pl.objects.filter(o => o.type === 'light' && !o.off)) {
    const kind = (LIGHTS[o.kind] || {}).name || 'Свет', name = o.label ? `${o.label} (${kind.toLowerCase()})` : kind;
    count.set(name, (count.get(name) || 0) + 1);
  }
  return [...count].map(([n, k]) => k > 1 ? `${n} ×${k}` : n);
}

export function renderFrames(sceneId = '') {
  openScene = sceneId;
  const y = view.scrollTop;
  const p = project(), info = sceneInfo(p), ids = new Set(info.map(x => x.id));
  const n = p.shots.filter(x => !ids.has(x.sceneId)).length + p.plans.filter(x => !ids.has(x.sceneId)).length;
  // как правая панель в мизансцене: закрыта — видна только кнопка-значок; щелчок — панель выезжает
  const btn = `<button class="chipbtn side-btn fr-stash-btn" data-act="stash-toggle" aria-pressed="${stashOpen}" title="${stashOpen ? 'Свернуть «Без сцены»' : 'Без сцены: раскадровки и мизансцены'}" aria-label="Без сцены"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>${n && !stashOpen ? `<i>${n}</i>` : ''}</button>`;
  const drawer = btn + (stashOpen ? `<div class="fr-drawer-in"><header class="fr-drawer-head"><b>Без сцены</b></header>${stashHTML(p, info, sceneId && sceneId !== 'none' ? sceneId : '')}</div>` : '');
  view.innerHTML = `<div class="fr-wrap${stashOpen ? ' stash-on' : ''}"><div class="fr-col">${sceneId ? scenePage(sceneId) : listPage()}</div><aside class="fr-drawer">${drawer}</aside></div>`;
  if (sceneId) for (const t of view.querySelectorAll('textarea.fr-auto')) grow(t);
  bindSunMaps(view);
  view.scrollTop = y;
}
const grow = t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; };

// ---------- список сцен ----------
function listPage() {
  const p = project(), base = `#/p/${p.id}`, info = sceneInfo(p);
  const row = s => {
    const shots = p.shots.filter(x => x.sceneId === s.id), plans = p.plans.filter(x => x.sceneId === s.id), pics = shots.filter(x => x.frame);
    const o = objectOf(p, s), sh = shootOf(p, s, info);
    return `<tr data-go="${base}/plans/${s.id}" data-drop-scene="${s.id}">
      <td class="sl-n"><a href="${base}/plans/${s.id}">${s.n}</a></td>
      <td><span class="ie ie-${s.ie === 'НАТ' ? 'ext' : s.ie === 'ИНТ' ? 'int' : 'mix'}">${esc(s.ie || '—')}</span></td>
      <td class="sl-place"><a href="${base}/plans/${s.id}">${esc(o.name || s.place || s.text)}</a>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</td>
      <td>${esc(title(s.time))}</td>
      <td class="fr-strip">${pics.slice(0, 5).map(x => `<img src="${esc(srcOf(x.frame))}" alt="" loading="lazy">`).join('')}${pics.length > 5 ? `<i>+${pics.length - 5}</i>` : ''}</td>
      <td class="num">${shots.length || ''}</td>
      <td class="num">${plans.length || ''}</td>
      <td class="fr-when">${sh ? `${sh.day.kind === 'work' ? `Смена ${shiftNo(p, sh.day)}` : 'День'}${sh.day.date ? ` · ${dateText(sh.day.date)}` : ''}` : ''}</td></tr>`;
  };
  return `<div class="page page-wide">
    <header class="page-head"><h1>Кадры</h1><a class="act" href="${base}/director">Режиссёрский сценарий</a></header>
    <p class="page-hint">Щёлкните по сцене — откроется её раскадровка, план, солнце и свет. Раскадровки и мизансцены без сцены лежат внизу: перетащите их на строку сцены.</p>
    ${info.length ? `<div class="sl-wrap"><table class="sl fr-list"><thead><tr><th>№</th><th>Инт/Нат</th><th>Место</th><th>Время</th><th>Раскадровка</th><th>Кадров</th><th>Планов</th><th>Съёмка</th></tr></thead>
      <tbody>${info.map(row).join('')}</tbody></table></div>` : '<p class="empty">Сцены появятся, когда в сценарии будут строки «Время и место».</p>'}
    </div>`;
}
function oldListPage() {
  const p = project(), base = `#/p/${p.id}`, info = sceneInfo(p), ids = new Set(info.map(s => s.id));
  const card = s => {
    const shots = p.shots.filter(x => x.sceneId === s.id), plans = p.plans.filter(x => x.sceneId === s.id), pics = shots.filter(x => x.frame);
    const o = objectOf(p, s), sh = shootOf(p, s, info);
    const strip = pics.length ? pics.slice(0, 4).map(x => `<img src="${esc(srcOf(x.frame))}" alt="" loading="lazy">`).join('') : plans.length ? `<span class="fr-sc-plan">${planSVG(plans[0], { pad: 0.8 })}</span>` : '<span class="fr-sc-empty">Раскадровки пока нет</span>';
    return `<a class="fr-sc" href="${base}/plans/${s.id}">
      <span class="fr-sc-strip${pics.length ? ' n' + Math.min(4, pics.length) : ''}">${strip}</span>
      <span class="fr-sc-title"><b>${s.n}</b>${esc(o.name || s.place || s.text)}${o.sub ? `<i>${esc(o.sub)}</i>` : ''}</span>
      <span class="fr-sc-meta">${[s.ie && title(s.ie), s.time && title(s.time), shots.length ? `${shots.length} кадр.` : 'кадров нет', pics.length ? `${pics.length} карт.` : '', plans.length ? `${plans.length} пл.` : ''].filter(Boolean).join(' · ')}</span>
      ${sh ? `<span class="fr-sc-day">${sh.day.kind === 'work' ? `Смена ${shiftNo(p, sh.day)}` : ''}${sh.day.date ? ` · ${dateText(sh.day.date)}` : ''}${sh.start ? ` · ${sh.start}` : ''}</span>` : ''}</a>`;
  };
  const loose = p.shots.filter(x => !ids.has(x.sceneId)).length + p.plans.filter(x => !ids.has(x.sceneId)).length;
  return `<div class="page page-wide">
    <header class="page-head"><h1>Кадры</h1><a class="act" href="${base}/director">Режиссёрский сценарий</a></header>
    <p class="page-hint">Выберите сцену: в ней раскадровка — у каждого кадра картинка, план с камерой, техника и что происходит; сверху — где и когда снимаем, солнце и свет.</p>
    <div class="fr-scs">${info.map(card).join('')}${loose ? `<a class="fr-sc" href="${base}/plans/none"><span class="fr-sc-strip"><span class="fr-sc-empty">${loose} без сцены</span></span><span class="fr-sc-title">Без сцены</span></a>` : ''}</div></div>`;
}

// ---------- сцена: сведения, общий план, раскадровка ----------
function scenePage(sceneId) {
  const p = project(), base = `#/p/${p.id}`, info = sceneInfo(p), nums = numbering(p);
  const s = info.find(x => x.id === sceneId), i = s ? info.indexOf(s) : -1;
  const shots = p.shots.filter(x => s ? x.sceneId === s.id : !info.some(q => q.id === x.sceneId));
  const plans = p.plans.filter(x => s ? x.sceneId === s.id : !info.some(q => q.id === x.sceneId));
  const nav = `<a class="ico" ${i > 0 ? `href="${base}/plans/${info[i - 1].id}"` : 'aria-disabled="true"'} title="Предыдущая сцена" aria-label="Предыдущая сцена"><svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg></a>
    <a class="ico" ${i >= 0 && i < info.length - 1 ? `href="${base}/plans/${info[i + 1].id}"` : 'aria-disabled="true"'} title="Следующая сцена" aria-label="Следующая сцена"><svg viewBox="0 0 24 24"><path d="M10 6l6 6-6 6"/></svg></a>`;

  // сведения о сцене
  let facts = '';
  if (s) {
    const o = objectOf(p, s), sh = shootOf(p, s, info), c = (sh && sh.coords) || coordsOfScene(p, s);
    const loc = o.loc, objLocs = p.locations.filter(l => String(l.object || '').toUpperCase() === String(o.name).toUpperCase());
    const geo = (objLocs.find(l => l.geo) || {}).geo || '';
    const date = sh && sh.day.date, sun = date && c ? sunDay(date, c) : null;
    const lights = lightsOf(p, plans), light = (p.sceneLight || {})[s.id];
    const cell = (label, value, cls = '') => value ? `<div class="fr-fact${cls ? ' ' + cls : ''}"><span>${label}</span>${value}</div>` : '';
    const lightItems = lightList(p, s);
    const showMap = !!(loc && sun && c);
    facts = `<div class="fr-top${showMap ? '' : ' nomap'}"><div class="fr-facts">
      ${loc ? `<button class="fr-fact fr-fact-btn" data-loc-open="${loc.id}" title="Открыть локацию рядом: фото, адрес, реквизит"><span>Объект</span><b>${esc(o.name || s.place)}${o.sub ? ` · ${esc(o.sub)}` : ''}</b>${geo ? `<small>${/^https?:/i.test(geo) ? 'метка на карте' : esc(geo)}</small>` : ''}</button>`
        : cell('Объект', `<b>${esc(o.name || s.place)}${o.sub ? ` · ${esc(o.sub)}` : ''}</b><small>локации нет</small>`)}
      ${cell('Режим', [s.ie && title(s.ie), s.time && title(s.time), s.dur && `хрон ${s.dur}`].filter(Boolean).join(' · '))}
      ${cell('Съёмка', sh ? `<b>${sh.day.kind === 'work' ? `Смена ${shiftNo(p, sh.day)}` : 'День'}${date ? ` · ${dateText(date)}` : ''}</b>${sh.start ? `${sh.start}–${sh.end} по плану дня` : ''}<a href="${base}/call/${sh.day.id}">вызывной</a>` : '<small>не стоит в КПП</small>')}
      ${cell('Солнце', sun ? `<em class="fr-inline">восход <b class="fr-inline">${sun.sunrise}</b> · закат <b class="fr-inline">${sun.sunset}</b></em><small>режим: до ${sun.goldMorning} и после ${sun.goldEvening}</small>` : date ? '<small>впишите адрес объекта — посчитаю</small>' : '<small>появится, когда сцена встанет в КПП с датой</small>')}

      ${s.chars.length ? `<div class="fr-fact fr-chars"><span>Персонажи</span><div class="fr-lchips">${s.chars.map(c => `<span class="fr-cchip">${esc(title(c))}</span>`).join('')}</div></div>` : ''}
      <div class="fr-fact fr-light"><span>Свет на сцену</span><div class="fr-lchips">${lightItems.map((t, k) => `<span class="fr-lchip">${esc(t)}<button data-light-x="${k}" title="Убрать" aria-label="Убрать">×</button></span>`).join('')}
        <input class="fr-ladd" data-light-add="${s.id}" list="fr-lights" placeholder="+ прибор" aria-label="Добавить прибор"></div>
        <datalist id="fr-lights">${Object.values(LIGHTS).map(k => `<option value="${esc(k.name)}">`).join('')}</datalist></div>
    </div>
    ${showMap ? `<div class="fr-fact fr-sunmap-cell"><span>Солнце во время съёмки</span>${sunMapHTML({ date, c, from: sh.day.call || sh.start || sun.sunrise, to: sh.day.stop || sun.sunset, at: sh.start || sh.day.call || '' })}</div>` : ''}
    </div>`;
  }

  const planTile = x => `<div class="plan-tile"><a href="${base}/plan/${x.id}"><span class="thumb">${planSVG(x, { pad: 0.8 })}</span><span class="tile-name">${esc(x.name)}</span></a></div>`;
  // карточка кадра в просмотре: только смотреть и переставлять; править — в настройке справа
  const shotCard = sh => {
    const a = shotAuto(p, sh), mise = a.plan ? planSVG(atPhase(a.plan, sh.phaseId), { cameraId: sh.cameraId || null, pad: 0.6 }) : '';
    const fl = framesOf(sh), seq = fl.slice(0, 4);
    const big = fl.length ? `<div class="fr-pic${fl.length > 1 ? ' fr-seq n' + seq.length : ''}" title="${fl.length > 1 ? `Раскадровка из ${fl.length} картинок — щёлкните, чтобы открыть крупно` : 'Открыть раскадровку крупно'}">${seq.map((f, k) => `<button class="fr-seq-i" data-act="view-frame" data-k="${k}"><img src="${esc(srcOf(f))}" alt="Кадр ${nums.get(sh.id)}${fl.length > 1 ? ', ' + (k + 1) : ''}"></button>`).join('')}${fl.length > 4 ? `<i class="fr-seq-more">+${fl.length - 4}</i>` : ''}${fl.length > 1 ? `<b class="fr-seq-n">${fl.length}</b>` : ''}</div>`
      : mise ? `<button class="fr-pic fr-pic-mise" data-act="view-mise" title="Открыть мизансцену крупно">${mise}</button>` : '';
    const tech = [sh.size, sh.move].filter(Boolean).map(esc), lens = a.lens;
    return `<article class="fr-shot${sh.id === editing() ? ' editing' : ''}${big ? '' : ' nopic'}" data-shot="${sh.id}" title="Перетащите сюда картинку, чтобы она стала раскадровкой">
      <div class="fr-cardhead"><b>${nums.get(sh.id)}</b><button class="fr-editbtn" data-act="edit" title="Настроить кадр: раскадровка, мизансцена, техника, текст">${PEN}Настроить</button></div>
      ${big}
      ${(sh.frame && mise) || tech.length || lens ? `<div class="fr-mid${sh.frame && mise ? '' : ' solo'}">
        ${sh.frame && mise ? `<button class="fr-mise" data-act="view-mise" title="Открыть мизансцену крупно">${mise}</button>` : ''}
        <div class="fr-tech-view">${tech.length ? `<b>${tech[0]}</b>${tech[1] ? `<span>${tech[1]}</span>` : ''}` : ''}${lens ? `<small>${esc(lens)}</small>` : ''}</div>
      </div>` : ''}
      <div class="fr-act-view"><div class="fr-acthead"><span>В кадре</span>${sh.dur ? `<b class="fr-dur-view">${esc(sh.dur)}</b>` : ''}</div>
        <p>${sh.content ? esc(sh.content).replace(/\n/g, '<br>') : '<i>Что происходит в кадре — в настройке</i>'}</p>
        ${sh.note ? `<p class="fr-note-view">${esc(sh.note).replace(/\n/g, '<br>')}</p>` : ''}</div>
    </article>`;
  };
  return `<div class="page page-wide fr-page" data-scene="${s ? s.id : ''}"><div class="fr-main">
    <header class="page-head fr-scenehead"><a class="linkbtn fr-back" href="${base}/plans">← Все сцены</a>${nav}
      <h1>${s ? `<button class="fr-title" data-scene-open="${s.id}" title="Открыть текст и разбор сцены рядом"><b>${s.n}</b> ${esc(s.text)}</button>` : 'Кадры без сцены'}</h1>
      <a class="act" href="${base}/director">Режиссёрский</a></header>
    ${facts}
    <section class="fr-sec" data-drop-scene="${s ? s.id : ''}"><h2>Общий план сцены</h2>
      <div class="plan-row">${plans.map(planTile).join('')}<button class="plan-tile plan-new" data-act="new-plan"><span class="thumb">${PLUS}</span><span class="tile-name">Новый план</span></button></div></section>
    <section class="fr-sec" data-drop-scene="${s ? s.id : ''}"><h2>Раскадровка <span>${shots.length || ''}</span></h2>
      <p class="page-hint">Карточки перетаскиваются — порядок меняется и в режиссёрском сценарии. Картинки из папки можно бросить на карточку — они добавятся к её раскадровке (панорама в несколько кадриков), — или сюда, тогда каждая станет новым кадром. Раскадровка и мизансцена открываются крупно справа; править кадр — «Настроить».</p>
      <div class="fr-shots">${shots.map(shotCard).join('')}<button class="fr-shot fr-addcard" data-act="add-shot"><span>${PLUS}Кадр</span></button></div></section>
    </div>

  </div>`;
}

// свет на сцену — список приборов; пока его не трогали, берётся из планов сцены
// Список = то, что вписали руками, плюс приборы из планов сцены и из мизансцен её кадров,
// которых ещё нет в списке (кроме убранных крестиком). Новый свет в кадре появляется здесь сам.
const lightKey = t => String(t).replace(/\s*×\d+$/, '').trim().toLowerCase();
function lightList(p, s) {
  const ids = new Set([...p.plans.filter(x => x.sceneId === s.id).map(x => x.id), ...p.shots.filter(x => x.sceneId === s.id && x.planId).map(x => x.planId)]);
  const auto = lightsOf(p, p.plans.filter(x => ids.has(x.id)));
  const v = (p.sceneLight || {})[s.id], off = new Set(((p.sceneLightOff || {})[s.id] || []).map(lightKey));
  const mine = v == null ? [] : String(v).split(/\n/).map(t => t.trim()).filter(Boolean), have = new Set(mine.map(lightKey));
  return [...mine, ...auto.filter(t => !have.has(lightKey(t)) && !off.has(lightKey(t)))];
}
function setLights(sceneId, list) {
  const p = project();
  p.sceneLight = p.sceneLight || {};
  p.sceneLight[sceneId] = list.join('\n');
  store.touch(); renderFrames(openScene);
}

// Без сцены: раскадровки (кадры без сцены) и мизансцены (планы без сцены). Перетаскиваются на сцену.
function stashHTML(p, info, sceneId) {
  const ids = new Set(info.map(s => s.id));
  const shots = p.shots.filter(x => !ids.has(x.sceneId)), plans = p.plans.filter(x => !ids.has(x.sceneId));
  const mark = k => picked.has(k) ? ' sel' : '', tick = '';
  const shotTile = x => `<button class="stash-item${mark('shot:' + x.id)}" data-stash-shot="${x.id}" title="${x.frame ? 'Перетащите на сцену или на карточку. Щелчок — открыть крупно, Shift или Ctrl+щелчок — добавить к выбору' : 'Перетащите на сцену'}">${tick}${x.frame ? `<img src="${esc(srcOf(x.frame))}" alt="" loading="lazy">` : `<span>${esc(x.content || 'Кадр без картинки')}</span>`}</button>`;
  const planTile = x => `<button class="stash-item stash-plan${mark('plan:' + x.id)}" data-stash-plan="${x.id}" data-plan-open="${x.id}" title="Перетащите на сцену или на карточку. Щелчок — открыть рядом, Shift или Ctrl+щелчок — добавить к выбору">${tick}${planSVG(x, { pad: 0.6 })}<i>${esc(x.name)}</i></button>`;
  return `<section class="fr-sec fr-stash"><h2>Без сцены</h2>
    <p class="page-hint">${sceneId ? 'Перетащите в сцену или на карточку' : 'Перетащите на строку сцены'}. Несколько — обведите рамкой с пустого места (с Shift — добавить к выбору) или щёлкайте с Shift и тащите вместе.${picked.size ? ` <button class="linkbtn" data-act="stash-clear">Снять выбор (${picked.size})</button>` : ''}</p>
    <div class="stash-cols">
      <div class="stash" data-stash="shots"><h3>Раскадровки <span>${shots.length || ''}</span></h3>
        <div class="stash-grid">${shots.map(shotTile).join('')}<button class="stash-add" data-act="stash-pics">${PLUS}<span>Картинки — выбрать или перетащить сюда</span></button></div>
        ${shots.length > 1 ? '<button class="linkbtn stash-all" data-act="stash-all" data-kind="shot">Выбрать все</button>' : ''}</div>
      <div class="stash" data-stash="plans"><h3>Мизансцены <span>${plans.length || ''}</span></h3>
        <div class="stash-grid">${plans.map(planTile).join('') || '<p class="empty">Все планы привязаны к сценам.</p>'}</div>
        ${plans.length > 1 ? '<button class="linkbtn stash-all" data-act="stash-all" data-kind="plan">Выбрать все</button>' : ''}</div>
    </div></section>`;
}

// положить кадр или план в сцену; план заодно получает локацию сцены
function attach(kind, id, sceneId, quiet = false) {
  const p = project(), n = (sceneInfo(p).find(s => s.id === sceneId) || {}).n;
  if (kind === 'plan') {
    const pl = p.plans.find(x => x.id === id);
    if (!pl) return;
    bindPlan(p, pl, sceneId);
    if (!quiet) toast(`Мизансцена «${pl.name}» — в сцене ${n}`);
  } else {
    const s = p.shots.find(x => x.id === id);
    if (!s) return;
    p.shots.splice(p.shots.indexOf(s), 1);
    s.sceneId = sceneId;
    const mates = p.shots.filter(x => x.sceneId === sceneId);
    p.shots.splice(mates.length ? p.shots.indexOf(mates[mates.length - 1]) + 1 : p.shots.length, 0, s);
    if (!quiet) toast(`Раскадровка — кадр сцены ${n}`);
  }
  store.touch();
}
const isPic = f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif|heic|tiff?)$/i.test(f.name || '');
// картинки из папки: в стэш (sceneId = '') или сразу кадрами в конец сцены
async function addPics(files, sceneId = '') {
  const list = [...files].filter(isPic);
  if (!list.length) return toast('Это не картинки');
  toast(list.length > 1 ? `Сжимаю картинки: ${list.length}…` : 'Сжимаю картинку…');
  let ok = 0;
  for (const f of list) {
    try {
      const { src } = await storeImage(f, 1600);
      // проект берём заново: пока картинка сохранялась, он мог обновиться из облака или с диска
      const p = project(), shot = { id: uid(), sceneId, planId: '', cameraId: '', phaseId: '', size: '', move: '', content: '', note: '', mode: '', dur: '', chars: '', props: '', tech: '', frame: src };
      const mates = sceneId ? p.shots.filter(x => x.sceneId === sceneId) : [];
      p.shots.splice(mates.length ? p.shots.indexOf(mates[mates.length - 1]) + 1 : p.shots.length, 0, shot);
      ok++;
    } catch (err) { console.error('Раскадровка не добавилась', f.name, err); }
  }
  if (ok) store.touch();
  renderFrames(openScene);
  const n = sceneId ? (sceneInfo(project()).find(x => x.id === sceneId) || {}).n : 0;
  toast(!ok ? 'Картинку не получилось открыть — попробуйте JPG или PNG' : `${sceneId ? `Сцена ${n}: новых кадров` : 'Раскадровок без сцены'} +${ok}${ok < list.length ? ` (не открылось: ${list.length - ok})` : ''}`);
}
const addLoose = files => addPics(files, '');
let picked = new Set(); // выбранное в стэше: 'shot:id', 'plan:id'
// панель «Без сцены» справа: выезжает по кнопке, положение запоминается
let stashOpen = (() => { try { return localStorage.getItem('miz:stash-open') === '1'; } catch { return false; } })();

const miseLabel = (a, sh) => { const ph = a.plan && sh.phaseId ? (a.plan.phases || []).find(x => x.id === sh.phaseId) : null; return [a.camera ? a.camera.name : '', ph ? ph.name : ''].filter(Boolean).join(' · ') || a.plan.name; };
const editing = () => splitKind() === 'shot' ? splitRef() : '';
const refresh = () => { if (document.body.dataset.view === 'plans' && openScene) renderFrames(openScene); };

// ---------- просмотр: щелчки по карточкам ----------
const shotOf = el => { const c = el.closest('[data-shot]'); return c && project().shots.find(s => s.id === c.dataset.shot); };
view.addEventListener('click', e => {
  const lx = e.target.closest('[data-light-x]');
  if (lx) {
    const p = project(), sid = openScene, s = sceneInfo(p).find(q => q.id === sid), list = lightList(p, s), [gone] = list.splice(+lx.dataset.lightX, 1);
    // убранный прибор из плана больше не подставляется
    p.sceneLightOff = p.sceneLightOff || {};
    p.sceneLightOff[sid] = [...new Set([...(p.sceneLightOff[sid] || []), lightKey(gone)])];
    setLights(sid, list); return;
  }
  const si = e.target.closest('.stash-item');
  if (si && (e.ctrlKey || e.metaKey || e.shiftKey)) {
    e.preventDefault(); e.stopPropagation();
    const k = si.dataset.stashPlan ? 'plan:' + si.dataset.stashPlan : 'shot:' + si.dataset.stashShot;
    if (picked.has(k)) picked.delete(k); else picked.add(k);
    renderFrames(openScene); return;
  }
  const st = e.target.closest('[data-stash-shot]');
  if (st) { const s = project().shots.find(x => x.id === st.dataset.stashShot); if (s && s.frame) openPhoto('shot', s.id); else if (s) openKind('shot', s.id); return; }
  const tr = e.target.closest('tr[data-go]');
  if (tr && !e.target.closest('a, button')) { location.hash = tr.dataset.go; return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const p = project(), act = b.dataset.act, sceneId = openScene && openScene !== 'none' ? openScene : '';
  if (act === 'new-plan') {
    const n = scenesOf(p).findIndex(s => s.id === sceneId) + 1;
    location.hash = `#/p/${p.id}/plan/${createPlan(sceneId ? { name: `Сцена ${n}`, objects: [], sceneId } : undefined)}`;
    return;
  }
  if (act === 'stash-toggle') { stashOpen = !stashOpen; try { localStorage.setItem('miz:stash-open', stashOpen ? '1' : '0'); } catch { /* не страшно */ } renderFrames(openScene); return; }
  if (act === 'stash-clear') { picked.clear(); renderFrames(openScene); return; }
  if (act === 'stash-all') { for (const x of view.querySelectorAll(b.dataset.kind === 'plan' ? '[data-stash-plan]' : '[data-stash-shot]')) picked.add(b.dataset.kind + ':' + (x.dataset.stashPlan || x.dataset.stashShot)); renderFrames(openScene); return; }
  if (act === 'stash-pics') { pickFile('image/*', true).then(f => f && f.length && addLoose(f)); return; }
  if (act === 'add-shot') {
    // мизансцена не подключается сама — её выбирают в настройке кадра
    const shot = { id: uid(), sceneId, planId: '', cameraId: '', phaseId: '', size: '', move: '', content: '', note: '', mode: '', dur: '', chars: '', props: '', tech: '', frame: '' };
    const mates = p.shots.filter(x => x.sceneId === sceneId);
    p.shots.splice(mates.length ? p.shots.indexOf(mates[mates.length - 1]) + 1 : p.shots.length, 0, shot);
    store.touch(); openKind('shot', shot.id); renderFrames(openScene);
    return;
  }
  const s = shotOf(b);
  if (!s) return;
  if (act === 'edit') { e.stopPropagation(); openKind('shot', s.id); refresh(); }
  if (act === 'view-frame') openPhoto('shot', s.id, b.dataset.k || '0');
  if (act === 'view-mise') openKind('mise', s.id);
});

// кадры перетаскиваются за любое место карточки (кроме кнопок); порядок общий с режиссёрским сценарием
const unmark = () => { for (const c of ['drop-before', 'drop-after']) for (const x of view.querySelectorAll('.' + c)) x.classList.remove(c); };
const spot = (x, y) => {
  const cards = [...view.querySelectorAll('.fr-shot[data-shot]:not(.drag-src)')];
  if (!cards.length) return null;
  // ближайшая карточка к мыши; левая половина — перед ней, правая — после
  let best = null, d = Infinity;
  for (const c of cards) { const b = c.getBoundingClientRect(), cx = Math.max(b.left, Math.min(x, b.right)), cy = Math.max(b.top, Math.min(y, b.bottom)), k = Math.hypot(x - cx, y - cy); if (k < d) { d = k; best = c; } }
  const b = best.getBoundingClientRect();
  return { card: best, after: x > b.left + b.width / 2 };
};
pointerDrag(view, {
  pick(e) {
    const c = e.target.closest('.fr-shot[data-shot]');
    if (!c || e.target.closest('.fr-editbtn, a, .stash')) return null; // щелчок без движения — откроет раскадровку или мизансцену
    return { el: c, data: c.dataset.shot };
  },
  move(id, x, y) { unmark(); const t = spot(x, y); if (t) t.card.classList.add(t.after ? 'drop-after' : 'drop-before'); },
  drop(id, x, y) {
    const p = project(), s = p.shots.find(q => q.id === id), t = spot(x, y);
    if (!s || !t || t.card.dataset.shot === id) return;
    p.shots.splice(p.shots.indexOf(s), 1);
    const o = p.shots.find(q => q.id === t.card.dataset.shot);
    p.shots.splice(p.shots.indexOf(o) + (t.after ? 1 : 0), 0, s);
    store.touch();
  },
  end() { unmark(); renderFrames(openScene); },
});

// ---------- окошко справа: мизансцена кадра крупно ----------
const shotById = (p, id) => p.shots.find(x => x.id === id);
registerKind('mise', {
  exists: (p, id) => !!shotById(p, id),
  name: (p, id) => `Мизансцена ${numbering(p).get(id)}`,
  render(el, id, head, keep) {
    const p = project(), s = shotById(p, id), a = shotAuto(p, s);
    const top = keep ? ($('.split-scroll', el) || {}).scrollTop || 0 : 0;
    el.innerHTML = head(`<b>Мизансцена</b> кадр ${numbering(p).get(id)}${a.plan ? ` · ${esc(miseLabel(a, s))}` : ''}`, a.plan ? 'Открыть мизансцену' : 'Готово')
      + `<div class="split-scroll split-page sp-shot" data-sp-shot="${id}">${a.plan ? `<div class="sp-plan sp-mise">${planSVG(atPhase(a.plan, s.phaseId), { cameraId: s.cameraId || null, pad: 0.8 })}</div>
        <p class="sp-links">${esc(a.plan.name)}${a.camera ? ` · ${esc(caption(a.camera))}` : ''}${a.lights.length ? `<br>Свет: ${a.lights.map(esc).join(', ')}` : ''}</p>
        <div class="sp-row"><button class="act" data-sp-act="mise-change">${misePick === id ? 'Свернуть' : 'Изменить'}</button> <button class="linkbtn" data-sp-act="nomise">без мизансцены</button></div>` : '<p class="empty">Выберите план, фазу и камеру:</p>'}
        ${!a.plan || misePick === id ? miseOptions(p, s) : ''}</div>`;
    $('.split-scroll', el).scrollTop = top;
  },
  action(act, id) {
    const p = project(), s = shotById(p, id);
    if (act === 'full' && !s.planId) { closeSplit(); return true; }
    if (act === 'full') { closeSplit(); location.hash = `#/p/${p.id}/plan/${s.planId}${s.cameraId ? '/' + s.cameraId : ''}`; return true; }
    if (act === 'shot-edit') { openKind('shot', id); refresh(); return true; }
    return false;
  },
});

// ---------- окошко справа: настройка кадра ----------
registerKind('shot', {
  exists: (p, id) => !!shotById(p, id),
  name: (p, id) => `Кадр ${numbering(p).get(id)}`,
  render(el, id, head, keep) {
    const p = project(), s = shotById(p, id), a = shotAuto(p, s), nums = numbering(p);
    const mates = p.shots.filter(x => x.sceneId === s.sceneId), i = mates.indexOf(s);
    const nav = `<button class="ico" data-split="shot-prev" title="Предыдущий кадр" aria-label="Предыдущий кадр"${i > 0 ? '' : ' disabled'}><svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg></button>
      <button class="ico" data-split="shot-next" title="Следующий кадр" aria-label="Следующий кадр"${i < mates.length - 1 ? '' : ' disabled'}><svg viewBox="0 0 24 24"><path d="M10 6l6 6-6 6"/></svg></button>`;
    const top = keep ? ($('.split-scroll', el) || {}).scrollTop || 0 : 0;
    el.innerHTML = head(`<b>Кадр ${nums.get(id)}</b> настройка`, 'Готово', nav, `<button class="act danger-lite" data-split="shot-del" title="Убрать кадр">Убрать</button>`)
      + `<div class="split-scroll split-page sp-shot" data-sp-shot="${id}">
        <h3>Раскадровка</h3>
        ${framesOf(s).length ? `<div class="sp-frames">${framesOf(s).map((f, k) => `<span class="sp-fr"><img src="${esc(srcOf(f))}" alt="" data-sp-view="${k}"><button class="ds-fx" data-sp-act="unframe" data-k="${k}" title="Убрать эту картинку" aria-label="Убрать">×</button></span>`).join('')}
          <button class="sp-fr-add" data-sp-act="pick" title="Добавить ещё картинки (можно несколько сразу), перетащить файлы или вставить Ctrl+V">${PLUS}</button></div>
          <p class="sp-hint">Панораму или движение можно раскадровать несколькими картинками подряд.</p>`
          : `<div class="sp-pic empty" data-sp-act="pick" title="Выбрать картинки, перетащить файлы или вставить Ctrl+V"><span>${PLUS}Выбрать картинки, перетащить файлы или вставить Ctrl+V</span></div>`}
        <h3>Мизансцена</h3>
        ${a.plan ? `<div class="sp-mise-cur"><a class="sp-mise-big" href="#/p/${p.id}/plan/${s.planId}${s.cameraId ? '/' + s.cameraId : ''}" title="Открыть мизансцену">${planSVG(atPhase(a.plan, s.phaseId), { cameraId: s.cameraId || null, pad: 0.6 })}</a>
          <div class="sp-row">${esc(a.plan.name)} · ${esc(miseLabel(a, s))}</div>
          <div class="sp-row"><button class="act" data-sp-act="mise-change">${misePick === s.id ? 'Свернуть' : 'Изменить'}</button> <button class="linkbtn" data-sp-act="nomise">без мизансцены</button></div></div>` : '<p class="empty">Выберите план, фазу и камеру:</p>'}
        ${!a.plan || misePick === s.id ? miseOptions(p, s) : ''}
        <h3>Техника</h3>
        <div class="sp-row2"><select data-sp-key="size" aria-label="Крупность"><option value=""${s.size ? '' : ' selected'}>Крупность</option>${SIZES.map(v => `<option${v === s.size ? ' selected' : ''}>${v}</option>`).join('')}</select>
          <input data-sp-key="move" list="sp-moves" value="${esc(s.move)}" placeholder="Движение, штатив, звук" aria-label="Движение камеры и техника"></div>
        <label class="sp-lens"><span>Объектив</span><input data-sp-lens list="sp-lenses" value="${esc(s.lens || (a.camera ? a.camera.lens + ' мм' : ''))}" placeholder="35 мм" aria-label="Объектив">
          <small>${a.camera ? `меняется и у камеры ${esc(a.camera.name)} в мизансцене${s.phaseId && (a.plan.phases || []).length > 1 ? ' в этой фазе' : ''}` : 'камеры у кадра нет — объектив запишется только в карточку'}</small></label>
        <datalist id="sp-lenses">${[14, 18, 24, 28, 35, 40, 50, 65, 85, 100, 135].map(v => `<option value="${v} мм">`).join('')}</datalist>
        <datalist id="sp-moves">${MOVES.map(v => `<option value="${v}">`).join('')}<option value="Статика, штатив"><option value="Ручная камера"><option value="Ронин"><option value="Слайдер"><option value="Петличка"><option value="Пушка, журавль"></datalist>
        <div class="sp-durrow"><h3>Хронометраж</h3><span class="fr-dur" title="Сколько длится кадр, минуты:секунды"><button data-sp-dur="-5" aria-label="Меньше на 5 секунд">−</button><input data-sp-key="dur" value="${esc(s.dur)}" placeholder="0:00" aria-label="Хронометраж" inputmode="numeric"><button data-sp-dur="5" aria-label="Больше на 5 секунд">+</button></span><small>мин:сек, кнопки по 5 секунд</small></div>
        <h3>Что происходит в кадре</h3>
        <textarea class="fr-auto" data-sp-key="content" rows="4" placeholder="Действие, реплики, что видит камера">${esc(s.content)}</textarea>
        <h3>Примечание</h3>
        <textarea class="fr-auto" data-sp-key="note" rows="2" placeholder="Примечание">${esc(s.note)}</textarea>
      </div>`;
    for (const t of el.querySelectorAll('textarea.fr-auto')) grow(t);
    $('.split-scroll', el).scrollTop = top;
  },
  action(act, id) {
    const p = project(), s = shotById(p, id), mates = p.shots.filter(x => x.sceneId === s.sceneId), i = mates.indexOf(s);
    if (act === 'full') { closeSplit(); refresh(); return true; }
    if (act === 'shot-prev' && i > 0) { openKind('shot', mates[i - 1].id); refresh(); return true; }
    if (act === 'shot-next' && i < mates.length - 1) { openKind('shot', mates[i + 1].id); refresh(); return true; }
    if (act === 'shot-del') {
      if (!confirm(`Убрать кадр ${numbering(p).get(id)} из раскадровки и режиссёрского сценария?`)) return true;
      p.shots.splice(p.shots.indexOf(s), 1); store.touch(); closeSplit(); refresh(); return true;
    }
    return false;
  },
});

// варианты мизансцены: планы сцены × фазы × камеры (и свёрнутые планы других сцен)
function miseOptions(p, shot) {
  const mine = p.plans.filter(x => x.sceneId === shot.sceneId), other = p.plans.filter(x => x.sceneId !== shot.sceneId);
  const variants = pl => {
    const cams = pl.objects.filter(o => o.type === 'camera'), phases = (pl.phases || []).length > 1 ? pl.phases : [null];
    return phases.map(ph => `<div class="mp-phase">${ph ? `<h5>${esc(ph.name)}</h5>` : ''}<div class="mp-row">${(cams.length ? cams : [null]).map(c => {
      const on = shot.planId === pl.id && (shot.cameraId || '') === (c ? c.id : '') && (shot.phaseId || '') === (ph ? ph.id : '');
      return `<button class="mp-opt${on ? ' on' : ''}" data-mp-plan="${pl.id}" data-mp-cam="${c ? c.id : ''}" data-mp-phase="${ph ? ph.id : ''}">${planSVG(atPhase(pl, ph ? ph.id : ''), { cameraId: c ? c.id : null, pad: 0.6 })}<i>${c ? esc(caption(c)) : 'Без камеры'}</i></button>`;
    }).join('')}</div></div>`).join('');
  };
  const block = pl => `<section class="mp-plan"><h4>${esc(pl.name)}</h4>${variants(pl)}</section>`;
  return `<div class="sp-mise-pick">${mine.length ? mine.map(block).join('') : '<p class="empty">У сцены пока нет плана — создайте его в «Общем плане сцены».</p>'}
    ${other.length ? `<details class="mp-other"><summary>Планы других сцен</summary>${other.map(block).join('')}</details>` : ''}</div>`;
}

// ---------- правка в окошке настройки ----------
const spShot = el => { const box = el.closest('[data-sp-shot]'); return box && shotById(project(), box.dataset.spShot); };
const rerenderPanel = () => { if (splitKind() === 'shot' || splitKind() === 'mise') refreshSplit(); refresh(); document.dispatchEvent(new Event('miz:shot-changed')); };
// картинки к кадру дописываются следом за уже стоящими (панорама в несколько кадриков)
async function setFrame(s, file) { return addFrames(s, [file]); }
async function addFrames(s, files) {
  files = [...files].filter(f => f && (/^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name || '')));
  if (!s || !files.length) return toast('Это не картинка');
  toast(files.length > 1 ? `Сжимаю картинки: ${files.length}…` : 'Сжимаю картинку…');
  const n = await addFrameFiles(s, files, 1600);
  if (!n) return toast('Не получилось открыть картинку');
  store.touch(); rerenderPanel(); toast(`Кадр ${numbering(project()).get(s.id)}: картинок ${framesOf(s).length}`);
}
const inPanel = e => e.target.closest && e.target.closest('#split [data-sp-shot]');
document.addEventListener('click', async e => {
  if (!inPanel(e)) return;
  const s = spShot(e.target);
  if (!s) return;
  const o = e.target.closest('.mp-opt');
  if (o) { s.planId = o.dataset.mpPlan; s.cameraId = o.dataset.mpCam; s.phaseId = o.dataset.mpPhase; misePick = ''; store.touch(); rerenderPanel(); return; }
  const d = e.target.closest('[data-sp-dur]');
  if (d) { s.dur = clock(Math.max(0, seconds(s.dur) + +d.dataset.spDur)); d.parentElement.querySelector('input').value = s.dur; store.touch(); refresh(); return; }
  const b = e.target.closest('[data-sp-act]');
  if (!b) return;
  if (b.dataset.spAct === 'pick') { const f = await pickFile('image/*', true); if (f && f.length) addFrames(s, f); }
  if (b.dataset.spAct === 'mise-change') { misePick = misePick === s.id ? '' : s.id; rerenderPanel(); return; }
  if (b.dataset.spAct === 'unframe') { const l = framesOf(s).slice(); l.splice(+(b.dataset.k || 0), 1); setFrames(s, l); store.touch(); rerenderPanel(); }
  if (b.dataset.spAct === 'nomise') { s.planId = s.cameraId = s.phaseId = ''; store.touch(); rerenderPanel(); }
});
document.addEventListener('input', e => {
  if (!inPanel(e)) return;
  const s = spShot(e.target), k = e.target.dataset.spKey;
  if (!s || !k || e.target.matches('select')) return;
  s[k] = e.target.value; store.touch();
  if (e.target.matches('textarea.fr-auto')) grow(e.target);
  clearTimeout(rerenderPanel.t); rerenderPanel.t = setTimeout(refresh, 400); // карточка слева догоняет
});
document.addEventListener('change', e => {
  if (!inPanel(e)) return;
  const s = spShot(e.target), k = e.target.dataset.spKey;
  if (s && k && e.target.matches('select')) { s[k] = e.target.value; store.touch(); refresh(); }
});
document.addEventListener('focusout', e => {
  if (!inPanel(e) || !e.target.matches('.fr-dur input')) return;
  const s = spShot(e.target), v = e.target.value.trim();
  if (!s || !v) return;
  s.dur = clock(/^\d+$/.test(v) ? +v : seconds(v)); e.target.value = s.dur; store.touch(); refresh();
});
// картинка: перетащить файл в окошко настройки или вставить из буфера, пока оно открыто
document.addEventListener('dragover', e => { if (inPanel(e) && e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.target.closest('[data-sp-shot]').classList.add('drop'); } });
document.addEventListener('dragleave', e => { const b = inPanel(e); if (b && !b.contains(e.relatedTarget)) b.classList.remove('drop'); });
document.addEventListener('drop', e => {
  const b = inPanel(e);
  if (!b || !e.dataTransfer.files.length) return;
  e.preventDefault(); b.classList.remove('drop');
  addFrames(spShot(b), e.dataTransfer.files);
});
document.addEventListener('paste', e => {
  if (splitKind() !== 'shot' || e.target.closest('textarea, input')) return;
  const f = [...((e.clipboardData || {}).files || [])].find(x => /^image\//.test(x.type));
  if (!f) return;
  e.preventDefault();
  setFrame(shotById(project(), splitRef()), f);
});


// ---------- объектив кадра: пишется в карточку и в камеру мизансцены (в фазе кадра) ----------
function setLens(p, s, text) {
  s.lens = text.trim();
  const mm = parseInt((text.match(/\d+/) || [])[0], 10), a = shotAuto(p, s);
  if (!mm || !a.plan || !a.camera) return;
  const pl = a.plan, cam = pl.objects.find(o => o.id === s.cameraId), phs = pl.phases || [];
  if (!cam) return;
  s.lens = ''; // объектив теперь хранится у камеры — карточка берёт его оттуда
  const k = phs.findIndex(ph => ph.id === s.phaseId);
  if (phs.length > 1 && k >= 0) {
    const ph = phs[k];
    ph.pos[cam.id] = { ...(ph.pos[cam.id] || { x: cam.x, y: cam.y, rot: cam.rot || 0 }), lens: mm };
    if (k === (pl.phase | 0)) cam.lens = mm;
  } else {
    cam.lens = mm;
    for (const ph of phs) if (ph.pos[cam.id]) ph.pos[cam.id].lens = mm;
  }
}
document.addEventListener('change', e => {
  if (!inPanel(e) || !e.target.matches('[data-sp-lens]')) return;
  const s = spShot(e.target);
  if (!s) return;
  setLens(project(), s, e.target.value); store.touch(); rerenderPanel();
});

// ---------- картинка из папки — прямо на карточку ----------
// файлы несут снаружи (из папки), а не картинку со страницы
let innerDrag = false;
document.addEventListener('dragstart', () => { innerDrag = true; });
document.addEventListener('dragend', () => { innerDrag = false; });
document.addEventListener('drop', () => { innerDrag = false; });
const filesIn = e => !innerDrag && e.dataTransfer && [...e.dataTransfer.types].includes('Files');
// куда несут файлы: карточка, раздел или строка сцены, стэш
const fileSpot = e => e.target.closest('.fr-shot[data-shot], [data-stash="shots"], [data-drop-scene]');
view.addEventListener('dragover', e => {
  const t = fileSpot(e);
  if (!t || !filesIn(e) || (t.dataset.dropScene === '')) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  for (const x of view.querySelectorAll('.drop, .drop-hot')) if (x !== t) x.classList.remove('drop', 'drop-hot');
  t.classList.add(t.dataset.shot ? 'drop' : 'drop-hot');
});
view.addEventListener('dragleave', e => { const t = fileSpot(e); if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop', 'drop-hot'); });
view.addEventListener('drop', e => {
  const t = fileSpot(e);
  if (!t || !filesIn(e)) return;
  e.preventDefault(); t.classList.remove('drop', 'drop-hot');
  const files = [...e.dataTransfer.files].filter(isPic);
  if (!files.length) return toast('Это не картинка');
  if (t.dataset.shot) {
    const s = project().shots.find(x => x.id === t.dataset.shot);
    // картинки на карточку — дописываются в её раскадровку (панорама в несколько кадриков)
    return addFrames(s, files);
  }
  addPics(files, t.dataset.stash ? '' : t.dataset.dropScene);
});

// ---------- выбор мизансцены: увеличение как в доке macOS ----------
// Каждый вариант растёт по тому, насколько близко к нему мышь: ближайший — крупнее всех, соседи — чуть меньше.
// Ведёшь мышь вправо — увеличение плавно перетекает к соседу, ничего не прыгает. Края окошка варианты не переходят.
const DOCK_Z = 2.2, DOCK_SIGMA = 62;
let dock = null, dockRaf = 0;
function dockMeasure(pick) {
  const opts = [...pick.querySelectorAll('.mp-opt')];
  const keep = opts.map(o => o.style.transform);
  opts.forEach(o => { o.style.transition = 'none'; o.style.transform = 'none'; });
  const box = pick.closest('.split-scroll').getBoundingClientRect();
  const list = opts.map(o => { const r = o.getBoundingClientRect(); return { o, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height }; });
  opts.forEach((o, k) => { o.style.transform = keep[k]; });
  void pick.offsetWidth;
  opts.forEach(o => { o.style.transition = ''; });
  return { pick, box, list };
}
function dockApply() {
  dockRaf = 0;
  if (!dock) return;
  const { box, list, x, y } = dock, clamp = v => Math.max(0, Math.min(1, v));
  for (const it of list) {
    const d2 = (it.cx - x) ** 2 + (it.cy - y) ** 2, z = 1 + (DOCK_Z - 1) * Math.exp(-d2 / (2 * DOCK_SIGMA * DOCK_SIGMA));
    if (z < 1.02) { it.o.style.transform = ''; it.o.style.zIndex = ''; it.o.classList.remove('dock-near'); continue; }
    // точка, от которой растёт, — так, чтобы увеличенный вариант оставался внутри окошка
    const left = it.cx - it.w / 2, top = it.cy - it.h / 2;
    const ox = clamp((left - (box.left + 6)) / (it.w * (z - 1))), oxr = clamp((left + it.w * z - (box.right - 6)) / (it.w * (z - 1)));
    const oy = clamp((top - (Math.max(0, box.top) + 6)) / (it.h * (z - 1))), oyb = clamp((top + it.h * z - (Math.min(innerHeight, box.bottom) - 6)) / (it.h * (z - 1)));
    const gx = Math.min(Math.max(0.5, oxr), ox), gy = Math.min(Math.max(0.5, oyb), oy);
    it.o.style.transformOrigin = `${(gx * 100).toFixed(1)}% ${(gy * 100).toFixed(1)}%`;
    it.o.style.transform = `scale(${z.toFixed(3)})`;
    it.o.style.zIndex = String(Math.round(z * 100));
    it.o.classList.toggle('dock-near', z > DOCK_Z - 0.25);
  }
}
function dockReset(pick) {
  for (const o of pick.querySelectorAll('.mp-opt')) { o.style.transform = ''; o.style.zIndex = ''; o.classList.remove('dock-near'); }
}
document.addEventListener('pointermove', e => {
  const pick = e.target.closest && e.target.closest('#split .sp-mise-pick');
  if (!pick) { if (dock) { dockReset(dock.pick); dock = null; } return; }
  if (!dock || dock.pick !== pick) { if (dock) dockReset(dock.pick); dock = dockMeasure(pick); }
  dock.x = e.clientX; dock.y = e.clientY;
  if (!dockRaf) dockRaf = requestAnimationFrame(dockApply);
});
document.addEventListener('pointerleave', () => { if (dock) { dockReset(dock.pick); dock = null; } });
// прокрутка окошка сдвигает варианты — меряем заново
document.addEventListener('scroll', () => { if (dock) { dockReset(dock.pick); dock = null; } }, true);
const zoomHide = () => {};

// ---------- без сцены: перетащить на сцену, картинки из папки — в стэш ----------
const unhot = () => { for (const x of view.querySelectorAll('.drop-hot')) x.classList.remove('drop-hot'); };
// куда бросили: на готовую карточку кадра или в раздел сцены (строку сцены в списке)
const target = (x, y, many = false) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const card = el.closest('.fr-shot[data-shot]');
  if (card && !many) return card;
  const t = el.closest('[data-drop-scene]');
  return t && t.dataset.dropScene ? t : null;
};
// из стэша на карточку: картинка становится её раскадровкой, мизансцена — её мизансценой
function onCard(kind, id, card) {
  const p = project(), sh = p.shots.find(x => x.id === card.dataset.shot);
  if (!sh) return;
  const num = numbering(p).get(sh.id);
  if (kind === 'shot') {
    const loose = p.shots.find(x => x.id === id);
    if (!loose || !loose.frame) return toast('У этого кадра нет картинки');
    setFrames(sh, [...framesOf(sh), ...framesOf(loose)]);
    // текст из стэша не теряем: переносим, если в карточке его нет
    for (const k of ['content', 'note', 'dur']) if (!sh[k] && loose[k]) sh[k] = loose[k];
    p.shots.splice(p.shots.indexOf(loose), 1); // картинка переехала в карточку — пустой кадр в стэше не нужен
    toast(`Кадр ${num}: картинок ${framesOf(sh).length}`);
  } else {
    const pl = p.plans.find(x => x.id === id);
    if (!pl) return;
    bindPlan(p, pl, sh.sceneId);
    const cams = pl.objects.filter(o => o.type === 'camera');
    sh.planId = pl.id; sh.cameraId = cams.length === 1 ? cams[0].id : ''; sh.phaseId = '';
    toast(`Мизансцена «${pl.name}» у кадра ${num}${cams.length > 1 ? ' — камеру выберите в «Настроить»' : ''}`);
  }
  store.touch();
}
pointerDrag(view, {
  pick(e) {
    const it = e.target.closest('.stash-item');
    if (!it || e.shiftKey || e.ctrlKey || e.metaKey) return null; // с Shift/Ctrl это выбор, а не перенос
    const k = it.dataset.stashPlan ? 'plan:' + it.dataset.stashPlan : 'shot:' + it.dataset.stashShot;
    // взяли выбранный — едет вся пачка; взяли невыбранный — только он
    const items = (picked.has(k) ? [...picked] : [k]).map(x => { const [kind, id] = x.split(':'); return { kind, id }; });
    if (items.length > 1) it.dataset.count = items.length; else delete it.dataset.count;
    return { el: it, data: items };
  },
  ghost(el, items, r) {
    if (items.length < 2) return null;
    const els = [el, ...items.map(it => view.querySelector(it.kind === 'plan' ? `[data-stash-plan="${it.id}"]` : `[data-stash-shot="${it.id}"]`)).filter(x => x && x !== el)];
    return stackGhost(els, items.length, r);
  },
  move(items, x, y) { unhot(); const t = target(x, y, items.length > 1); if (t) t.classList.add('drop-hot'); },
  drop(items, x, y) {
    const t = target(x, y, items.length > 1);
    if (!t) return;
    if (t.dataset.shot) { onCard(items[0].kind, items[0].id, t); picked.clear(); return; }
    for (const it of items) attach(it.kind, it.id, t.dataset.dropScene, items.length > 1);
    if (items.length > 1) {
      const n = (sceneInfo(project()).find(q => q.id === t.dataset.dropScene) || {}).n, k = items.filter(i => i.kind === 'shot').length;
      toast(`Сцена ${n}: ${[k && `раскадровок ${k}`, items.length - k && `мизансцен ${items.length - k}`].filter(Boolean).join(', ')}`);
    }
    picked.clear();
  },
  end() { for (const x of view.querySelectorAll('[data-count]')) delete x.dataset.count; unhot(); renderFrames(openScene); },
});
view.addEventListener('keydown', e => {
  const inp = e.target.closest('[data-light-add]');
  if (!inp || e.key !== 'Enter') return;
  e.preventDefault();
  const v = inp.value.trim(), sid = inp.dataset.lightAdd;
  if (!v) return;
  const p = project(), s = sceneInfo(p).find(q => q.id === sid);
  if (p.sceneLightOff && p.sceneLightOff[sid]) p.sceneLightOff[sid] = p.sceneLightOff[sid].filter(k => k !== lightKey(v));
  setLights(sid, [...lightList(p, s), v]);
  const again = view.querySelector('[data-light-add]'); if (again) again.focus();
});

// ---------- стэш: выделение рамкой ----------
// Зажали левую кнопку на пустом месте стэша и повели — рамка выбирает всё, что задела.
// С Shift (или Ctrl) рамка добавляет к уже выбранному, без них — выбирает заново. Щелчок по пустому месту снимает выбор.
let band = null;
// рамку можно начать и рядом со стэшем — чуть выше, ниже, левее и правее его края
const nearStash = e => [...view.querySelectorAll('.fr-stash')].some(st => { const r = st.getBoundingClientRect(), m = 60; return e.clientX > r.left - m && e.clientX < r.right + m && e.clientY > r.top - m && e.clientY < r.bottom + m; });
const keyOf = it => it.dataset.stashPlan ? 'plan:' + it.dataset.stashPlan : 'shot:' + it.dataset.stashShot;
view.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !(e.target.closest('.fr-stash, .fr-side') || nearStash(e)) || e.target.closest('.stash-item, button, a, input, select, textarea, label, .fr-shot, tr, .plan-tile, .fr-fact')) return;
  e.preventDefault();
  band = { x: e.clientX, y: e.clientY, add: e.shiftKey || e.ctrlKey || e.metaKey, base: new Set(picked), el: null, moved: false };
});
addEventListener('pointermove', e => {
  if (!band) return;
  const x1 = Math.min(band.x, e.clientX), y1 = Math.min(band.y, e.clientY), x2 = Math.max(band.x, e.clientX), y2 = Math.max(band.y, e.clientY);
  if (!band.moved && x2 - x1 < 4 && y2 - y1 < 4) return;
  band.moved = true;
  if (!band.el) { band.el = document.createElement('div'); band.el.className = 'stash-band'; document.body.append(band.el); document.body.classList.add('banding'); }
  Object.assign(band.el.style, { left: x1 + 'px', top: y1 + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
  // подсветка сразу, пока ведём рамку
  for (const it of view.querySelectorAll('.stash-item')) {
    const r = it.getBoundingClientRect(), hit = r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2;
    it.classList.toggle('sel', hit || (band.add && band.base.has(keyOf(it))));
  }
});
addEventListener('pointerup', () => {
  if (!band) return;
  const b = band; band = null;
  if (b.el) b.el.remove();
  document.body.classList.remove('banding');
  if (!b.moved) { if (!b.add && picked.size) { picked.clear(); renderFrames(openScene); } return; }
  picked = new Set(b.add ? b.base : []);
  for (const it of view.querySelectorAll('.stash-item.sel')) picked.add(keyOf(it));
  renderFrames(openScene);
});

// картинка в настройке кадра — открыть крупно с этого места
document.addEventListener('click', e => {
  const v = e.target.closest && e.target.closest('#split [data-sp-view]');
  if (!v) return;
  const s = spShot(v);
  if (s) openPhoto('shot', s.id, v.dataset.spView);
});
