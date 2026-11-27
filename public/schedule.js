// КПП (календарно-постановочный план): съёмочные дни полосами сцен, как доска в SetSnitch и FilmToolz.
// Сцены перетаскиваются между днями и на «боковой стол» (ещё не разложенные), у дня есть тип, ночная смена,
// замок и действия со сдвигом дат; рассвет и закат по координатам локации, занятость актёров с предупреждениями.
import { store, $, $$, uid, esc, toast } from './store.js';
import { ask } from './ui.js';
import { sceneInfo } from './breakdown.js';
import { castList, scheduledIds, dayInfo, nextDate, dayOutOfDays, stripClass, synopsisOf, clockText,
  normalizeSchedule, DAY_KINDS, isWeekend, isHoliday, movableDay, moveShift, datesFrom, moveToDate, swapDays, sortDays, shiftNo, objectOf, busyOn, contactLink, CONTACT_PH, variantTitle, newVariant, switchVariant, deleteVariant } from './schedmodel.js';
import { exportKPP } from './kppexport.js';
import { setDur } from './scenes.js';
import { openSides } from './split.js';
import { pointerDrag, stackGhost } from './dragsort.js';

const project = () => store.project;
const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>';
const weekday = d => { if (!d) return ''; const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }); };
const title = s => s ? s.charAt(0) + s.slice(1).toLowerCase() : '';
const store_ = k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const keep = (k, v) => { try { localStorage.setItem(k, v); } catch { /* не страшно */ } };

// состояние экрана: вид дня, фильтры бокового стола
let filter = 'all', mode = store_('miz:kpp-mode') || 'order', side = { q: '', sort: store_('miz:kpp-sort') || 'num', actor: '', loc: '' };

// Полоса сцены: номер, хронометраж, режим, инт/нат, сценарный день, объект, персонажи.
const norm = t => String(t || '').toLowerCase().replace(/ё/g, 'е');
const IE_WORDS = { 'ИНТ': 'инт интерьер павильон', 'НАТ': 'нат натура улица' };
function haystack(p, s, cast) {
  const ie = Object.entries(IE_WORDS).filter(([k]) => (s.ie || '').includes(k)).map(([, v]) => v).join(' ');
  const actors = cast.filter(c => s.chars.includes(c.char)).map(c => c.actor).join(' ');
  const o = objectOf(p, s);
  return norm([s.n, s.text, s.place, s.ie, ie, s.time, s.day, s.chars.join(' '), actors, o.name, o.sub, synopsisOf(p, s)].join(' '));
}
// Совпадает ли сцена с запросом. Одно число — номер сцены; иначе все слова запроса должны найтись
// (в любом порядке): «нат батыр», «гостиная ночь», «мама 12».
function matches(s, hay, q) {
  q = norm(q).trim();
  if (!q) return true;
  if (/^\d+[а-яa-z]?$/.test(q)) return norm(s.n) === q;
  return q.split(/[\s,]+/).filter(Boolean).every(w => hay.includes(w));
}

function strip(s, cast, itemId = '', fixed = false) {
  const p = project();
  const who = cast.filter(c => s.chars.includes(c.char)).map(c => title(c.char)).join(', ');
  return `<div class="strip ${stripClass(s)}"${fixed ? '' : ` data-drag="${itemId ? 'item:' + itemId : 'scene:' + s.id}"`} data-n="${s.n}" data-q="${esc(haystack(p, s, cast))}" title="${esc((s.place || s.text) + (synopsisOf(p, s) ? ' — ' + synopsisOf(p, s) : ''))}">
    <button class="st-n" data-scene-open="${s.id}" title="Открыть сцену">${s.n}</button><span class="st-dur${s.durOwn ? ' own' : ''}" title="Хронометраж${s.durOwn ? ' (свой)' : ''}. Поправить можно в разборе сцены">${esc(s.dur || '—')}</span>
    <span class="st-time">${esc((s.time || '').toLowerCase())}</span><span class="st-ie">${esc(s.ie || '—')}</span>
    <span class="st-place" title="${esc(s.place || s.text)}">${(() => { const o = objectOf(p, s); return o.name ? `<b>${esc(o.name)}</b>${o.sub ? `<span class="st-sub">${esc(o.sub)}</span>` : ''}` : esc(s.place || s.text); })()}</span><span class="st-cast" title="Персонажи">${esc(who)}</span></div>`;
}

// Неразложенные сцены после поиска и фильтров бокового стола.
function freeScenes(p, info) {
  const done = scheduledIds(p), q = side.q, cast = castList(p, info);
  return info.filter(s => !done.has(s.id)
    && (filter === 'all' || (filter === 'int' ? /ИНТ/.test(s.ie) : filter === 'ext' ? /НАТ/.test(s.ie) : /НОЧЬ|РЕЖИМ|ВЕЧЕР/.test(s.time)))
    && (!side.actor || s.chars.includes(side.actor))
    && (!side.loc || objectOf(p, s).key === side.loc)
    && matches(s, haystack(p, s, cast), q));
}

const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

