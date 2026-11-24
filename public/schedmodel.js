// КПП и вызывные листы: данные и расчёты без браузера (ими же может пользоваться ИИ-помощник).
// p.schedule = {
//   info: { director, producer, ad, phone, base, start },      — шапка вызывных листов и дата первого дня
//   days: [{ id, date, call, wrap, lunch, weather, note, items: [{ id, type: 'scene', sceneId } | { id, type: 'banner', text }],
//            times: { castId: { pickup, makeup, set } } }],
//   cast: [{ id, char, actor, phone }],                          — кто играет кого (номер = порядок появления в сценарии)
//   variantName: '',                                             — название текущего варианта раскладки
//   variants: [{ id, name, days }],                              — другие варианты раскладки (их дни и вызывные)
// }
import { sceneInfo } from './breakdown.js';
import { coordsOf, sunDay } from './sun.js';

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = v => (typeof v === 'string' ? v : '');

// дни раскладки: поля дня и всё, что правится в его вызывном
function normDays(list, uid) {
  const days = Array.isArray(list) ? list.filter(isObj) : [];
  for (const d of days) {
    d.id = d.id || 'day-' + uid();
    for (const k of ['date', 'call', 'wrap', 'lunch', 'weather', 'note']) d[k] = str(d[k]);
    // тип дня (рабочий, выходной, отсыпной, подготовительный), ночная смена, фиксация от случайных правок
    d.kind = DAY_KINDS[d.kind] ? d.kind : 'work';
    d.night = !!d.night; d.locked = !!d.locked;
    d.items = Array.isArray(d.items) ? d.items.filter(x => isObj(x) && (x.type === 'scene' ? x.sceneId : x.type === 'banner')) : [];
    for (const x of d.items) { x.id = x.id || uid(); if (x.type === 'banner') x.text = str(x.text); }
    d.times = isObj(d.times) ? d.times : {};
    for (const k of ['motor', 'stop', 'meet', 'limits', 'kppNote', 'tDay', 'tNight', 'lunchEnd', 'meetTime', 'meetNote']) d[k] = str(d[k]);
    for (const k of ['depts', 'transport']) { d[k] = Array.isArray(d[k]) ? d[k].filter(isObj) : null; if (d[k]) for (const r of d[k]) { r.id = r.id || uid(); r.name = str(r.name); r.time = str(r.time); r.off = !!r.off; } }
    d.extraTimes = isObj(d.extraTimes) ? d.extraTimes : {};
    // правки только этого вызывного: ячейки смены, свои ячейки, солнце вручную, ячейки плана, актёры
    d.cells = isObj(d.cells) ? d.cells : {};
    d.sun = str(d.sun);
    d.plan = isObj(d.plan) ? d.plan : {};
    const c = isObj(d.cast) ? d.cast : {};
    for (const k of ['hidden', 'names', 'scenes']) c[k] = isObj(c[k]) ? c[k] : {};
    c.extra = Array.isArray(c.extra) ? c.extra.filter(isObj) : [];
    for (const r of c.extra) { r.id = r.id || uid(); for (const k of ['char', 'actor', 'phone', 'scenes']) r[k] = str(r[k]); }
    d.cast = c;
    for (const x of d.items) if (x.min !== undefined && !(x.min >= 0)) delete x.min;
  }
  return days;
}

