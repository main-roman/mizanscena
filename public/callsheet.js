// Вызывной лист на съёмочный день — конструктор из блоков.
// Блоки и ячейки смены перетаскиваются, убираются и возвращаются; всё, что известно из КПП, сцен, разбора,
// локаций и солнца, заполняется само, а правки в плане и в таблице актёров касаются только этого вызывного
// (кроме имени актёра и адреса локации — они общие для проекта).
import { store, $, uid, esc, toast, printHTML, safeName, objKey, setObjectGeo, setObjectBase, setObjectField } from './store.js';
import { CATS, sceneInfo, sceneItems, locationFromScene } from './breakdown.js';
import { pointerDrag } from './dragsort.js';
import { locate, weatherFor } from './weather.js';
import { castList, dayInfo, guessDept, objectOf, lunchEndOf, autoTimes, moveToDate, shiftNo, busyOn, DAY_KINDS, contactLink, CONTACT_PH, synopsisOf, sceneMeta, clockText, timeline, BLOCKS, SHIFT_CELLS, DEFAULT_DEPTS, DEFAULT_TRANSPORT } from './schedmodel.js';

const project = () => store.project;
let openId = '';

const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>';
const longDate = d => { if (!d) return 'дата не назначена'; const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };
const mapUrl = geo => /^https?:\/\//i.test(geo) ? geo : `https://yandex.ru/maps/?text=${encodeURIComponent(geo)}`;
const title = s => s ? s.charAt(0) + s.slice(1).toLowerCase() : '';
const DEPTS = ['props', 'costume', 'makeup', 'vehicles', 'animals', 'stunts', 'sfx'];
const CREW_ROLES = ['Режиссёр', 'Второй режиссёр', 'Оператор-постановщик', 'Художник-постановщик', 'Продюсер', 'Директор съёмочной группы', 'Звукорежиссёр', 'Гаффер', 'Художник по костюму', 'Художник по гриму', 'Художник по реквизиту', 'Скрипт-супервайзер', 'Ассистент по актёрам'];
const CAST_T = [['car', 'Машина за актёром'], ['arrive', 'Прибытие'], ['costume', 'Костюм'], ['makeup', 'Грим'], ['ready', 'Готовность'], ['end', 'Конец смены']];
const PLAN_COLS = [['n', '№, хрон'], ['reg', 'Режим / инт-нат'], ['obj', 'Объект и синопсис'], ['who', 'Персонажи / массовка'], ['what', 'Реквизит / грим / костюм'], ['note', 'Примечание']];

// ---------- поля ввода (на экране) и текст (в PDF); пустое остаётся пустым ----------
function mk(edit) {
  const val = v => esc(v || '');
  return {
    f: (obj, src, key, ph = '', type = 'text') => edit ? `<input type="${type}" data-obj="${obj}" data-key="${key}" value="${esc(src[key] || '')}" placeholder="${esc(ph)}">` : val(src[key]),
    area: (key, src, ph) => edit ? `<textarea data-obj="day" data-key="${key}" rows="2" placeholder="${esc(ph)}">${esc(src[key] || '')}</textarea>` : (String(src[key] || '').trim() ? `<p class="cs-note">${val(src[key]).replace(/\n/g, '<br>')}</p>` : ''),
    cell: (list, id, field, v, ph = '', type = 'text') => edit ? `<input type="${type}" data-list="${list}" data-row="${id}" data-field="${field}" value="${esc(v || '')}" placeholder="${esc(ph)}">` : val(v),
    t: (map, key, field, v) => edit ? `<input type="time" data-map="${map}" data-mkey="${esc(key)}" data-field="${field}" value="${esc(v || '')}">` : val(v),
    // время по плану дня (серое) или вписанное руками (красное, в подсказке — плановое)
    at: (map, key, field, own, auto) => {
      const v = own || auto || '';
      if (!edit) return esc(v);
      const cls = own && auto && own !== auto ? ' class="t-own" title="По плану дня: ' + auto + '. Сотрите, чтобы вернуть"' : !own && auto ? ' class="t-auto" title="Посчитано по плану дня"' : '';
      return `<input type="time" data-map="${map}" data-mkey="${esc(key)}" data-field="${field}" value="${esc(v)}"${cls}>`;
    },
  };
}
const grip = (edit, what) => edit && what.startsWith('row:') ? `<span class="cs-grip" data-dnd="${what}" title="Перетащить">${GRIP}</span>` : '';