function dayHTML(p, d, info, cast, base) {
  const di = dayInfo(p, d, info, cast), n = shiftNo(p, d), work = d.kind === 'work', fixed = d.locked;
  const wd = d.date && (isHoliday(d.date) ? 'праздник' : isWeekend(d.date) ? 'выходной' : '');
  const busy = busyOn(p, d, di.scenes.flatMap(s => s.chars));
  const items = mode === 'objects' ? byObjects(p, d, info, cast, fixed) : d.items.map(x => {
    if (x.type === 'banner') return `<div class="strip st-banner"${fixed ? '' : ` data-drag="item:${x.id}"`}><span>${esc(x.text)}</span>${fixed ? '' : `<button class="ico" data-act="del-banner" data-item="${x.id}" title="Убрать плашку" aria-label="Убрать плашку">${X}</button>`}</div>`;
    const s = info.find(q => q.id === x.sceneId);
    return s ? strip(s, cast, x.id, fixed) : '';
  }).join('');
  const sun = di.sun ? `<span>сумерки ${di.sun.dawn}</span><span>восход <b>${di.sun.sunrise}</b></span><span>закат <b>${di.sun.sunset}</b></span><span>темно ${di.sun.dusk}</span>` : '';
  const locs = di.locs.length ? `<span class="sd-loc">${di.locs.map(l => `<button class="linkbtn" data-loc-open="${l.id}">${esc(l.name)}</button>`).join(', ')}</span>` : '';
  return `<section class="sd-day${work ? '' : ' kind-' + d.kind}${d.night ? ' night' : ''}${fixed ? ' locked' : ''}" data-day="${d.id}"${work && !fixed ? ` data-drop="${d.id}"` : ''}>
    <header class="sd-head${mode === 'order' && movableDay(d) ? ' can-drag" data-daydrag="' + d.id + '" title="Потяните за шапку, чтобы переставить смену: она получит дату и номер нового места' : ''}">
      ${mode === 'order' && movableDay(d) ? `<span class="sd-grip" aria-hidden="true">${GRIP}</span>` : ''}<b>${work ? `Смена ${n}` : DAY_KINDS[d.kind]}</b>${d.night ? `<span class="sd-tag sd-night">${MOON}ночная</span>` : ''}${fixed ? `<span class="sd-lock" title="День зафиксирован">${LOCK}</span>` : ''}
      <input type="date" data-day-key="date" value="${esc(d.date)}" aria-label="Дата"${fixed ? ' disabled' : ''}>
      <span class="sd-wd${wd ? ' red' : ''}" title="${wd}">${esc(weekday(d.date))}</span>
      ${work ? `<label class="sd-call">сбор <input type="time" data-day-key="call" value="${esc(d.call)}"${fixed ? ' disabled' : ''}></label>` : ''}
      <span class="grow"></span>
      ${work ? `<button class="act" data-act="sides" title="Текст сцен дня для группы и для каждого актёра">Выборка</button><a class="act" href="${base}/call/${d.id}">Вызывной лист</a>` : ''}
      <button class="ico" data-act="day-menu" title="Действия со сменой" aria-label="Действия со сменой">${MORE}</button>
    </header>
    ${busy.length ? `<p class="sd-warn">${busy.map(b => `⚠ ${esc(title(b.char))}${b.actor ? ` (${esc(b.actor)})` : ''} ${b.kind === 'part' ? 'частично занят' : 'занят'}${b.note ? `: ${esc(b.note)}` : ''}`).join(' · ')}</p>` : ''}
    ${work && (sun || locs) ? `<p class="sd-sun">${sun}${locs}${d.date && !di.coords && di.locs.length ? '<span class="sd-nosun">восход и закат появятся, если в адресе локации есть ссылка на карту</span>' : ''}</p>` : ''}
    ${work || items ? `<div class="sd-strips">${items || '<p class="sd-empty">Перетащите сюда сцены</p>'}</div>` : ''}
    ${d.kppNote ? `<p class="sd-note">${esc(d.kppNote)}</p>` : ''}
    ${work ? `<footer class="sd-foot"><span>Конец смены ${n} · сцен ${di.scenes.length}${di.dur ? ` · хрон. ${clockText(di.dur)}` : ''}${di.cast.length ? ` · актёры ${di.cast.map(c => c.n).join(', ')}` : ''}</span>
      ${fixed || mode === 'objects' ? '' : '<button class="linkbtn" data-act="banner">+ плашка</button>'}</footer>` : ''}
  </section>`;
}

// вид «по объектам»: сцены дня сгруппированы, видно переезды и передекор
function byObjects(p, d, info, cast, fixed) {
  const groups = new Map();
  for (const x of d.items.filter(q => q.type === 'scene')) {
    const s = info.find(q => q.id === x.sceneId);
    if (!s) continue;
    const o = objectOf(p, s);
    if (!groups.has(o.key)) groups.set(o.key, { name: o.name, list: [] });
    groups.get(o.key).list.push(strip(s, cast, x.id, fixed));
  }
  return [...groups.values()].map(g => `<div class="sd-obj">${esc(g.name)} <span>${g.list.length}</span></div>${g.list.join('')}`).join('');
}