export function normalizeSchedule(p, uid) {
  const s = isObj(p.schedule) ? p.schedule : {};
  s.info = isObj(s.info) ? s.info : {};
  for (const k of ['director', 'producer', 'ad', 'phone', 'base', 'start']) s.info[k] = str(s.info[k]);
  s.days = normDays(s.days, uid);
  // варианты раскладки КПП: текущий лежит в s.days (с ним работают вызывные и выгрузки), остальные — здесь
  s.variantName = str(s.variantName);
  s.variants = Array.isArray(s.variants) ? s.variants.filter(isObj) : [];
  for (const v of s.variants) { v.id = v.id || 'v-' + uid(); v.name = str(v.name); v.days = normDays(v.days, uid); }
  s.cast = Array.isArray(s.cast) ? s.cast.filter(isObj) : [];
  delete s.aliases; // объединение персонажей в программе отменено: имена берутся из сценария как есть
  for (const c of s.cast) {
    c.id = c.id || uid();
    for (const k of ['char', 'actor', 'phone']) c[k] = str(c[k]);
    // сколько минут на грим и костюм персонажа и за сколько до готовности машина за актёром
    for (const k of ['makeupMin', 'costumeMin', 'carMin']) c[k] = Number.isFinite(+c[k]) && +c[k] > 0 ? Math.round(+c[k]) : 0;
    // занятость актёра: [{ date, kind: 'busy' | 'part', note }]
    c.busy = Array.isArray(c.busy) ? c.busy.filter(b => isObj(b) && /^\d{4}-\d{2}-\d{2}$/.test(b.date)) : [];
    for (const b of c.busy) { b.kind = b.kind === 'part' ? 'part' : 'busy'; b.note = str(b.note); }
  }
  s.info.sides = isObj(s.info.sides) ? s.info.sides : {};
  for (const k of ['pageBreak', 'neighbours', 'castHead', 'header']) s.info.sides[k] = s.info.sides[k] === undefined ? k === 'castHead' || k === 'header' : !!s.info.sides[k];
  // руководители группы для шапки вызывного: [{ id, role, name, phone }]
  s.info.crew = Array.isArray(s.info.crew) ? s.info.crew.filter(isObj) : [];
  // группа: цех, должность, контакты; lead — показывать в «Руководителях группы» вызывного
  for (const c of s.info.crew) {
    c.id = c.id || uid();
    for (const k of ['role', 'name', 'phone', 'email', 'note', 'status', 'city']) c[k] = str(c[k]);
    c.dept = DEPARTMENTS.includes(c.dept) ? c.dept : guessDept(c.role);
    c.lead = c.lead !== false;
  }
  // блоки вызывного листа по порядку: [{ id, on }]; недостающие дописываются в конец
  const have = Array.isArray(s.info.blocks) ? s.info.blocks.filter(b => isObj(b) && BLOCKS.some(x => x[0] === b.id)) : [];
  for (const [id, , on] of BLOCKS) if (!have.some(b => b.id === id)) have.push({ id, on });
  // порядок постоянный: как в BLOCKS
  s.info.blocks = BLOCKS.map(([id]) => have.find(b => b.id === id));
  // ячейки блока «Смена»: порядок и видимость общие для проекта, свои ячейки — с подписью
  const cells = Array.isArray(s.info.shiftCells) ? s.info.shiftCells.filter(c => isObj(c) && (SHIFT_CELLS.some(x => x[0] === c.id) || /^c-/.test(c.id))) : [];
  for (const [id] of SHIFT_CELLS) if (!cells.some(c => c.id === id)) cells.push({ id, on: true });
  for (const c of cells) { c.on = c.on !== false; if (/^c-/.test(c.id)) c.label = str(c.label) || 'Своя ячейка'; }
  s.info.shiftCells = [...SHIFT_CELLS.map(([id]) => cells.find(c => c.id === id)), ...cells.filter(c => /^c-/.test(c.id))];
  // синопсис и примечание к сцене для КПП: { id сцены: { synopsis, note } }
  s.scenes = isObj(s.scenes) ? s.scenes : {};
  for (const [k, v] of Object.entries(s.scenes)) { if (!isObj(v)) delete s.scenes[k]; else { v.synopsis = str(v.synopsis); v.note = str(v.note); v.dur = str(v.dur); } }
  p.schedule = s;
}