// ---------- блоки ----------
const B = {
  shift(c) {
    const { p, day, di, e, edit } = c, sch = p.schedule;
    const sunAuto = di.sun ? `восход ${di.sun.sunrise} · закат ${di.sun.sunset}` : '';
    const CELL = {
      call: () => e.f('day', day, 'call', '10:00', 'time'), motor: () => e.f('day', day, 'motor', '10:30', 'time'),
      stop: () => e.f('day', day, 'stop', '22:00', 'time'),
      // обед: начало и конец; если конец не вписан — через час
      lunch: () => { const end = lunchEndOf(day); return edit ? `<span class="cs-lunch">${e.f('day', day, 'lunch', '13:00', 'time')}<i>–</i><input type="time" data-obj="day" data-key="lunchEnd" value="${esc(end)}" title="${day.lunchEnd ? 'Конец обеда' : 'Обед — час. Поставьте своё время конца, если дольше или короче'}"${day.lunchEnd ? '' : ' class="t-auto"'}></span>` : day.lunch ? `${esc(day.lunch)}–${esc(end)}` : ''; },
      director: () => e.f('info', sch.info, 'director', 'Имя'), ad: () => e.f('info', sch.info, 'ad', 'Имя'),
      producer: () => e.f('info', sch.info, 'producer', 'Имя'), phone: () => e.f('info', sch.info, 'phone', CONTACT_PH),
      chron: () => `<span class="cs-chron"><span><i>Хрон дня</i><b>${di.dur ? clockText(di.dur) : '—'}</b></span><span><i>Сцен</i><b>${di.scenes.length || '—'}</b></span></span>`,
      chronT: () => di.dur ? clockText(di.dur) : '—', scenesN: () => String(di.scenes.length || '—'),
      weather: () => { const w = wx(day); return edit ? `<input type="text" data-obj="day" data-key="weather" value="${esc(day.weather)}" placeholder="${esc(w ? w.text : 'Облачно с прояснениями')}"${w && !day.weather ? ' title="По прогнозу Open-Meteo. Впишите своё, если нужно"' : ''}>${w && !day.weather ? '<small>по прогнозу</small>' : ''}` : esc(day.weather || (w ? w.text : '')); },
      temp: () => { const w = wx(day), td = day.tDay || (w ? w.day : ''), tn = day.tNight || (w ? w.night : '');
        return edit ? `<span class="cs-pair">${`<input type="text" data-obj="day" data-key="tDay" value="${esc(day.tDay)}" placeholder="${esc(w ? w.day : '+22')}">`}${`<input type="text" data-obj="day" data-key="tNight" value="${esc(day.tNight)}" placeholder="${esc(w ? w.night : '+18')}">`}</span>`
          : td || tn ? `<span class="cs-pair">${esc(td)} / ${esc(tn)}</span>` : ''; },
      // солнце: само по координатам локации и дате; можно вписать своё
      sun: () => edit ? `<input type="text" data-obj="day" data-key="sun" value="${esc(day.sun)}" placeholder="${esc(sunAuto || 'восход 05:17 · закат 19:49')}">${di.sun && !day.sun ? `<small>сумерки ${di.sun.dawn}–${di.sun.dusk}</small>` : ''}`
        : esc(day.sun || sunAuto) + (di.sun && !day.sun ? `<small>сумерки ${di.sun.dawn}–${di.sun.dusk}</small>` : ''),
    };
    const shown = sch.info.shiftCells.filter(x => x.on);
    const hidden = sch.info.shiftCells.filter(x => !x.on);
    const label = x => /^c-/.test(x.id) ? (edit ? `<input class="cs-cell-label" data-celllabel="${x.id}" value="${esc(x.label)}">` : esc(x.label)) : x.id === 'chron' ? '' : SHIFT_CELLS.find(q => q[0] === x.id)[1];
    const KEY = ['call', 'motor', 'stop', 'chron']; // главное о смене — крупно
    const value = x => /^c-/.test(x.id) ? (edit ? `<input type="text" data-cell="${x.id}" value="${esc(day.cells[x.id] || '')}">` : esc(day.cells[x.id] || '')) : CELL[x.id]();
    const keys = shown.filter(x => KEY.includes(x.id));
    const hide = x => edit ? `<button class="ico cs-cx" data-hidecell="${x.id}" title="Убрать ячейку" aria-label="Убрать ячейку">${X}</button>` : '';
    const rest = shown.filter(x => !KEY.includes(x.id)).map(x => ({ x, v: value(x) }))
      .filter(q => edit || q.v.replace(/<[^>]*>/g, '').replace(/[\s\/·]/g, '')); // в PDF пустые ячейки не печатаются
    const cols = rest.length <= 4 ? Math.max(rest.length, 1) : Math.min(4, Math.ceil(rest.length / Math.ceil(rest.length / 4))), left = rest.length % cols;
    const grid = rest.length ? `<div class="cs-grid cs-grid-fixed" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr))">${rest.map((q, k) => `<div${left && k === rest.length - 1 ? ` style="grid-column: span ${cols - left + 1}"` : ''}><span>${label(q.x)}${hide(q.x)}</span>${q.v}</div>`).join('')}</div>` : '';
    // начало, мотор, стоп-мотор, хрон — в одной полосе под шапкой листа
    c.keyCells = keys.flatMap(x => x.id === 'chron'
      ? [{ id: 'chron', label: 'Хрон дня', value: CELL.chronT(), hide: hide(x), ro: true }, { id: 'scenes', label: 'Сцен', value: CELL.scenesN(), hide: '', ro: true }]
      : [{ id: x.id, label: label(x), value: value(x), hide: hide(x) }]);
    return '<!--locs-->' + grid + `
      ${edit ? `<div class="cs-add"><select data-addcell><option value="">+ ячейка…</option>${hidden.map(x => `<option value="${x.id}">${esc(/^c-/.test(x.id) ? x.label : SHIFT_CELLS.find(q => q[0] === x.id)[1])}</option>`).join('')}<option value="new">Своя ячейка</option></select></div>` : ''}`;
  },
  crew(c) {
    const { p, e, edit } = c, list = p.schedule.info.crew.filter(r => r.lead);
    if (!edit) {
      const named = list.filter(r => r.name.trim());
      return named.length ? `<div class="cs-list cs-crewlist${named.length > 4 ? ' two' : ''}">${named.map(r => `<div class="cs-li"><span class="cs-role">${esc(r.role)}</span><b>${esc(r.name)}</b></div>`).join('')}</div>` : '';
    }
    return `<table class="cs-table cs-two"><tbody>${list.map(r => `<tr><td>${e.cell('crew', r.id, 'role', r.role, 'Должность')}</td><td>${e.cell('crew', r.id, 'name', r.name, 'Имя и фамилия')}</td>${edit ? `<td class="cs-x"><button class="ico" data-del="crew" data-row="${r.id}" aria-label="Убрать строку">${X}</button></td>` : ''}</tr>`).join('')}</tbody></table>
      ${edit ? `<div class="cs-add"><button class="linkbtn" data-add="crew">+ строка</button>${list.length ? '' : ' · <button class="linkbtn" data-fill="crew">заполнить обычными должностями</button>'} · <a class="linkbtn" href="#/p/${p.id}/crew">вся группа</a></div>${crewPicker(p)}<p class="page-hint">Здесь руководители из страницы «Группа» с галочкой «В вызывном»; их телефоны — в «Группе». Забытого человека перетащите из списка «Из группы» в таблицу или щёлкните по нему. Крестик убирает человека только из вызывного.</p>` : ''}`;
  },
  depts(c) { return timedList(c, 'depts', DEFAULT_DEPTS, 'Цех'); },
  transport(c) { return timedList(c, 'transport', DEFAULT_TRANSPORT, 'Машина'); },
  meet(c) {
    const { p, day, di, edit } = c, def = meetPlace(p, { meet: '' }, di), place = day.meet || def, time = day.meetTime || day.call;
    // ссылка на Яндекс Карты: своё место сбора или адрес объекта первой сцены
    const first = di.locs.find(l => l.geo), geo = day.meet.trim() || (first ? first.geo : '');
    const isUrl = /^https?:/i.test(geo), href = geo ? mapUrl(geo) : '';
    const shown = day.meet.trim() ? (isUrl ? 'Метка на карте' : day.meet) : place;
    if (!edit && !time && !place && !day.meetNote) return '';
    return `<div class="cs-meetrow">
      <b class="cs-meet-t">${edit ? `<input type="time" data-obj="day" data-key="meetTime" value="${esc(day.meetTime || day.call)}" title="${day.meetTime ? 'Время сбора группы' : 'Пока не вписано — по началу смены'}"${day.meetTime ? '' : ' class="t-auto"'}>` : esc(time || '')}</b>
      ${edit ? `<input type="text" class="cs-meet-p" data-obj="day" data-key="meet" value="${esc(day.meet)}" placeholder="${esc(def || 'Место сбора')}" title="Пока не вписано своё — адрес объекта первой сцены">
        ${href ? `<a class="act cs-meet-map" href="${esc(href)}" target="_blank" rel="noopener" title="Открыть место сбора в Яндекс Картах">На карте</a>` : ''}
        <input type="text" class="cs-meet-n" data-obj="day" data-key="meetNote" value="${esc(day.meetNote)}" placeholder="Примечание: где встречаемся, что взять">`
        : `${href ? `<a class="cs-meet-p" href="${esc(href)}" target="_blank" rel="noopener">${esc(shown || 'Метка на карте')}</a>` : `<span class="cs-meet-p">${esc(shown || '')}</span>`}${day.meetNote ? `<span class="cs-meet-n">${esc(day.meetNote)}</span>` : ''}`}</div>`;
  },
  locs(c) {
    const { p, di, edit } = c;
    const groups = [];
    const group = (key, name) => { let g = groups.find(x => x.k === key); if (!g) groups.push(g = { k: key, name, locs: [], loose: [] }); return g; };
    for (const l of di.locs) group(objKey(l.object), l.object || l.name).locs.push(l);
    // сцены без локации: каждое место из шапки — своим объектом; адрес можно вписать сразу, локация заведётся сама
    for (const s of di.scenes.filter(s => !di.locs.some(l => l.sceneIds.includes(s.id)) && s.ie)) { const o = objectOf(p, s); group(objKey(o.name), o.name).loose.push({ s, sub: o.sub }); }
    if (!groups.length) return edit ? '<p class="empty">В этом дне нет сцен с местом съёмки.</p>' : '';
    const sc = l => di.scenes.filter(s => l.sceneIds.includes(s.id)).map(s => s.n).join(', ');
    const card = g => {
      // адрес, база и примечание — со всего объекта, даже если в этой смене снимается только одна его комната
      const first = g.locs[0], all = p.locations.filter(l => objKey(l.object) === g.k), val = k => (all.find(l => (l[k] || '').trim()) || first || {})[k] || '';
      const geo = val('geo'), base = val('base'), hint = val('hint');
      // поле карточки: у заведённой локации — по её id, у места без локации — по сценам (локация создастся при вводе)
      const ref = first ? `data-objloc="${first.id}"` : `data-objscenes="${g.loose.map(x => x.s.id).join(',')}"`;
      const field = (k, v, ph, cls = '') => `<input type="text" class="${cls}" ${ref} data-objf="${k}" value="${esc(v)}" placeholder="${ph}">`;
      // без подобъекта — только номера сцен, название объекта уже в заголовке карточки
      const chip = (sub, n) => `<span>${sub ? `<b>${esc(sub)}</b> ` : ''}сц. ${n}</span>`;
      const chips = [...g.locs.map(l => chip(l.sub, sc(l))), ...g.loose.map(x => chip(x.sub, x.s.n))];
      return `<div class="cs-loc"><b class="cs-loc-name">${esc(g.name)}</b>
        ${edit ? field('geo', geo, 'Адрес или ссылка на карту') : ''}
        ${geo ? `<a href="${esc(mapUrl(geo))}" target="_blank" rel="noopener">${esc(edit ? 'На карте' : /^https?:/i.test(geo.trim()) ? 'Метка на карте' : geo)}</a>` : ''}
        <div class="cs-subchips">${chips.join('')}</div>
        ${edit ? field('base', base, 'База группы, парковка', 'cs-base-in') + field('hint', hint, 'Примечание: вход, ключи, что важно на объекте', 'cs-base-in') : `${base.trim() ? `<p class="cs-base"><span>База, парковка</span>${esc(base)}</p>` : ''}${hint.trim() ? `<p class="cs-base"><span>Примечание</span>${esc(hint)}</p>` : ''}`}</div>`;
    };
    return `<div class="cs-locs">${groups.map(card).join('')}</div>
      ${edit ? '<p class="page-hint">Адрес, база и примечание общие для объекта. Для места без локации она заведётся сама, как только вы что-то впишете.</p>' : ''}`;
  },
  plan(c) {
    const { p, day, info } = c, rows = timeline(p, day, info), edit = c.edit && !day.locked;
    if (!rows.length) return '<p class="empty">В этом дне пока нет сцен.</p>';
    let total = 0;
    // значение ячейки: своё для этого вызывного или собранное из проекта
    const cellOf = (r, col, html) => {
      const own = (day.plan[r.item.id] || {})[col];
      const shown = own !== undefined ? esc(own).replace(/\n/g, '<br>') : html;
      return edit ? `<div class="cs-ed${own !== undefined ? ' own' : ''}" contenteditable="true" data-pe="${r.item.id}|${col}">${shown}</div>` : shown;
    };
    const tr = rows.map(r => {
      total += r.min;
      const min = edit ? `<span class="cs-minw"><input type="number" min="0" step="5" class="cs-min" data-min="${r.item.id}" value="${r.min}" title="Минут на эту строку"> мин</span>` : `${r.min} мин`;
      const time = `<td class="cs-time">${grip(edit, 'row:' + r.item.id)}${r.start}–${r.end}<small>${min}</small></td>`; // в зафиксированном дне план не правится
      if (r.auto) return `<tr class="cs-banner cs-lunchrow"><td class="cs-time">${r.start}–${r.end}<small>${r.min} мин</small></td><td colspan="6">Обед${edit ? '<small>по ячейке «Обед»: время и длина меняются там</small>' : ''}</td></tr>`;
      if (!r.scene) return `<tr class="cs-banner" data-target="row:${r.item.id}">${time}<td colspan="6">${edit ? `<input data-banner="${r.item.id}" value="${esc(r.item.text)}">` : esc(r.item.text)}${edit ? `<button class="ico cs-bx" data-delbanner="${r.item.id}" aria-label="Убрать строку">${X}</button>` : ''}</td></tr>`;
      const s = r.scene, it = sceneItems(p, s.id, info);
      const auto = {
        n: `<b>${s.n}</b><small>${esc(s.dur || '')}</small>`,
        reg: `${esc(title(s.time))}<small>${esc(title(s.ie))}</small>`,
        obj: `${(() => { const o = objectOf(p, s); return o.name ? `<b>${esc(o.name)}</b>${o.sub ? `<span class="cs-sub">${esc(o.sub)}</span>` : ''}` : `<b>${esc(s.place || s.text)}</b>`; })()}${synopsisOf(p, s) ? `<small>${esc(synopsisOf(p, s))}</small>` : ''}`,
        who: [s.chars.length ? `Персонажи: ${s.chars.map(title).join(', ')}` : '', it.extras.length ? `Массовка: ${it.extras.map(esc).join(', ')}` : ''].filter(Boolean).join('<br>'),
        what: [['Реквизит', it.props], ['Грим', it.makeup], ['Костюм', it.costume]].filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.map(esc).join(', ')}`).join('<br>'),
        note: esc(sceneMeta(p, s.id).note),
      };
      const changed = day.plan[r.item.id] && Object.keys(day.plan[r.item.id]).length;
      return `<tr data-target="row:${r.item.id}">${time}${PLAN_COLS.map(([col]) => `<td${col === 'n' ? ' class="cs-n"' : ''}>${cellOf(r, col, auto[col])}${edit && col === 'note' && changed ? `<button class="linkbtn cs-reset" data-resetrow="${r.item.id}" title="Вернуть то, что собрано из проекта">вернуть из проекта</button>` : ''}</td>`).join('')}</tr>`;
    }).join('');
    return `<table class="cs-table cs-plan"><thead><tr><th>Время</th>${PLAN_COLS.map(([, t]) => `<th>${t}</th>`).join('')}</tr></thead>
      <tbody>${tr}</tbody><tfoot><tr><td colspan="7">Итого ${Math.floor(total / 60)} ч ${total % 60} мин · хрон ${clockText(c.di.dur)}</td></tr></tfoot></table>
      ${edit ? '<div class="cs-add"><button class="linkbtn" data-addbanner="Перестановка">+ перестановка</button> · <button class="linkbtn" data-addbanner="Обед">+ обед</button> · <button class="linkbtn" data-addbanner="Грим, костюм, техническое освоение">+ грим и освоение</button> · <button class="linkbtn" data-addbanner="Перекост">+ перекост</button></div><p class="page-hint">Время считается от начала смены. Строки перетаскиваются за точки слева, порядок общий с КПП. Любую ячейку можно исправить: правка остаётся только в этом вызывном.</p>' : ''}`;
  },
  cast(c) {
    const { p, day, di, e, edit } = c, dc = day.cast, auto = autoTimes(p, day, c.info).cast;
    const rows = di.cast.filter(a => !dc.hidden[a.char]).map(a => ({ key: a.char, char: dc.names[a.char] ?? title(a.char), actor: a.actor, phone: a.phone, scenes: dc.scenes[a.char] ?? di.scenes.filter(s => s.chars.includes(a.char)).map(s => s.n).join(', '), own: false }))
      .concat(dc.extra.map(r => ({ key: r.id, char: r.char, actor: r.actor, phone: r.phone, scenes: r.scenes, own: true })));
    const hidden = di.cast.filter(a => dc.hidden[a.char]);
    if (!rows.length && !edit) return '';
    const busy = busyOn(p, day, rows.filter(r => !r.own).map(r => r.key));
    const warn = edit && busy.length ? `<div class="cs-warn">${busy.map(b => `<b>${esc(title(b.char))}${b.actor ? ` (${esc(b.actor)})` : ''}</b> ${b.kind === 'part' ? 'частично занят' : 'занят'} в этот день${b.note ? `: ${esc(b.note)}` : ''}`).join('<br>')}</div>` : '';
    const inp = (r, f, v, ph) => edit ? `<input type="text" data-castrow="${esc(r.key)}" data-own="${r.own ? 1 : ''}" data-field="${f}" value="${esc(v || '')}" placeholder="${ph}">` : esc(v || '');
    return `${warn}<table class="cs-table cs-cast"><thead><tr><th>Персонаж</th><th>Актёр</th><th>Телефон / Telegram</th><th>Сцены</th>${CAST_T.map(([, t]) => `<th>${t}</th>`).join('')}${edit ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.map(r => { const t = day.times[r.key] || {}, a = r.own ? {} : auto[r.key] || {}; return `<tr><td>${inp(r, 'char', r.char, 'Персонаж')}</td><td>${inp(r, 'actor', r.actor, 'Имя актёра')}</td><td class="cr-phone">${inp(r, 'phone', r.phone, CONTACT_PH)}${edit ? contactLink(r.phone) : ''}</td><td>${inp(r, 'scenes', r.scenes, '')}</td>${CAST_T.map(([k]) => `<td>${e.at('times', r.key, k, t[k], a[k])}</td>`).join('')}${edit ? `<td class="cs-x"><button class="ico" data-castdel="${esc(r.key)}" data-own="${r.own ? 1 : ''}" title="Убрать из этого вызывного" aria-label="Убрать строку">${X}</button></td>` : ''}</tr>`; }).join('')}</tbody></table>
      ${edit ? `<div class="cs-add"><button class="linkbtn" data-castadd>+ строка</button> · <button class="linkbtn" data-retime="times">пересчитать время по плану</button>${hidden.length ? ` · вернуть: ${hidden.map(a => `<button class="linkbtn" data-castback="${esc(a.char)}">${esc(title(a.char))}</button>`).join(', ')}` : ''}</div>
        <p class="page-hint">Готовность и конец смены считаются по плану дня: начало первой и конец последней сцены актёра. Грим, костюм и машина — назад от готовности, по минутам из «Группы». Серое время посчитано само, красное вписано руками (в подсказке — по плану). Имя актёра и телефон общие для проекта, остальное — только для этого вызывного.</p>` : ''}`;
  },
  extras(c) {
    const { p, day, di, info, e } = c, map = new Map(), auto = autoTimes(p, day, info).extras;
    for (const s of di.scenes) for (const x of sceneItems(p, s.id, info).extras) { const k = x.toLowerCase(); if (!map.has(k)) map.set(k, { name: x, n: [] }); map.get(k).n.push(s.n); }
    if (!map.size) return c.edit ? '<p class="empty">Массовки в разборе сцен дня нет.</p>' : '';
    return `<table class="cs-table"><thead><tr><th>Наименование</th><th>Сцены</th>${CAST_T.slice(1).map(([, t]) => `<th>${t}</th>`).join('')}</tr></thead><tbody>
      ${[...map.values()].map(x => { const t = day.extraTimes[x.name] || {}, a = auto[x.name] || {}; return `<tr><td>${esc(x.name)}</td><td>${x.n.join(', ')}</td>${CAST_T.slice(1).map(([k]) => `<td>${e.at('extraTimes', x.name, k, t[k], a[k])}</td>`).join('')}</tr>`; }).join('')}</tbody></table>
      ${c.edit ? '<div class="cs-add"><button class="linkbtn" data-retime="extraTimes">пересчитать время по плану</button></div>' : ''}`;
  },
  limits(c) { return c.e.area('limits', c.day, 'Кто до скольки свободен, дети, особые условия'); },
  note(c) { return c.e.area('note', c.day, 'Безопасность, особые условия, кто кого везёт'); },
  kpp(c) { return c.e.area('kppNote', c.day, 'Что учесть по КПП'); },
  next(c) {
    const { p, info, cast } = c, i = p.schedule.days.indexOf(c.day), after = p.schedule.days.slice(i + 1);
    const nd = after.find(d => d.kind === 'work'), gap = nd ? after.slice(0, after.indexOf(nd)) : [];
    if (!nd) return c.edit ? '<p class="empty">Следующей смены в КПП нет.</p>' : '';
    const pause = gap.length ? `<p class="cs-gap">Перед этим: ${gap.map(d => `${DAY_KINDS[d.kind].toLowerCase()}${d.date ? ` (${esc(longDate(d.date))})` : ''}`).join(', ')}</p>` : '';
    const ni = dayInfo(p, nd, info, cast), sun = ni.sun;
    const byPlace = new Map();
    for (const s of ni.scenes) { const o = objectOf(p, s), k = o.name ? o.name + (o.sub ? ' · ' + o.sub : '') : s.place || s.text; if (!byPlace.has(k)) byPlace.set(k, []); byPlace.get(k).push(s.n); }
    return `${pause}<div class="cs-next"><p><b>Смена ${shiftNo(p, nd)}${nd.night ? ', ночная' : ''} · ${esc(longDate(nd.date))}</b>${nd.call ? ` · сбор ${esc(nd.call)}` : ''}${nd.weather ? ` · ${esc(nd.weather)}` : ''}${nd.sun || sun ? ` · ${esc(nd.sun || `восход ${sun.sunrise}, закат ${sun.sunset}`)}` : ''}</p>
      <table class="cs-table cs-two"><tbody>${[...byPlace].map(([k, n]) => `<tr><td>${esc(k)}</td><td>${n.join(', ')}</td></tr>`).join('')}</tbody></table></div>`;
  },
};

// Цеха и спецтранспорт: если список дня ещё не заводили, показываем обычный набор со временем сбора смены.
// люди из «Группы», которых нет среди руководителей вызывного: по цехам, с поиском
let pickQ = '';
function crewPicker(p) {
  const rest = p.schedule.info.crew.filter(r => !r.lead && r.name.trim());
  if (!rest.length) return '';
  const q = pickQ.trim().toLowerCase(), shown = rest.filter(r => !q || `${r.name} ${r.role} ${r.dept}`.toLowerCase().includes(q));
  const depts = [...new Set(shown.map(r => r.dept))];
  return `<div class="cs-pick"><div class="cs-pick-head"><b>Из группы</b><span>${rest.length}</span><input type="search" class="cs-pick-q" value="${esc(pickQ)}" placeholder="Имя, должность, цех" aria-label="Поиск по группе"></div>
    <div class="cs-pick-list">${depts.map(d => `<div class="cs-pick-dept"><small>${esc(d)}</small>${shown.filter(r => r.dept === d).map(r => `<button type="button" class="cs-person" data-person="${r.id}" title="Перетащите в таблицу или щёлкните, чтобы добавить"><b>${esc(r.name)}</b><span>${esc(r.role)}</span></button>`).join('')}</div>`).join('') || '<p class="empty">Никого не нашлось.</p>'}</div></div>`;
}

function timedList(c, key, defaults, ph) {
  const { day, e, edit } = c, list = (day[key] || defaults.map(name => ({ id: 'def-' + name, name, time: '', off: false }))).filter(r => edit || !r.off);
  if (!list.length) return '';
  if (!edit) return `<div class="cs-list${list.length > 5 ? ' two' : ''}">${list.map(r => `<div class="cs-li"><span>${esc(r.name)}</span><b>${esc(r.time || day.call)}</b></div>`).join('')}</div>`;
  return `<table class="cs-table cs-two"><tbody>${list.map(r => `<tr${r.off ? ' class="cs-offrow"' : ''}>${edit ? `<td class="cs-use"><input type="checkbox" data-use="${key}" data-row="${r.id}"${r.off ? '' : ' checked'} title="Нужен в этой смене"></td>` : ''}<td>${e.cell(key, r.id, 'name', r.name, ph)}</td><td>${e.cell(key, r.id, 'time', r.time || (edit ? '' : day.call), day.call || '10:00', 'time')}</td>${edit ? `<td class="cs-x"><button class="ico" data-del="${key}" data-row="${r.id}" aria-label="Убрать строку">${X}</button></td>` : ''}</tr>`).join('')}</tbody></table>
    ${edit ? `<div class="cs-add"><button class="linkbtn" data-add="${key}">+ строка</button></div><p class="page-hint">Галочка — нужен в этой смене; без неё строки нет в PDF. Пустое время — к началу смены.</p>` : ''}`;
}

// узкие блоки в PDF собираются в одну «газетную» вставку на две колонки: они текут сверху вниз
// и выравниваются по высоте, без пустых дыр. Вставка встаёт на место первого узкого блока.
const NARROW = ['depts', 'transport', 'limits', 'note', 'kpp'];
function pairUp(parts) {
  const narrow = parts.filter(x => NARROW.includes(x.id));
  if (narrow.length < 2) return parts.map(x => x.html).join('');
  const at = parts.findIndex(x => NARROW.includes(x.id));
  return parts.map((x, i) => i === at ? `<div class="cs-flow">${narrow.map(y => y.html).join('')}</div>` : NARROW.includes(x.id) ? '' : x.html).join('');
}
function meetPlace(p, day, di) {
  const first = di.locs.find(l => l.geo) || di.locs[0];
  return day.meet || (first && first.geo && !/^https?:/i.test(first.geo) ? first.geo : first ? first.object || first.name : '');
}

// Одна полоса под шапкой: начало смены, мотор, стоп-мотор, хрон, сцен.
function bandHTML(c, meetOn) {
  const { p, day, di, edit } = c, cells = [];
  cells.push(...(c.keyCells || []));
  if (!cells.length) return '';
  const seg = x => `<div class="cs-seg${x.accent ? ' accent' : ''}${x.ro ? ' ro' : ''}"><span>${x.label}${x.hide || ''}</span><b>${x.value || '&nbsp;'}</b></div>`;
  return `<div class="cs-band" style="grid-template-columns: ${cells.map(x => x.id === 'scenes' ? '0.6fr' : '1fr').join(' ')}">${cells.map(seg).join('')}</div>`;
}

function sheet(p, day, edit) {
  const sch = p.schedule, i = sch.days.indexOf(day), info = sceneInfo(p), cast = castList(p, info), di = dayInfo(p, day, info, cast);
  const c = { p, day, info, cast, di, edit, e: mk(edit) };
  const on = sch.info.blocks.filter(b => b.on);
  const section = (id, html, head = true) => `<section class="cs-block" data-block="${id}" data-target="block:${id}">${head ? `<h2>${BLOCKS.find(x => x[0] === id)[1]}${edit ? `<button class="ico cs-hide" data-hideblock="${id}" title="Убрать блок (вернуть — в «Блоках»)" aria-label="Убрать блок">${X}</button>` : ''}</h2>` : ''}${html}</section>`;
  const shiftOn = on.some(b => b.id === 'shift'), locsOn = on.some(b => b.id === 'locs');
  const locsHTML = locsOn ? B.locs(c) : '';
  const parts = on.filter(b => !(b.id === 'locs' && shiftOn)).map(b => {
    let html = B[b.id](c);
    if (b.id === 'shift') html = html.replace('<!--locs-->', locsHTML ? section('locs', locsHTML) : '');
    return { id: b.id, html: html ? section(b.id, html, b.id !== 'shift') : '' };
  }).filter(x => x.html);
  const blocks = pairUp(parts); // порядок постоянный (BLOCKS), план съёмки — последним, в PDF со своей страницы
  const band = bandHTML(c, on.some(b => b.id === 'meet'));

  return `<div class="cs-doc">
    <header class="cs-top">
      <div><p class="cs-kicker">Вызывной лист</p><h1>${esc(p.name)}</h1><p class="cs-date">${day.kind === 'work' ? `Смена № ${shiftNo(p, day)}${day.night ? ', ночная' : ''}` : DAY_KINDS[day.kind]} · ${esc(longDate(day.date))}</p></div>
    </header>
    ${band}
    ${blocks}
  </div>`;
}

// ---------- погода по прогнозу ----------
const wxCache = new Map(); // id дня -> прогноз или null
const wx = day => wxCache.get(day.id + day.date) || null;
async function loadWeather(p, day) {
  const k = day.id + day.date;
  if (!day.date || wxCache.has(k)) return;
  wxCache.set(k, null);
  const di = dayInfo(p, day), l = di.locs.find(x => x.geo);
  let c = di.coords;
  if (!c && l) { c = await locate(l.geo); if (c && openId === day.id) renderCallsheet(); } // солнце по найденному городу
  const w = await weatherFor(c, day.date);
  if (w) { wxCache.set(k, w); if (openId === day.id) renderCallsheet(); }
}

export function mountCallsheet(id) { openId = id; renderCallsheet(); }

export function renderCallsheet() {
  const p = project(), sch = p.schedule, i = sch.days.findIndex(d => d.id === openId), day = sch.days[i];
  if (!day) return;
  loadWeather(p, day);
  const base = `#/p/${p.id}`, v = $('#view-call'), y = v.scrollTop;
  v.innerHTML = `<div class="page cs">
    <div class="cs-bar">
      <a class="ico" ${i > 0 ? `href="${base}/call/${sch.days[i - 1].id}"` : 'aria-disabled="true"'} title="Предыдущий день" aria-label="Предыдущий день"><svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg></a>
      <a class="ico" ${i < sch.days.length - 1 ? `href="${base}/call/${sch.days[i + 1].id}"` : 'aria-disabled="true"'} title="Следующий день" aria-label="Следующий день"><svg viewBox="0 0 24 24"><path d="M10 6l6 6-6 6"/></svg></a>
      <span class="grow"></span>
      <label class="cs-move-date">перенести на <input type="date" data-act-date value="${esc(day.date)}"${day.locked ? ' disabled' : ''}></label>
      <button class="act${day.locked ? ' on' : ''}" data-act="lock" title="${day.locked ? 'Снять фиксацию' : 'Зафиксировать порядок сцен и перерывов'}">${day.locked ? 'Зафиксирован' : 'Зафиксировать'}</button>
      <button class="act" data-act="copyfrom" title="Взять время, сбор группы, цеха, примечания из другой смены"${sch.days.length > 1 ? '' : ' disabled'}>Взять из смены…</button>
      <button class="act" data-act="blocks">Блоки</button>
      <a class="act" href="${base}/schedule">КПП</a>
      <button class="act main" data-act="pdf">PDF</button>
    </div>
    ${sheet(p, day, true)}
  </div>`;
  v.scrollTop = y;
}

// ---------- правки ----------
const view = $('#view-call');
const today = () => project().schedule.days.find(d => d.id === openId);
function listOf(day, key) {
  const sch = project().schedule;
  if (key === 'crew') return sch.info.crew;
  if (!day[key]) day[key] = (key === 'depts' ? DEFAULT_DEPTS : DEFAULT_TRANSPORT).map(name => ({ id: uid(), name, time: '' })); // список дня заводится при первой правке
  return day[key];
}
// строка проекта для персонажа: туда пишутся имя актёра и телефон
function castRow(char) {
  const sch = project().schedule;
  let row = sch.cast.find(c => c.char.toUpperCase() === char);
  if (!row) { row = { id: uid(), char, actor: '', phone: '' }; sch.cast.push(row); }
  return row;
}

view.addEventListener('input', e => {
  const p = project(), day = today(), t = e.target;
  if (!day) return;
  const d = t.dataset;
  if (d.obj) { (d.obj === 'info' ? p.schedule.info : day)[d.key] = t.value; store.touch(); return; }
  if (d.map) { const m = day[d.map], k = d.mkey; m[k] = m[k] || {}; m[k][d.field] = t.value; store.touch(); return; }
  if (d.banner) { const x = day.items.find(q => q.id === d.banner); if (x) { x.text = t.value; store.touch(); } return; }
  if (d.cell) { day.cells[d.cell] = t.value; store.touch(); return; }
  if (d.celllabel) { const x = p.schedule.info.shiftCells.find(q => q.id === d.celllabel); if (x) { x.label = t.value; store.touch(); } return; }
  if (d.objf) {
    let l = d.objloc && p.locations.find(q => q.id === d.objloc);
    if (!l && d.objscenes) {
      // место без локации: заводим локации по его сценам (без отдельной страницы), дальше пишем в них
      const ids = d.objscenes.split(',');
      l = p.locations.find(q => q.sceneIds.some(x => ids.includes(x)));
      if (!l) { for (const sid of ids) if (!p.locations.some(q => q.sceneIds.includes(sid))) locationFromScene(p, sid, uid); l = p.locations.find(q => q.sceneIds.some(x => ids.includes(x))); }
    }
    if (l) { setObjectField(p, l, d.objf, d.objf === 'geo' ? t.value.trim() : t.value); store.touch(); }
    return;
  }
  if (d.locgeo) { const l = p.locations.find(q => q.id === d.locgeo); if (l) { setObjectGeo(p, l, t.value.trim()); store.touch(); } return; }
  if (d.locbase) { const l = p.locations.find(q => q.id === d.locbase); if (l) { setObjectBase(p, l, t.value); store.touch(); } return; }
  if (d.pe) {
    const [id, col] = d.pe.split('|');
    (day.plan[id] = day.plan[id] || {})[col] = t.innerText.replace(/\n+$/, '');
    t.classList.add('own'); store.touch(); return;
  }
  if (d.castrow) {
    if (d.own) { const r = day.cast.extra.find(q => q.id === d.castrow); if (r) r[d.field] = t.value; }
    else if (d.field === 'actor' || d.field === 'phone') castRow(d.castrow)[d.field] = t.value.trim(); // общее для проекта
    else day.cast[d.field === 'char' ? 'names' : 'scenes'][d.castrow] = t.value;
    store.touch(); return;
  }
  if (d.list) {
    const was = !day[d.list] && d.list !== 'crew', list = listOf(day, d.list);
    let row = list.find(r => r.id === d.row);
    if (!row && was) row = list[[...t.closest('tbody').children].indexOf(t.closest('tr'))]; // строка из обычного набора
    if (row) { row[d.field] = t.value; if (d.list === 'crew' && d.field === 'role' && row.dept === 'Другое') row.dept = guessDept(t.value); if (was) d.row = row.id; store.touch(); }
  }
});
// ушли из поля времени с новым значением — перерисовать: своё время станет красным, грим и костюм пересчитаются
view.addEventListener('focusout', e => {
  const t = e.target;
  if (t.dataset && t.dataset.map && t.value !== t.defaultValue) renderCallsheet();
  // обед: план дня перестраивается, когда ушли из поля (время меняется по цифре — фокус терять нельзя)
  if (t.dataset && (t.dataset.key === 'lunch' || t.dataset.key === 'lunchEnd') && t.value !== t.defaultValue) renderCallsheet();
  if (t.matches && t.matches('[data-act-date]') && t.value && t.value !== t.defaultValue) {
    const p = project(), day = today(), how = moveToDate(p, day.id, t.value); store.touch(); renderCallsheet();
    toast(how === 'swap' ? 'На эту дату был день: они поменялись местами' : 'Смена перенесена');
  }
});
view.addEventListener('change', e => {
  const t = e.target, day = today(), p = project();
  if (!day) return;
  if (t.dataset.min) {
    const x = day.items.find(q => q.id === t.dataset.min);
    if (x) { x.min = Math.max(0, Math.round(+t.value || 0)); store.touch(); renderCallsheet(); }
  }
  if (t.dataset.locgeo || t.dataset.objf) renderCallsheet(); // солнце и ссылка на карту по новому адресу
  if (t.dataset.key === 'meet') renderCallsheet(); // ссылка «На карте» — по новому месту сбора
  if (t.dataset.use) {
    const list = listOf(day, t.dataset.use), r = list.find(q => q.id === t.dataset.row) || list[[...t.closest('tbody').children].indexOf(t.closest('tr'))];
    if (r) { r.off = !t.checked; store.touch(); renderCallsheet(); }
  }
 // своё время красным, стёртое — снова по плану; грим и костюм от новой готовности
  if (t.matches('[data-addcell]') && t.value) {
    const cells = p.schedule.info.shiftCells;
    if (t.value === 'new') cells.push({ id: 'c-' + uid(), on: true, label: 'Своя ячейка' });
    else cells.find(x => x.id === t.value).on = true;
    store.touch(); renderCallsheet();
  }
});

view.addEventListener('input', e => {
  if (!e.target.matches('.cs-pick-q')) return;
  pickQ = e.target.value;
  const y = view.scrollTop; renderCallsheet(); view.scrollTop = y;
  const i = view.querySelector('.cs-pick-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
});
function addLead(id) {
  const r = project().schedule.info.crew.find(x => x.id === id);
  if (!r) return;
  r.lead = true; store.touch(); renderCallsheet(); toast(`${r.name} — в вызывном`);
}

view.addEventListener('click', e => {
  const p = project(), day = today(), b = e.target.closest('button, [data-act]');
  if (!b || !day) return;
  const d = b.dataset;
  if (d.person) { addLead(d.person); return; }
  if (d.add === 'crew') { p.schedule.info.crew.push({ id: uid(), dept: 'Другое', role: '', name: '', phone: '', email: '', note: '', lead: true }); store.touch(); renderCallsheet(); return; }
  if (d.add) { listOf(day, d.add).push({ id: uid(), name: '', role: '', time: '', phone: '' }); store.touch(); renderCallsheet(); return; }
  if (d.fill === 'crew') { for (const role of CREW_ROLES) p.schedule.info.crew.push({ id: uid(), dept: guessDept(role), role, name: '', phone: '', email: '', note: '', lead: true }); store.touch(); renderCallsheet(); return; }
  if (d.del === 'crew') { const r = p.schedule.info.crew.find(x => x.id === d.row); if (r) { r.lead = false; store.touch(); renderCallsheet(); } return; }
  if (d.del) {
    const list = listOf(day, d.del), i = list.findIndex(r => r.id === d.row);
    list.splice(i >= 0 ? i : [...b.closest('tbody').children].indexOf(b.closest('tr')), 1); store.touch(); renderCallsheet(); return;
  }
  if ((d.addbanner || d.delbanner) && day.locked) { toast('День зафиксирован'); return; }
  if (d.addbanner) { day.items.push({ id: uid(), type: 'banner', text: d.addbanner, min: /обед/i.test(d.addbanner) ? 60 : d.addbanner.startsWith('Грим') ? 30 : 10 }); store.touch(); renderCallsheet(); return; }
  if (d.delbanner) { day.items = day.items.filter(x => x.id !== d.delbanner); store.touch(); renderCallsheet(); return; }
  if (d.act === 'lock') { day.locked = !day.locked; store.touch(); renderCallsheet(); toast(day.locked ? 'День зафиксирован: порядок сцен и перерывов не изменится' : 'Фиксация снята'); return; }
  if (d.retime) {
    const m = day[d.retime];
    for (const k of Object.keys(m)) for (const f of ['ready', 'end', 'makeup', 'costume', 'car', 'arrive']) if (m[k]) delete m[k][f];
    store.touch(); renderCallsheet(); toast('Время пересчитано по плану дня'); return;
  }
  if (d.resetrow) { delete day.plan[d.resetrow]; store.touch(); renderCallsheet(); return; }
  if (d.hideblock) { p.schedule.info.blocks.find(x => x.id === d.hideblock).on = false; store.touch(); renderCallsheet(); toast('Блок убран. Вернуть — кнопкой «Блоки»'); return; }
  if (d.hidecell) { const x = p.schedule.info.shiftCells.find(q => q.id === d.hidecell); x.on = false; store.touch(); renderCallsheet(); return; }
  if (d.newloc) { const l = locationFromScene(p, d.newloc, uid); if (l) { store.touch(); renderCallsheet(); toast(`Локация «${l.name}» создана: впишите адрес`); setTimeout(() => $(`[data-locgeo="${l.id}"]`, view)?.focus(), 50); } return; }
  if (d.castadd !== undefined) { day.cast.extra.push({ id: uid(), char: '', actor: '', phone: '', scenes: '' }); store.touch(); renderCallsheet(); return; }
  if (d.castdel) {
    if (d.own) day.cast.extra = day.cast.extra.filter(r => r.id !== d.castdel); else day.cast.hidden[d.castdel] = true;
    store.touch(); renderCallsheet(); return;
  }
  if (d.castback) { delete day.cast.hidden[d.castback]; store.touch(); renderCallsheet(); return; }
  if (d.act === 'pdf') {
    const n = shiftNo(p, day) || p.schedule.days.indexOf(day) + 1;
    printHTML(`<div class="cs-print">${sheet(p, day, false)}</div>`, 'size: A4; margin: 10mm;', safeName(`${p.name}, вызывной лист, смена ${n}`));
  }
  if (d.act === 'blocks') showBlocks();
  if (d.act === 'copyfrom') copyDialog(p, day);
});

// ---------- перетаскивание: блоки, ячейки смены, строки плана ----------
// Своё перетаскивание мышью за точки: колёсико работает, у края окна страница едет сама.
const unmark = () => { for (const c of ['dnd-before', 'dnd-after', 'cs-dropzone']) for (const x of view.querySelectorAll('.' + c)) x.classList.toggle(c, false); };
const hit = (d, x, y) => {
  const t = document.elementFromPoint(x, y)?.closest(`#view-call [data-target^="${d.kind}:"]`);
  if (!t || t.dataset.target === `${d.kind}:${d.id}`) return null;
  const r = t.getBoundingClientRect();
  // ячейки смены стоят в сетке: место по горизонтали; блоки и строки — по вертикали
  return { t, after: d.kind === 'cell' ? x > r.left + r.width / 2 : y > r.top + r.height / 2 };
};
pointerDrag(view, {
  pick(e) {
    const pr = e.target.closest('[data-person]');
    if (pr) return { el: pr, data: { kind: 'person', id: pr.dataset.person } };
    const g = e.target.closest('[data-dnd]');
    if (!g) return null;
    e.preventDefault(); // не выделять текст, пока тянем
    const [kind, id] = g.dataset.dnd.split(':');
    const el = view.querySelector(`[data-target="${g.dataset.dnd}"]`);
    return el ? { el, data: { kind, id } } : null;
  },
  move(d, x, y) {
    unmark();
    if (d.kind === 'person') { view.querySelector('[data-block="crew"]')?.classList.toggle('cs-dropzone', !!document.elementFromPoint(x, y)?.closest('#view-call [data-block="crew"]')); return; }
    const h = hit(d, x, y); if (h) h.t.classList.add(h.after ? 'dnd-after' : 'dnd-before');
  },
  drop(d, x, y) {
    if (d.kind === 'person') { if (document.elementFromPoint(x, y)?.closest('#view-call [data-block="crew"] table, #view-call [data-block="crew"] h2, #view-call [data-block="crew"] .cs-add')) addLead(d.id); return; }
    const h = hit(d, x, y);
    if (!h) return;
    const p = project(), day = today(), to = h.t.dataset.target.split(':')[1];
    const list = d.kind === 'block' ? p.schedule.info.blocks : d.kind === 'cell' ? p.schedule.info.shiftCells : day.items;
    const from = list.findIndex(q => q.id === d.id);
    if (from < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(list.findIndex(q => q.id === to) + (h.after ? 1 : 0), 0, moved);
    store.touch(); renderCallsheet();
  },
  end: unmark,
});

// ---------- перенести заполненное из другой смены ----------
// План съёмки, сцены, время актёров и всё, что зависит от сцен дня, не переносится.
const COPY = [
  ['time', 'Время смены: начало, мотор, стоп-мотор, обед', ['call', 'motor', 'stop', 'lunch', 'lunchEnd']],
  ['meet', 'Сбор группы: время, место, примечание', ['meetTime', 'meet', 'meetNote']],
  ['depts', 'Цеха и спецтранспорт', ['depts', 'transport']],
  ['notes', 'Примечание и ограничения по актёрам', ['note', 'limits']],
  ['cells', 'Свои ячейки смены', ['cells']],
  ['cast', 'Актёры: убранные и добавленные строки', ['cast']],
];
function copyDialog(p, day) {
  const sch = p.schedule, others = sch.days.filter(d => d !== day);
  const label = d => `${d.kind === 'work' ? `Смена ${shiftNo(p, d)}` : DAY_KINDS[d.kind]}${d.date ? ' · ' + longDate(d.date) : ''}`;
  const i = sch.days.indexOf(day), prev = [...sch.days.slice(0, i)].reverse().find(d => d.kind === 'work') || others[0];
  const d = document.createElement('dialog');
  d.className = 'ask cs-copy';
  d.innerHTML = `<form method="dialog"><h3>Взять из другой смены</h3>
    <p class="ask-text">Отмеченное заменит то, что сейчас в этом вызывном. План съёмки и время актёров считаются по сценам дня и не переносятся.</p>
    <label class="field"><span>Из смены</span><select data-from>${others.map(x => `<option value="${x.id}"${x === prev ? ' selected' : ''}>${esc(label(x))}</option>`).join('')}</select></label>
    <div class="kc-list">${COPY.map(([k, t]) => `<label class="field check"><input type="checkbox" value="${k}" checked><span>${t}</span></label>`).join('')}</div>
    <div class="ask-row"><button class="act" value="cancel">Отмена</button><button class="act main" value="ok">Перенести</button></div></form>`;
  d.addEventListener('close', () => {
    const from = sch.days.find(x => x.id === d.querySelector('[data-from]').value), keys = [...d.querySelectorAll('input:checked')].map(x => x.value);
    d.classList.add('out'); setTimeout(() => d.remove(), 200);
    if (d.returnValue !== 'ok' || !from || !keys.length) return;
    for (const [k, , fields] of COPY) if (keys.includes(k)) for (const f of fields) {
      const v = from[f] === undefined ? undefined : JSON.parse(JSON.stringify(from[f]));
      if (Array.isArray(v)) for (const r of v) if (r && r.id) r.id = uid(); // свои id у строк цехов и транспорта
      if (v && v.extra) for (const r of v.extra) r.id = uid();
      day[f] = v === undefined ? (typeof day[f] === 'string' ? '' : day[f]) : v;
    }
    store.touch(); renderCallsheet();
    toast(`Перенесено из «${label(from)}»`);
  });
  document.body.append(d);
  d.showModal();
}

// ---------- конструктор блоков ----------
function showBlocks() {
  const sch = project().schedule;
  const d = document.createElement('dialog');
  d.className = 'ask cs-blocks';
  d.innerHTML = `<form method="dialog"><h3>Блоки вызывного листа</h3>
    <p class="ask-text">Отметьте, что выводить. У каждого блока своё место в листе: включённый блок встаёт на него сам. Набор общий для всех дней проекта.</p>
    <ol class="cb-list">${sch.info.blocks.map(b => `<li><label class="field check"><input type="checkbox" data-on="${b.id}"${b.on ? ' checked' : ''}><span>${BLOCKS.find(x => x[0] === b.id)[1]}</span></label></li>`).join('')}</ol>
    <div class="ask-row"><button class="act main" value="ok">Готово</button></div></form>`;
  d.addEventListener('change', e => { const b = sch.info.blocks.find(x => x.id === e.target.dataset.on); if (b) { b.on = e.target.checked; store.touch(); renderCallsheet(); } });
  d.addEventListener('close', () => { d.classList.add('out'); setTimeout(() => d.remove(), 200); });
  document.body.append(d);
  d.showModal();
}

export const _test = { sheet };

document.addEventListener('miz:scene-changed', () => { if (document.body.dataset.view === 'call') renderCallsheet(); });