export function renderSchedule() {
  queueMicrotask(() => findScene(findQ, false)); // подсветка поиска переживает перерисовку
  queueMicrotask(markChosen); // и выбор нескольких сцен тоже
  const p = project(), base = `#/p/${p.id}`, sch = p.schedule, info = sceneInfo(p), cast = castList(p, info);
  const done = scheduledIds(p), free = freeScenes(p, info);
  const allFree = info.filter(s => !done.has(s.id));
  const works = sch.days.filter(d => d.kind === 'work').length;
  // боковой стол: по номерам или по объектам (объект целиком тоже можно перетащить)
  let sideHTML;
  if (side.sort === 'objects') {
    const groups = new Map();
    for (const s of free) { const o = objectOf(p, s); if (!groups.has(o.key)) groups.set(o.key, { key: o.key, name: o.name, list: [] }); groups.get(o.key).list.push(s); }
    sideHTML = [...groups.values()].map(g => `<div class="sd-objhead" data-drag="obj:${esc(g.key)}" title="Перетащите, чтобы поставить все сцены объекта">${esc(g.name)} <span>${g.list.length}</span></div>${g.list.map(s => strip(s, cast)).join('')}`).join('');
  } else sideHTML = free.map(s => strip(s, cast)).join('');
  const objects = new Map();
  for (const s of allFree) { const o = objectOf(p, s); objects.set(o.key, o.name); }
  const dood = dayOutOfDays(p, info, cast);
  const MARK = { S: 'нач', W: '●', F: 'кон', SWF: '●', H: '·' };

  $('#view-schedule').innerHTML = `<div class="page page-wide sd">
    <header class="page-head"><h1>КПП</h1>
      <div class="sd-findbox"><input class="sd-find" type="search" value="${esc(findQ)}" placeholder="Сцена, место, инт/нат, персонаж" aria-label="Поиск по КПП" title="Номер сцены или слова в любом порядке: «нат батыр», «гостиная ночь». Enter — к следующей"><span class="sd-findn"></span></div>
      <div class="chips sd-mode">${[['order', 'Порядок съёмки'], ['objects', 'По объектам']].map(([k, t]) => `<button data-mode="${k}" aria-pressed="${mode === k}">${t}</button>`).join('')}</div>
      <label class="sd-opt" title="Смены получат даты подряд, начиная с этого дня">первый день <input type="date" data-start value="${esc(sch.info.start)}"></label>
      <button class="act" data-act="kpp-pdf" ${sch.days.length ? '' : 'disabled'}>PDF</button><button class="act" data-act="kpp-xlsx" ${sch.days.length ? '' : 'disabled'}>Excel</button></header>
    ${variantsBar(p)}
    <p class="page-hint">${info.length ? `Разложено сцен: ${info.length - allFree.length} из ${info.length}, смен: ${works}. Перетаскивайте сцены между днями и на боковой стол. Смены переставляются за ручку слева от номера: смена получает дату и номер нового места. Меню «…» у дня: тип дня, ночная смена, замок, перенос на дату и обмен днями. Разложить сцены по дням с учётом локаций, актёров и режима может подключённый ИИ-помощник.` : 'Сцены появятся, когда в сценарии будут строки «Время и место».'}</p>
    <div class="sd-board">
      <div class="sd-days">${sch.days.map((d, i) => (i && mode === 'order' ? `<div class="sd-gap"><button class="sd-gapadd" data-gap="${i}" title="Вставить день сюда: смену, выходной, отсыпной…" aria-label="Вставить день между днями"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div>` : '') + dayHTML(p, d, info, cast, base)).join('') || '<p class="empty">Съёмочных дней пока нет. Добавьте день плюсом внизу и перетащите в него сцены — или попросите ИИ-помощника разложить КПП.</p>'}
        <div class="sd-addbar"><button class="sd-addday" data-act="add-day" title="Добавить съёмочный день в конец" aria-label="Добавить съёмочный день"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></div></div>
      <aside class="sd-side" data-drop="side">
        <header><h2>Боковой стол <span>${allFree.length}</span></h2>
          <input class="sd-sq" type="search" placeholder="Номер, место, персонаж" value="${esc(side.q)}" aria-label="Поиск по боковому столу">
          <div class="sd-sidef">
            <select data-side="sort" aria-label="Порядок"><option value="num"${side.sort === 'num' ? ' selected' : ''}>по номерам</option><option value="objects"${side.sort === 'objects' ? ' selected' : ''}>по объектам</option></select>
            <select data-side="actor" aria-label="Актёр"><option value="">все персонажи</option>${cast.map(c => `<option value="${esc(c.char)}"${side.actor === c.char ? ' selected' : ''}>${esc(title(c.char))}</option>`).join('')}</select>
            <select data-side="loc" aria-label="Объект"><option value="">все объекты</option>${[...objects].map(([k, n]) => `<option value="${esc(k)}"${side.loc === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
          </div>
          <div class="chips">${[['all', 'Все'], ['int', 'Инт'], ['ext', 'Нат'], ['night', 'Ночь и режим']].map(([k, t]) => `<button data-filter="${k}" aria-pressed="${filter === k}">${t}</button>`).join('')}</div></header>
        <div class="sd-strips">${sideHTML || `<p class="sd-empty">${allFree.length ? 'Ничего не нашлось' : 'Все сцены разложены'}</p>`}</div>
        <div class="sd-banners"><h3>Плашки <span>перетащите в день</span></h3>
          <div class="sd-bnlist">${bannerList(p).map(t => `<div class="strip st-banner sd-bn" data-drag="banner:${esc(t)}" title="Перетащите в день"><span>${esc(t)}</span></div>`).join('')}</div>
          <input class="sd-bnadd" placeholder="+ своя плашка и Enter" aria-label="Своя плашка"></div>
      </aside>
    </div>

    <section class="sd-sec"><h2>Актёры</h2>
      <p class="page-hint">Та же таблица, что в «Группе»: правки видны там и во всех вызывных. Минуты на грим и костюм, машину и занятость актёров — в <a href="${base}/crew">«Группе»</a>.</p>
      <table class="sd-cast"><thead><tr><th>№</th><th>Персонаж</th><th>Актёр</th><th>Телефон / Telegram</th><th>Сцен</th></tr></thead><tbody>
      ${cast.map(c => `<tr data-char="${esc(c.char)}"><td>${c.n}</td><td>${esc(title(c.char))}</td><td><input data-cast="actor" value="${esc(c.actor)}" placeholder="Кто играет"></td><td class="cr-phone"><input data-cast="phone" value="${esc(c.phone)}" placeholder="${CONTACT_PH}">${contactLink(c.phone)}</td><td>${c.scenes.length}</td></tr>`).join('')}
      </tbody></table></section>

    ${sch.days.length ? `<section class="sd-sec"><h2>Занятость актёров по дням</h2><div class="sl-wrap"><table class="sd-dood"><thead><tr><th>№</th><th>Персонаж</th>${sch.days.map(d => `<th title="${esc(weekday(d.date))}"${d.kind !== 'work' ? ' class="dd-offday"' : ''}>${d.kind === 'work' ? shiftNo(p, d) : '—'}${d.date ? `<small>${esc(d.date.slice(8))}.${esc(d.date.slice(5, 7))}</small>` : ''}</th>`).join('')}<th>Дней</th></tr></thead><tbody>
      ${dood.filter(r => r.work).map(r => `<tr><td>${r.n}</td><td>${esc(title(r.char))}${r.actor ? `<small>${esc(r.actor)}</small>` : ''}</td>${r.marks.map(m => `<td class="dd-${m || 'none'}">${MARK[m] || ''}</td>`).join('')}<td>${r.work}</td></tr>`).join('')}
      </tbody></table></div><p class="page-hint">● съёмочный день, «нач» и «кон» — первый и последний, точка — дни ожидания между ними.</p></section>` : ''}
  </div>`;
}

// универсальные плашки: обычные для площадки плюс свои (вписанные здесь или уже стоящие в днях)
const BANNERS = ['Обед', 'Переезд', 'Ждём режим'];
function bannerList(p) {
  const mine = [...(p.schedule.info.banners || []), ...p.schedule.days.flatMap(d => d.items.filter(x => x.type === 'banner').map(x => x.text))];
  const out = [];
  for (const t of [...BANNERS, ...mine]) if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
  return out;
}

// ---------- варианты раскладки ----------
const PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>';
const XS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
function variantsBar(p) {
  const s = p.schedule, works = days => days.filter(d => d.kind === 'work').length;
  const all = [{ id: 'current', name: variantTitle(s), days: s.days }, ...s.variants.map(v => ({ id: v.id, name: variantTitle(s, v), days: v.days }))];
  const chip = v => {
    const cur = v.id === 'current';
    return `<div class="sv-chip${cur ? ' on' : ''}"><button class="sv-name" ${cur ? 'data-vrename' : `data-vopen="${v.id}"`} title="${cur ? 'Текущий вариант. Щёлкните, чтобы переименовать' : 'Открыть этот вариант'}">${esc(v.name)}<small>${plural(works(v.days), 'смена', 'смены', 'смен')}</small></button>${cur ? `<button class="ico" data-vrename title="Переименовать" aria-label="Переименовать вариант">${PEN}</button>` : ''}${all.length > 1 ? `<button class="ico" data-vdel="${v.id}" title="Удалить вариант" aria-label="Удалить вариант">${XS}</button>` : ''}</div>`;
  };
  return `<div class="sv-bar"><span class="sv-label">Варианты</span>${all.map(chip).join('')}
    <button class="linkbtn" data-vnew="copy" title="Скопировать текущую раскладку и менять копию">+ копия текущего</button><button class="linkbtn" data-vnew="empty" title="Начать раскладку заново: все сцены на боковом столе">+ пустой</button></div>`;
}
const plural = (n, a, b, c) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c}`;

async function variantAction(t) {
  const p = project(), s = p.schedule;
  if (t.dataset.vnew) {
    const copy = t.dataset.vnew === 'copy';
    const name = await ask(copy ? 'Новый вариант — копия текущего' : 'Новый пустой вариант', { text: `Текущий «${variantTitle(s)}» сохранится, к нему можно вернуться.`, value: `Вариант ${s.variants.length + 2}`, ok: 'Создать' });
    if (name === null) return;
    newVariant(p, uid, name.trim() || `Вариант ${s.variants.length + 2}`, copy);
    store.touch(); rerender(); toast(copy ? 'Создана копия: правьте её, прежний вариант не изменится' : 'Новый вариант: все сцены на боковом столе');
    return;
  }
  if (t.dataset.vopen) { switchVariant(p, t.dataset.vopen, uid); store.touch(); rerender(); toast(`Открыт вариант «${variantTitle(s)}»`); return; }
  if (t.dataset.vrename !== undefined) {
    const name = await ask('Название варианта', { value: variantTitle(s), ok: 'Сохранить' });
    if (name === null || !name.trim()) return;
    s.variantName = name.trim(); store.touch(); rerender(); return;
  }
  if (t.dataset.vdel) {
    const id = t.dataset.vdel, v = s.variants.find(x => x.id === id), title = id === 'current' ? variantTitle(s) : variantTitle(s, v);
    if (!confirm(`Удалить вариант «${title}»? Его дни и вызывные листы пропадут. Остальные варианты останутся.`)) return;
    deleteVariant(p, id); store.touch(); rerender();
    toast(id === 'current' ? `Вариант удалён, открыт «${variantTitle(s)}»` : 'Вариант удалён');
  }
}

// ---------- правки ----------

const view = $('#view-schedule');
const dayOf = id => project().schedule.days.find(d => d.id === id);
function rerender(focus) { const y = view.scrollTop; renderSchedule(); view.scrollTop = y; if (focus) { const el = $(focus, view); if (el) { el.focus(); if (el.value !== undefined) el.setSelectionRange?.(el.value.length, el.value.length); } } }

// дату дня и порядок дней меняем, когда ушли из поля
view.addEventListener('focusout', e => {
  const t = e.target;
  if (t.matches && t.matches('[data-start]') && t.value !== t.defaultValue) {
    const n = datesFrom(project(), t.value); store.touch(); rerender();
    if (t.value) toast(n ? `Даты смен проставлены подряд с ${new Date(t.value + 'T12:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` : 'Даты уже стоят подряд');
    return;
  }
  if (!t.dataset || t.dataset.dayKey !== 'date' || t.value === t.defaultValue) return;
  const p = project(), d = dayOf(t.closest('[data-day]').dataset.day);
  if (t.value && p.schedule.days.some(x => x !== d && x.date === t.value)) {
    moveToDate(p, d.id, t.value); toast('На эту дату уже был день: они поменялись местами');
  } else { d.date = t.value; sortDays(p); }
  store.touch(); rerender();
});
view.addEventListener('keydown', e => {
  if (!e.target.matches('.sd-find')) return;
  if (e.key === 'Enter') { e.preventDefault(); findAt += e.shiftKey ? -1 : 1; const n = view.querySelectorAll('.strip.found').length; if (n) findAt = (findAt + n) % n; findScene(findQ); }
  if (e.key === 'Escape') { e.target.value = findQ = ''; findScene(''); }
});
view.addEventListener('input', e => {
  const t = e.target;
  if (t.matches('.sd-sq')) { side.q = t.value; rerender('.sd-sq'); }
  if (t.matches('.sd-find')) { findQ = t.value; findAt = 0; findScene(findQ); }
});
view.addEventListener('change', e => {
  const p = project(), t = e.target;
  // время сбора сохраняем сразу, без перерисовки: браузер шлёт «изменено» после каждой цифры
  if (t.dataset.dayKey) { if (t.dataset.dayKey !== 'date') { dayOf(t.closest('[data-day]').dataset.day)[t.dataset.dayKey] = t.value; store.touch(); } return; }
  if (t.dataset.side) { side[t.dataset.side] = t.value; if (t.dataset.side === 'sort') keep('miz:kpp-sort', t.value); rerender(); return; }
  if (t.dataset.info) { p.schedule.info[t.dataset.info] = t.value; store.touch(); return; }
  if (t.dataset.cast) {
    const char = t.closest('[data-char]').dataset.char;
    let row = p.schedule.cast.find(c => c.char.toUpperCase() === char);
    if (!row) { row = { id: uid(), char, actor: '', phone: '', busy: [] }; p.schedule.cast.push(row); }
    row[t.dataset.cast] = t.value.trim();
    store.touch();
    if (t.dataset.cast === 'phone') rerender(); // обновить ссылку «позвонить / написать»
  }
});

// найти сцену по номеру: прокрутить к ней и подсветить
let findQ = '', findAt = 0;
// подсвечивает все подходящие сцены, остальные приглушает, и прокручивает к текущей
function findScene(q, scroll = true) {
  const all = [...view.querySelectorAll('.strip[data-q]')], box = view.querySelector('.sd-findn');
  const on = !!q.trim();
  view.querySelector('.sd')?.classList.toggle('sd-searching', on);
  const hits = all.filter(el => { const ok = on && matches({ n: el.dataset.n }, el.dataset.q, q); el.classList.toggle('found', ok); el.classList.toggle('cur', false); return ok; });
  // дни и группы объектов без найденного тоже прячем
  for (const d of view.querySelectorAll('.sd-day')) d.classList.toggle('no-hit', on && !d.querySelector('.strip.found'));
  for (const h of view.querySelectorAll('.sd-obj, .sd-objhead')) { let n = h.nextElementSibling, any = false; while (n && !n.matches('.sd-obj, .sd-objhead')) { if (n.classList.contains('found')) any = true; n = n.nextElementSibling; } h.classList.toggle('no-hit', on && !any); }
  if (box) box.textContent = on ? (hits.length ? `${Math.min(findAt + 1, hits.length)} из ${hits.length}` : 'нет') : '';
  if (!hits.length) return;
  const cur = hits[findAt % hits.length];
  cur.classList.add('cur');
  if (scroll) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function editDur(btn) {
  const sid = btn.dataset.dur, inp = document.createElement('input');
  inp.className = 'st-dur-edit';
  inp.value = btn.textContent === '—' ? '' : btn.textContent;
  inp.placeholder = 'мм:сс';
  btn.replaceWith(inp);
  inp.focus(); inp.select();
  let done = false;
  const finish = save => { if (done) return; done = true; if (save) setDur(sid, inp.value); rerender(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
  inp.addEventListener('blur', () => finish(true));
}


// ---------- меню дня ----------
const ctx = $('#ctx');
let menuDay = '';
function dayMenu(btn) {
  const p = project(), d = dayOf(btn.closest('[data-day]').dataset.day), others = p.schedule.days.filter(x => x !== d);
  menuDay = d.id;
  ctx.dataset.kind = 'daymenu';
  ctx.innerHTML = `<h2>${d.kind === 'work' ? `Смена ${shiftNo(p, d)}` : DAY_KINDS[d.kind]}${d.date ? ` · ${esc(weekday(d.date))}` : ''}</h2><div class="menu">
    <div class="menu-row dm-kind"><span>Тип дня</span>${Object.entries(DAY_KINDS).map(([k, t]) => `<button data-kind="${k}" aria-pressed="${d.kind === k}">${t}</button>`).join('')}</div>
    <button data-dm="night">${d.night ? 'Сделать дневной сменой' : 'Ночная смена'}<small>ночная выделяется тёмным</small></button>
    <button data-dm="lock">${d.locked ? 'Снять фиксацию' : 'Зафиксировать день'}<small>${d.locked ? 'снова можно менять' : 'защита от случайных правок'}</small></button>
    <div class="menu-row"><span>Перенести на</span><input type="date" data-dm-date value="${esc(d.date)}"><button data-dm="move">ОК</button></div>
    ${others.length ? `<div class="menu-row"><span>Поменять с</span><select data-dm-swap>${others.map(x => `<option value="${x.id}">${x.kind === 'work' ? `Смена ${shiftNo(p, x)}` : DAY_KINDS[x.kind]}${x.date ? `, ${esc(weekday(x.date))}` : ''}</option>`).join('')}</select><button data-dm="swap">ОК</button></div>` : ''}
    <button data-dm="note">Комментарий к смене<small>виден в КПП и в вызывном</small></button>
    <button data-dm="clear">Очистить день<small>сцены вернутся на боковой стол</small></button>
    <button data-dm="remove" class="dm-del">Удалить день<small>сцены вернутся на боковой стол</small></button></div>`;
  ctx.classList.add('on');
  const r = btn.getBoundingClientRect();
  ctx.style.left = Math.max(8, Math.min(r.right - ctx.offsetWidth, innerWidth - ctx.offsetWidth - 8)) + 'px';
  ctx.style.top = Math.max(8, Math.min(r.bottom + 4, innerHeight - ctx.offsetHeight - 8)) + 'px';
}
ctx.addEventListener('click', async e => {
  if (ctx.dataset.kind !== 'daymenu') return;
  const p = project(), d = dayOf(menuDay), b = e.target.closest('button');
  if (!b || !d) return;
  const close = () => ctx.classList.remove('on');
  if (b.dataset.kind) { d.kind = b.dataset.kind; close(); store.touch(); rerender(); return; }
  const act = b.dataset.dm;
  if (!act) return;
  if (d.locked && !['lock', 'note'].includes(act)) { toast('День зафиксирован: сначала снимите фиксацию'); return; }
  close();
  if (act === 'night') d.night = !d.night;
  if (act === 'lock') d.locked = !d.locked;
  if (act === 'move') {
    const date = ctx.querySelector('[data-dm-date]').value;
    if (!date || date === d.date) return;
    toast(moveToDate(p, d.id, date) === 'swap' ? 'На эту дату был день: они поменялись местами' : 'Смена перенесена');
  }
  if (act === 'swap') { swapDays(p, d.id, ctx.querySelector('[data-dm-swap]').value); toast('Дни поменялись местами'); }
  if (act === 'note') {
    const text = await ask('Комментарий к смене', { text: 'Виден в КПП под днём и в вызывном листе.', value: d.kppNote || '', placeholder: 'Например: посмотреть БЦ, АМС 3', ok: 'Сохранить' });
    if (text === null) return;
    d.kppNote = text.trim();
  }
  if (act === 'clear') { if (d.items.length && !confirm('Убрать все сцены дня на боковой стол?')) return; d.items = []; }
  if (act === 'remove') { if (d.items.length && !confirm('Удалить день? Его сцены вернутся на боковой стол, вызывной лист дня пропадёт.')) return; p.schedule.days = p.schedule.days.filter(x => x !== d); }
  store.touch(); rerender();
});
document.addEventListener('pointerdown', e => { if (ctx.dataset.kind === 'daymenu' && ctx.classList.contains('on') && !ctx.contains(e.target)) ctx.classList.remove('on'); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape' && ctx.dataset.kind === 'daymenu') ctx.classList.remove('on'); });

view.addEventListener('click', async e => {
  const p = project(), sch = p.schedule;
  const du = e.target.closest('[data-dur]');
  if (du && !du.disabled) { editDur(du); return; }
  const f = e.target.closest('[data-filter]');
  if (f) { filter = f.dataset.filter; rerender(); return; }
  const m = e.target.closest('[data-mode]');
  if (m) { mode = m.dataset.mode; keep('miz:kpp-mode', mode); rerender(); return; }
  const vb = e.target.closest('[data-vnew], [data-vopen], [data-vrename], [data-vdel]');
  if (vb) { variantAction(vb); return; }
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'day-menu') { dayMenu(b); return; }
  if (act === 'sides') { openSides(b.closest('[data-day]').dataset.day); return; }
  if (act === 'kpp-pdf' || act === 'kpp-xlsx') { exportKPP(p, act === 'kpp-pdf' ? 'pdf' : 'xlsx'); return; }
  if (act === 'add-day') {
    sch.days.push({ id: 'day-' + uid(), date: nextDate(p), call: '08:00', wrap: '', lunch: '', weather: '', note: '', items: [], times: {}, kind: 'work', night: false, locked: false });
    if (sch.info.start) datesFrom(p, sch.info.start);
    normalizeSchedule(p, uid);
    store.touch(); rerender();
    toast(`Добавлена смена ${sch.days.filter(d => d.kind === 'work').length}`);
  }
  if (act === 'banner') {
    const text = await ask('Плашка в дне', { text: 'Например: «Обед», «Переезд на тропинку», «Ждём режим».', placeholder: 'Текст плашки', ok: 'Добавить' });
    if (!text || !text.trim()) return;
    dayOf(b.closest('[data-day]').dataset.day).items.push({ id: uid(), type: 'banner', text: text.trim() });
    store.touch(); rerender();
  }
  if (act === 'del-banner') {
    for (const d of sch.days) d.items = d.items.filter(x => x.id !== b.dataset.item);
    store.touch(); rerender();
  }
});

// ---------- перетаскивание полос ----------
// Своё перетаскивание мышью: пока полоса «в руке», страница листается колёсиком и сама едет у края окна.
const zoneAt = (x, y) => document.elementFromPoint(x, y)?.closest('#view-schedule [data-drop]') || null;
// куда встанет полоса: перед той, над серединой которой мышь, или после последней
function dropSpot(y, zone) {
  if (zone.dataset.drop === 'side') return { before: null };
  const strips = [...zone.querySelectorAll('.sd-strips [data-drag]')].filter(x => !x.classList.contains('drag-src'));
  const before = strips.find(x => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null;
  return { before, last: strips[strips.length - 1] || null };
}
// куда встанет перетаскиваемая смена: перед днём, над серединой которого мышь
function daySpot(y) {
  const days = [...view.querySelectorAll('.sd-days > .sd-day')].filter(x => !x.classList.contains('drag-src'));
  return { before: days.find(x => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; }) || null, last: days[days.length - 1] || null };
}
const MARKS = ['drop-here', 'drop-before', 'drop-after'];
const unmark = () => { for (const c of MARKS) for (const x of view.querySelectorAll('.' + c)) x.classList.toggle(c, false); };
pointerDrag(view, {
  pick(e) {
    const g = !e.target.closest('input, button, a, label, select') && e.target.closest('[data-daydrag]');
    if (g) return { el: g.closest('.sd-day'), data: 'day:' + g.dataset.daydrag };
    const el = e.target.closest('[data-drag]');
    if (!el || e.target.closest('input') || e.shiftKey || e.ctrlKey || e.metaKey) return null; // с Shift/Ctrl — выбор, а не перенос
    // взяли выбранную полосу — едут все выбранные (в том порядке, как стоят на экране)
    if (chosen.has(el.dataset.drag) && chosen.size > 1) {
      const keys = [...view.querySelectorAll('[data-drag]')].map(x => x.dataset.drag).filter(k => chosen.has(k));
      el.dataset.count = keys.length;
      return { el, data: 'multi:' + keys.join(',') };
    }
    return { el, data: el.dataset.drag };
  },
  ghost(el, data, r) {
    if (!data.startsWith('multi:')) return null;
    const keys = data.slice(6).split(','), els = [el, ...keys.map(k => view.querySelector(`[data-drag="${k}"]`)).filter(x => x && x !== el)];
    return stackGhost(els, keys.length, r);
  },
  move(data, x, y) {
    unmark();
    if (data.startsWith('day:')) { const t = daySpot(y); if (t.before) t.before.classList.add('drop-before'); else if (t.last) t.last.classList.add('drop-after'); return; }
    const zone = zoneAt(x, y);
    if (!zone) return;
    zone.classList.add('drop-here');
    const { before, last } = dropSpot(y, zone);
    if (mode === 'objects') return; // в виде «по объектам» сцена встаёт в конец дня
    if (before) before.classList.add('drop-before'); else if (last) last.classList.add('drop-after');
  },
  drop(dragging, x, y) {
    if (dragging.startsWith('day:')) {
      const p = project(), { before } = daySpot(y);
      if (moveShift(p, dragging.slice(4), before ? before.dataset.day : '')) { store.touch(); rerender(); toast('Смены переставлены: даты и номера пересчитаны'); }
      return;
    }
    const zone = zoneAt(x, y);
    if (!zone) return;
    if (dragging.startsWith('multi:')) { dropMany(dragging.slice(6).split(','), zone, y); return; }
    const p = project(), sch = p.schedule, [kind, id] = dragging.split(':');
    const { before } = dropSpot(y, zone);
    // вынимаем перетаскиваемое оттуда, где оно было
    let items = [];
    if (kind === 'item') { for (const d of sch.days) { const i = d.items.findIndex(x2 => x2.id === id); if (i >= 0) { if (d.locked) return; items = d.items.splice(i, 1); break; } } }
    else if (kind === 'banner') items = [{ id: uid(), type: 'banner', text: dragging.slice(7) }];
    else if (kind === 'obj') { const info = sceneInfo(p); items = freeScenes(p, info).filter(s => objectOf(p, s).key === id).map(s => ({ id: uid(), type: 'scene', sceneId: s.id })); }
    else items = [{ id: uid(), type: 'scene', sceneId: id }];
    if (zone.dataset.drop !== 'side' && items.length) {
      const d = dayOf(zone.dataset.drop);
      const bid = mode === 'order' && before && before.dataset.drag.startsWith('item:') ? before.dataset.drag.slice(5) : '';
      const at = bid ? d.items.findIndex(x2 => x2.id === bid) : -1;
      if (at >= 0) d.items.splice(at, 0, ...items); else d.items.push(...items);
      if (kind === 'obj') toast(`Поставлено сцен: ${items.length}`);
    }
    store.touch(); rerender();
  },
  end() { unmark(); for (const x of view.querySelectorAll('[data-count]')) delete x.dataset.count; },
});

// ---------- выбор нескольких сцен: Shift/Ctrl+щелчок и рамка ----------
// Shift или Ctrl со щелчком по полосе добавляет её к выбору (или убирает). Рамка с пустого места выбирает
// всё, что задела (с Shift/Ctrl — добавляет). Щелчок по пустому месту или Escape снимает выбор.
// Выбранные полосы переносятся вместе: в день (встают подряд) или обратно на стол.
let chosen = new Set();
function markChosen() {
  for (const x of view.querySelectorAll('[data-drag]')) x.classList.toggle('sel', chosen.has(x.dataset.drag));
  const n = view.querySelector('.sd-chosen');
  if (n) n.remove();
  if (chosen.size) {
    const bar = document.createElement('div');
    bar.className = 'sd-chosen';
    bar.innerHTML = `Выбрано сцен: <b>${chosen.size}</b> — перетащите любую из них <button class="linkbtn" data-act="unchoose">снять выбор</button>`;
    view.append(bar);
  }
}
const chooseKey = el => el.dataset.drag;
const choosable = el => el && el.matches('[data-drag]') && !el.dataset.drag.startsWith('obj:') && !el.dataset.drag.startsWith('banner:');
view.addEventListener('click', e => {
  if (e.target.closest('[data-act="unchoose"]')) { e.preventDefault(); e.stopPropagation(); chosen.clear(); markChosen(); return; }
  const el = e.target.closest('[data-drag]');
  if (!choosable(el)) return;
  const add = e.shiftKey || e.ctrlKey || e.metaKey;
  if (!add && e.target.closest('button, a, input')) return; // номер сцены и кнопки работают как раньше
  e.preventDefault(); e.stopPropagation();
  const k = chooseKey(el);
  if (add) { if (chosen.has(k)) chosen.delete(k); else chosen.add(k); }
  else if (chosen.size === 1 && chosen.has(k)) chosen.clear(); // второй щелчок по той же — снять
  else chosen = new Set([k]);
  markChosen();
}, true);
addEventListener('keydown', e => { if (e.key === 'Escape' && chosen.size && document.body.dataset.view === 'schedule') { chosen.clear(); markChosen(); } });

let band = null;
view.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('[data-drag], [data-daydrag], button, a, input, select, label, textarea, [contenteditable], .sd-chosen')) return;
  band = { x: e.clientX, y: e.clientY, add: e.shiftKey || e.ctrlKey || e.metaKey, base: new Set(chosen), el: null, moved: false };
});
addEventListener('pointermove', e => {
  if (!band) return;
  const x1 = Math.min(band.x, e.clientX), y1 = Math.min(band.y, e.clientY), x2 = Math.max(band.x, e.clientX), y2 = Math.max(band.y, e.clientY);
  if (!band.moved && x2 - x1 < 5 && y2 - y1 < 5) return;
  band.moved = true;
  if (!band.el) { band.el = document.createElement('div'); band.el.className = 'stash-band'; document.body.append(band.el); document.body.classList.add('banding'); getSelection()?.removeAllRanges(); }
  Object.assign(band.el.style, { left: x1 + 'px', top: y1 + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
  for (const el of view.querySelectorAll('[data-drag]')) {
    if (!choosable(el)) continue;
    const r = el.getBoundingClientRect(), hit = r.width && r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2;
    el.classList.toggle('sel', hit || (band.add && band.base.has(chooseKey(el))));
  }
});
addEventListener('pointerup', () => {
  if (!band) return;
  const b = band; band = null;
  if (b.el) b.el.remove();
  document.body.classList.remove('banding');
  if (!b.moved) { if (!b.add && chosen.size) { chosen.clear(); markChosen(); } return; }
  chosen = new Set(b.add ? b.base : []);
  for (const el of view.querySelectorAll('[data-drag].sel')) chosen.add(chooseKey(el));
  markChosen();
});

// пачку — в день (подряд, на место, куда указали) или на стол (снять с дней)
function dropMany(keys, zone, y) {
  const p = project(), sch = p.schedule, moving = new Set(keys);
  if (keys.some(k => k.startsWith('item:') && sch.days.some(d => d.locked && d.items.some(x => 'item:' + x.id === k)))) return toast('В закреплённом дне сцены не двигаются — откройте замок');
  // куда вставлять: перед полосой под мышью, если она не из пачки (иначе — перед следующей не из пачки)
  let bid = '';
  if (zone.dataset.drop !== 'side' && mode === 'order') {
    const strips = [...zone.querySelectorAll('.sd-strips [data-drag]')];
    const i = strips.findIndex(x => { const r = x.getBoundingClientRect(); return y < r.top + r.height / 2; });
    const t = i >= 0 ? strips.slice(i).find(x => !moving.has(x.dataset.drag)) : null;
    bid = t && t.dataset.drag.startsWith('item:') ? t.dataset.drag.slice(5) : '';
  }
  const items = [];
  for (const k of keys) {
    const [kind, id] = k.split(':');
    if (kind === 'item') { for (const d of sch.days) { const i = d.items.findIndex(x => x.id === id); if (i >= 0) { items.push(...d.items.splice(i, 1)); break; } } }
    else if (kind === 'scene') items.push({ id: uid(), type: 'scene', sceneId: id });
  }
  if (zone.dataset.drop !== 'side') {
    const d = dayOf(zone.dataset.drop), at = bid ? d.items.findIndex(x => x.id === bid) : -1;
    if (at >= 0) d.items.splice(at, 0, ...items); else d.items.push(...items);
    toast(`Перенесено сцен: ${items.filter(x => x.type === 'scene').length}`);
  } else toast(`Сняты с дней: ${items.filter(x => x.type === 'scene').length}`);
  chosen.clear();
  store.touch(); rerender();
}

document.addEventListener('miz:scene-changed', () => { if (document.body.dataset.view === 'schedule') rerender(); });

// ---------- вставить день между днями ----------
let gapAt = -1;
view.addEventListener('click', e => {
  const g = e.target.closest('[data-gap]');
  if (!g) return;
  e.stopPropagation();
  gapAt = +g.dataset.gap;
  ctx.dataset.kind = 'gapmenu';
  ctx.innerHTML = `<h2>Вставить день</h2><div class="menu">${Object.entries(DAY_KINDS).map(([k, t]) => `<button data-gapkind="${k}">${k === 'work' ? 'Съёмочная смена' : t}</button>`).join('')}</div>`;
  ctx.classList.add('on');
  const r = g.getBoundingClientRect();
  ctx.style.left = Math.max(8, Math.min(r.left + r.width / 2 - ctx.offsetWidth / 2, innerWidth - ctx.offsetWidth - 8)) + 'px';
  ctx.style.top = Math.max(8, Math.min(r.bottom + 4, innerHeight - ctx.offsetHeight - 8)) + 'px';
});
ctx.addEventListener('click', e => {
  const b = e.target.closest('[data-gapkind]');
  if (!b || ctx.dataset.kind !== 'gapmenu') return;
  ctx.classList.remove('on');
  const p = project(), sch = p.schedule, kind = b.dataset.gapkind;
  sch.days.splice(gapAt, 0, { id: 'day-' + uid(), date: '', call: '08:00', wrap: '', lunch: '', weather: '', note: '', items: [], times: {}, kind, night: false, locked: false });
  // даты подряд от первого дня: всё после вставленного сдвигается на день
  if (sch.info.start) datesFrom(p, sch.info.start);
  normalizeSchedule(p, uid);
  store.touch(); rerender();
  toast(`Вставлен ${kind === 'work' ? 'съёмочный день' : DAY_KINDS[kind].toLowerCase() + ' день'}${sch.info.start ? ': даты после него сдвинулись' : ''}`);
});
document.addEventListener('pointerdown', e => { if (ctx.dataset.kind === 'gapmenu' && ctx.classList.contains('on') && !ctx.contains(e.target)) ctx.classList.remove('on'); }, true);

// своя плашка на столе
view.addEventListener('keydown', e => {
  if (!e.target.matches('.sd-bnadd') || e.key !== 'Enter') return;
  const t = e.target.value.trim();
  if (!t) return;
  const info = project().schedule.info;
  info.banners = [...(info.banners || []), t];
  store.touch(); rerender('.sd-bnadd');
});