// Блоки вызывного листа: [id, название, включён по умолчанию]
// У каждого блока своё постоянное место в листе — в этом порядке, и на экране, и в PDF.
// Место сбора стоит в шапке рядом с общим сбором; узкие блоки (цеха … комментарий КПП) — в две колонки.
export const BLOCKS = [
  ['meet', 'Сбор группы', true],
  ['shift', 'Смена, солнце и погода', true],
  ['crew', 'Руководители группы', false],
  ['depts', 'Цеха: вызов', false],
  ['transport', 'Спецтранспорт', false],
  ['locs', 'Адрес и объекты', true],
  ['limits', 'Ограничения по актёрам', false],
  ['note', 'Примечание', true],
  ['kpp', 'Комментарий КПП', false],
  ['cast', 'Актёры', true],
  ['extras', 'Массовка', true],
  ['next', 'Следующая смена', true],
  ['plan', 'План съёмки по времени', true],
];
// Цеха съёмочной группы и обычные должности в них ([должность, руководитель — в вызывной]).
export const DEPARTMENTS = ['Режиссёрская группа', 'Продюсеры и администрация', 'Операторская группа', 'Свет', 'Звук', 'Художественная группа', 'Реквизит', 'Костюм', 'Грим', 'Транспорт', 'Консультанты', 'Партнёры и контакты', 'Другое'];
// этапы поиска человека на должность
export const STATUSES = ['В поисках', 'Найден', 'Требуется решение', 'Утверждён', 'Ещё не связались', 'Связались', 'Отказался'];
export const ROLES = {
  'Режиссёрская группа': [['Режиссёр', true], ['Второй режиссёр', true], ['Помощник режиссёра', false], ['Скрипт-супервайзер', true], ['Ассистент по актёрам', true], ['Кастинг-директор', false], ['Бригадир АМС', false]],
  'Продюсеры и администрация': [['Продюсер', true], ['Исполнительный продюсер', true], ['Линейный продюсер', true], ['Директор съёмочной группы', true], ['Администратор', true], ['Ассистент продюсера', false]],
  'Операторская группа': [['Оператор-постановщик', true], ['Второй оператор', false], ['Фокус-пуллер', false], ['Ассистент оператора', false], ['Видеоинженер', false], ['Технический директор', true]],
  'Свет': [['Гаффер', true], ['Осветитель', false]],
  'Звук': [['Звукорежиссёр', true], ['Бум-оператор', false]],
  'Художественная группа': [['Художник-постановщик', true], ['Ассистент художника-постановщика', false], ['Постановщик', false]],
  'Реквизит': [['Художник по реквизиту', true], ['Реквизитор', false]],
  'Костюм': [['Художник по костюму', true], ['Ассистент художника по костюму', false]],
  'Грим': [['Художник по гриму', true], ['Ассистент художника по гриму', false]],
  'Транспорт': [['Водитель', false]],
  'Консультанты': [],
  'Партнёры и контакты': [],
  'Другое': [],
};
export function guessDept(role) {
  const r = String(role || '').toLowerCase();
  for (const d of DEPARTMENTS) if ((ROLES[d] || []).some(([x]) => x.toLowerCase() === r)) return d;
  if (/меценат|партн|спонсор|контакт|инвест/.test(r)) return 'Партнёры и контакты';
  if (/консульт/.test(r)) return 'Консультанты';
  // сначала узкие цеха: «звукорежиссёр» — звук, а не режиссёрская группа; «художник по кост» — костюм
  if (/звук|бум|композит/.test(r)) return 'Звук';
  if (/гафф?ер|свет|осветит/.test(r)) return 'Свет';
  if (/реквиз/.test(r)) return 'Реквизит';
  if (/костюм|по кост/.test(r)) return 'Костюм';
  if (/грим/.test(r)) return 'Грим';
  if (/техническ.*директор|операт|фокус|камер|видео/.test(r)) return 'Операторская группа';
  if (/хореогр|режисс|скрипт|актёр|актер|кастинг|амс|локейшн/.test(r)) return 'Режиссёрская группа';
  if (/продюс|директор|админ/.test(r)) return 'Продюсеры и администрация';
  if (/худож|постанов|декор/.test(r)) return 'Художественная группа';
  if (/водит|транспорт/.test(r)) return 'Транспорт';
  return 'Другое';
}

// Ячейки блока «Смена, солнце и погода»: [id, подпись]
// Ячейки блока «Смена» на постоянных местах: первые четыре — крупной полосой, дальше сеткой; свои ячейки — в конце.
export const SHIFT_CELLS = [
  ['call', 'Начало смены'], ['motor', 'Мотор'], ['stop', 'Стоп-мотор'], ['chron', 'Хрон дня · сцен'],
  ['lunch', 'Обед'], ['director', 'Режиссёр'], ['ad', 'Второй режиссёр'], ['producer', 'Продюсер'],
  ['phone', 'Телефон площадки'], ['weather', 'Погода'], ['temp', 't днём / ночью'], ['sun', 'Солнце'],
];
export const DEFAULT_DEPTS = ['Режиссёрская группа', 'Операторы, видеоинженер', 'Осветители', 'Звук', 'Художники, постановщики', 'Реквизит', 'Костюм, грим', 'Ассистент по актёрам', 'Администрация'];
export const DEFAULT_TRANSPORT = ['Камерваген', 'Светобаза, генератор', 'Худваген', 'Реквизиторская'];

// Синопсис для КПП: свой, а если не вписан — первая строка действия сцены.
export const sceneMeta = (p, sid) => p.schedule.scenes[sid] || { synopsis: '', note: '', dur: '' };
// Синопсис сцены: только то, что вписал человек; не вписан — пусто.
export const synopsisOf = (p, s) => sceneMeta(p, s.id).synopsis;

// Сколько минут закладывать на сцену в плане дня, если не вписано своё: 15 минут на подготовку
// и 15 на минуту экрана (сцена в 2:07 — 45 минут, в 1:00 — 30), без хронометража — 30.
export const defaultMin = (s, x) => {
  if (x && x.min >= 0) return x.min;
  if (!s) return /обед/i.test((x && x.text) || '') ? 60 : 10;
  const sec = durSec(s.dur);
  return sec ? Math.min(120, Math.max(10, Math.round((15 + sec / 60 * 15) / 5) * 5)) : 30;
};
const toMin = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
export const fromMin = n => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

// Длина обеда из ячейки «Обед»: от начала до конца, по умолчанию час.
export function lunchMin(day) {
  const a = toMin(day.lunch);
  if (a === null) return null;
  const b = toMin(day.lunchEnd);
  return b === null ? 60 : ((b - a) + 1440) % 1440 || 60;
}
export const lunchEndOf = day => { const a = toMin(day.lunch); return a === null ? '' : day.lunchEnd || fromMin(a + 60); };

// План дня по времени: от начала смены по порядку, у каждой строки начало, конец и длительность.
// Обед берёт длину из ячейки «Обед»; если плашки «Обед» в плане нет, она встаёт сама — к времени обеда.
export function timeline(p, day, info) {
  let t = toMin(day.call) ?? 600;
  const lm = lunchMin(day), ls = toMin(day.lunch), isLunch = x => x.type === 'banner' && /^\s*обед/i.test(x.text || '');
  const own = lm !== null && day.items.some(isLunch);
  const rows = [];
  let placed = own || lm === null;
  for (const x of day.items) {
    const s = x.type === 'scene' ? info.find(q => q.id === x.sceneId) : null;
    if (x.type === 'scene' && !s) continue;
    if (!placed && t >= ls) { rows.push({ item: { id: 'lunch', type: 'banner', text: 'Обед' }, scene: null, start: fromMin(t), end: fromMin(t + lm), min: lm, auto: true }); t += lm; placed = true; }
    const min = lm !== null && isLunch(x) ? lm : defaultMin(s, x), row = { item: x, scene: s, start: fromMin(t), end: fromMin(t + min), min };
    t += min;
    rows.push(row);
  }
  return rows;
}

// Персонажи с номерами: по порядку первого появления в сценарии, с актёрами из списка.
export function castList(p, info = sceneInfo(p)) {
  const order = [];
  for (const s of info) for (const c of s.chars) if (!order.includes(c)) order.push(c);
  for (const c of p.schedule.cast) if (c.char && !order.includes(c.char.toUpperCase())) order.push(c.char.toUpperCase());
  return order.map((char, i) => {
    const row = p.schedule.cast.find(c => c.char.toUpperCase() === char) || {};
    return { n: i + 1, char, id: row.id || '', actor: row.actor || '', phone: row.phone || '', scenes: info.filter(s => s.chars.includes(char)).map(s => s.id) };
  });
}

export const scheduledIds = p => new Set(p.schedule.days.flatMap(d => d.items.filter(x => x.type === 'scene').map(x => x.sceneId)));

// «01:10» -> секунды
const durSec = t => { const m = String(t || '').match(/(\d+):(\d{2})/); return m ? +m[1] * 60 + +m[2] : 0; };
export const clockText = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

// Всё, что нужно о дне: сцены (с разбором шапки), страницы в восьмых, хронометраж, номера актёров, локации, солнце.
export function dayInfo(p, day, info = sceneInfo(p), cast = castList(p, info)) {
  const scenes = day.items.filter(x => x.type === 'scene').map(x => info.find(s => s.id === x.sceneId)).filter(Boolean);
  const locs = [];
  for (const s of scenes) for (const l of p.locations.filter(l => l.sceneIds.includes(s.id))) if (!locs.includes(l)) locs.push(l);
  const chars = [...new Set(scenes.flatMap(s => s.chars))];
  // координаты для солнца: адрес объекта, даже если вписан у другой его комнаты
  const same = l => (p.locations || []).filter(x => String(x.object || '').toUpperCase() === String(l.object || '').toUpperCase());
  const c = locs.flatMap(l => [l, ...same(l)]).map(l => coordsOf(l.geo)).find(Boolean) || null;
  return {
    scenes, locs, eighths: scenes.reduce((a, s) => a + s.eighths, 0), dur: scenes.reduce((a, s) => a + durSec(s.dur), 0),
    cast: cast.filter(x => chars.includes(x.char)), sun: sunDay(day.date, c), coords: c,
  };
}

const addDays = (date, n) => { if (!date) return ''; const [y, m, d] = date.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
export const nextDate = p => {
  const last = [...p.schedule.days].reverse().find(d => d.date);
  return last ? addDays(last.date, 1) : p.schedule.info.start || '';
};

// Занятость актёров по дням: для каждого персонажа — в какие дни он снимается.
export function dayOutOfDays(p, info = sceneInfo(p), cast = castList(p, info)) {
  const days = p.schedule.days.map(d => new Set(d.items.filter(x => x.type === 'scene').map(x => info.find(s => s.id === x.sceneId)).filter(Boolean).flatMap(s => s.chars)));
  return cast.map(c => {
    const marks = days.map(set => set.has(c.char));
    const first = marks.indexOf(true), last = marks.lastIndexOf(true);
    return { ...c, marks: marks.map((m, i) => (m ? (first === last ? 'SWF' : i === first ? 'S' : i === last ? 'F' : 'W') : i > first && i < last ? 'H' : '')), work: marks.filter(Boolean).length };
  });
}

// Цвет полосы как на классической доске: ИНТ день белый, НАТ день жёлтый, ИНТ ночь синий, НАТ ночь зелёный, режим оранжевый.
export function stripClass(s) {
  if (!s.ie) return 'st-other';
  const ext = /НАТ|EXT/.test(s.ie) && !/ИНТ|INT/.test(s.ie), mix = /\//.test(s.ie);
  if (/РЕЖИМ|СУМЕРКИ|ЗАКАТ|РАССВЕТ|DUSK|DAWN/.test(s.time)) return 'st-magic';
  const night = /НОЧЬ|NIGHT|ВЕЧЕР/.test(s.time) && !/ДЕНЬ/.test(s.time);
  return (night ? 'st-night' : 'st-day') + (ext ? '-ext' : mix ? '-ext' : '-int');
}

// Первая строка действия как краткое содержание сцены.
export const synopsis = s => { const a = s.blocks.find(b => b.type === 'action' && b.text.trim()); return a ? a.text.trim().replace(/\s+/g, ' ') : ''; };


// ---------- типы дней, выходные, сдвиги ----------
export const DAY_KINDS = { work: 'Рабочий', off: 'Выходной', rest: 'Отсыпной', prep: 'Подготовительный' };
// государственные праздники России (месяц-день)
const HOLIDAYS = ['01-01', '01-02', '01-03', '01-04', '01-05', '01-06', '01-07', '01-08', '02-23', '03-08', '05-01', '05-09', '06-12', '11-04'];
export const isWeekend = d => { if (!d) return false; const [y, m, dd] = d.split('-').map(Number); const w = new Date(y, m - 1, dd).getDay(); return w === 0 || w === 6; };
export const isHoliday = d => !!d && HOLIDAYS.includes(d.slice(5));
export { addDays };

// дни с датой — по порядку дат; без даты остаются на своих местах в конце
export function sortDays(p) {
  const dated = p.schedule.days.filter(d => d.date).sort((a, b) => a.date.localeCompare(b.date));
  p.schedule.days = [...dated, ...p.schedule.days.filter(d => !d.date)];
}
// сдвинуть даты дней начиная с from (в порядке списка) на n календарных дней
export function shiftFrom(p, from, n) {
  for (const d of p.schedule.days.slice(from)) if (d.date) d.date = addDays(d.date, n);
}
// перенести смену на дату; если там уже есть день — поменять их местами
export function moveToDate(p, id, date) {
  const day = p.schedule.days.find(d => d.id === id), other = p.schedule.days.find(d => d.id !== id && d.date === date);
  if (!day || !date) return '';
  if (other) { other.date = day.date; day.date = date; sortDays(p); return 'swap'; }
  day.date = date; sortDays(p); return 'move';
}
export function swapDays(p, a, b) {
  const A = p.schedule.days.find(d => d.id === a), B = p.schedule.days.find(d => d.id === b);
  if (!A || !B) return;
  [A.date, B.date] = [B.date, A.date];
  const i = p.schedule.days.indexOf(A), j = p.schedule.days.indexOf(B);
  [p.schedule.days[i], p.schedule.days[j]] = [p.schedule.days[j], p.schedule.days[i]];
}
// номер смены: считаются только рабочие дни
export const shiftNo = (p, day) => day.kind !== 'work' ? 0 : p.schedule.days.filter(d => d.kind === 'work').indexOf(day) + 1;

// ---------- объект сцены: локация или первые слова места из шапки ----------
// объект и подобъект сцены: из её локации, а если локации нет — из шапки («ДОМ БАТЫРА. ГОСТИНАЯ»)
const cap = t => t ? t.charAt(0) + t.slice(1).toLowerCase() : '';
export function objectOf(p, s) {
  const l = (p.locations || []).find(x => x.sceneIds.includes(s.id));
  const place = String(s.place || s.text || ''), i = place.indexOf('.');
  const object = l && l.object ? l.object : cap((i < 0 ? place : place.slice(0, i)).trim());
  const sub = l ? (l.sub || '') : i < 0 ? '' : cap(place.slice(i + 1).replace(/^[\s.]+/, '').trim());
  return { key: 'O' + object.toUpperCase().replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim(), name: object, sub, loc: l || null };
}

// ---------- занятость актёров ----------
// какие персонажи дня заняты в этот день: [{ char, actor, kind, note }]
export function busyOn(p, day, chars) {
  if (!day.date) return [];
  return p.schedule.cast.filter(c => chars.includes(c.char.toUpperCase())).flatMap(c => c.busy.filter(b => b.date === day.date).map(b => ({ char: c.char, actor: c.actor, kind: b.kind, note: b.note })));
}

// ---------- время актёров и массовки по плану дня ----------
const hm = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
// для персонажа: готовность = начало его первой сцены, конец = конец последней, грим и костюм — назад от готовности
export function autoTimes(p, day, info) {
  const rows = timeline(p, day, info), out = {}, extras = {};
  for (const r of rows) {
    if (!r.scene) continue;
    for (const c of r.scene.chars) { const o = (out[c] = out[c] || { ready: r.start, end: r.end }); o.end = r.end; }
    for (const x of (p.breakdown || []).filter(i => i.sceneId === r.scene.id && i.cat === 'extras' && !i.off)) {
      const o = (extras[x.text] = extras[x.text] || { ready: r.start, end: r.end }); o.end = r.end;
    }
  }
  for (const [char, o] of Object.entries(out)) {
    // если готовность вписана руками, грим и костюм считаются от неё
    const c = p.schedule.cast.find(x => x.char.toUpperCase() === char) || {}, ready = hm((day.times && day.times[char] && day.times[char].ready) || o.ready);
    let t = ready;
    if (c.makeupMin) { t -= c.makeupMin; o.makeup = fromMin(t); }
    if (c.costumeMin) { t -= c.costumeMin; o.costume = fromMin(t); }
    if (c.carMin) o.car = fromMin(ready - c.carMin);
    if (c.makeupMin || c.costumeMin) o.arrive = fromMin(t - 10); // приехать за 10 минут до первого кресла
  }
  return { cast: out, extras };
}


// ---------- контакты: в одном поле телефон или @ник в Telegram ----------
export const CONTACT_PH = '+7 или @telegram';
export function contactLink(v) {
  const t = String(v || '').trim(), tg = t.match(/@([A-Za-z0-9_]{4,})/) || t.match(/^([A-Za-z][A-Za-z0-9_]{3,})$/);
  const ph = t.replace(/@[A-Za-z0-9_]+/g, '').replace(/[^\d+]/g, '');
  const e = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return (ph.replace(/\D/g, '').length >= 5 ? `<a class="cr-call" href="tel:${e(ph)}" title="Позвонить">☎</a>` : '')
    + (tg ? `<a class="cr-call" href="https://t.me/${e(tg[1])}" target="_blank" rel="noopener" title="Написать в Telegram">✈</a>` : '');
}


// ---------- варианты раскладки КПП ----------
export const variantTitle = (s, v) => (v ? v.name : s.variantName) || 'Основной';
// копия дней с новыми id (чтобы облако не путало дни разных вариантов); правки плана по id пунктов переносятся
function copyDays(days, uid) {
  return JSON.parse(JSON.stringify(days)).map(d => {
    const map = {};
    d.id = 'day-' + uid();
    for (const x of d.items) { const n = uid(); map[x.id] = n; x.id = n; }
    const plan = {};
    for (const [k, v] of Object.entries(d.plan || {})) plan[map[k] || k] = v;
    d.plan = plan;
    return d;
  });
}
// новый вариант: копия текущего или пустой; текущий уходит в список вариантов
export function newVariant(p, uid, name, copy) {
  const s = p.schedule;
  s.variants.push({ id: 'v-' + uid(), name: variantTitle(s), days: s.days });
  s.days = copy ? copyDays(s.days, uid) : [];
  s.variantName = name;
}
// переключиться на вариант: текущий встаёт на его место в списке
export function switchVariant(p, id, uid) {
  const s = p.schedule, v = s.variants.find(x => x.id === id);
  if (!v) return;
  s.variants.splice(s.variants.indexOf(v), 1, { id: 'v-' + uid(), name: variantTitle(s), days: s.days });
  s.days = v.days; s.variantName = v.name;
}
// удалить вариант; если удаляется текущий — открывается первый из оставшихся
export function deleteVariant(p, id) {
  const s = p.schedule;
  if (id !== 'current') { s.variants = s.variants.filter(v => v.id !== id); return; }
  const next = s.variants.shift();
  if (!next) return;
  s.days = next.days; s.variantName = next.name;
}


// ---------- перестановка смен перетаскиванием ----------
// Даты остаются на своих местах в календаре, смены встают в них в новом порядке: смена, переставленная
// на место третьей, получает её дату и номер. Выходные, отсыпные и зафиксированные дни не двигаются.
// дни без дат тоже переставляются — тогда меняется только номер смены
export const movableDay = d => !d.locked && (d.kind === 'work' || d.kind === 'prep');
export function moveShift(p, id, beforeId) {
  const days = p.schedule.days, day = days.find(d => d.id === id);
  if (!day || !movableDay(day) || id === beforeId) return false;
  const slots = days.map((d, i) => (movableDay(d) ? i : -1)).filter(i => i >= 0);
  const dates = slots.map(i => days[i].date);
  const rest = days.filter(d => d !== day);
  const at = beforeId ? rest.findIndex(d => d.id === beforeId) : rest.length;
  rest.splice(at < 0 ? rest.length : at, 0, day);
  const order = rest.filter(movableDay);
  slots.forEach((i, k) => { days[i] = order[k]; order[k].date = dates[k]; });
  return true;
}


// ---------- даты от первого дня ----------
// Дни по порядку получают даты подряд, начиная с первого (выходные и отсыпные тоже занимают свой день).
// Зафиксированный день с датой остаётся на ней, следующие идут после него.
export function datesFrom(p, start) {
  p.schedule.info.start = start;
  if (!start) return 0;
  let cur = start, n = 0;
  for (const d of p.schedule.days) {
    if (d.locked && d.date) { cur = addDays(d.date, 1); continue; }
    if (d.date !== cur) n++;
    d.date = cur; cur = addDays(cur, 1);
  }
  return n;
}
