// Выгрузка КПП в PDF или Excel. Перед выгрузкой спрашиваем, какие столбцы нужны; выбор запоминается.
import { esc, toast, download, safeName, printHTML } from './store.js';
import { sceneInfo, sceneItems } from './breakdown.js';
import { castList, dayInfo, synopsisOf, sceneMeta, clockText, shiftNo, DAY_KINDS, variantTitle, objectOf } from './schedmodel.js';
import { makeXlsx } from './xlsx.js';

// [id, заголовок, ширина в Excel, по умолчанию]
const COLS = [
  ['dur', 'Хрон', 8, true],
  ['time', 'Режим', 9, true],
  ['ie', 'Инт / нат', 8, true],
  ['obj', 'Объект', 22, true],
  ['sub', 'Подобъект', 18, true],
  ['syn', 'Синопсис', 40, true],
  ['cast', 'Персонажи / массовка', 28, true],
  ['makeup', 'Грим / костюм', 24, true],
  ['props', 'Реквизит / игровой транспорт', 28, true],
  ['sfx', 'Спецэффекты / трюки', 22, false],
  ['sound', 'Звук', 18, false],
  ['note', 'Примечание', 22, true],
];
const KEY = 'miz:kpp-cols';
const title = s => s.charAt(0) + s.slice(1).toLowerCase();

function pick() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* по умолчанию */ }
  const on = id => (saved ? saved.includes(id) : COLS.find(c => c[0] === id)[3]);
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'ask kpp-cols';
    d.innerHTML = `<form method="dialog"><h3>Что вывести в КПП</h3>
      <p class="ask-text">Номер сцены выводится всегда. Отметьте остальные столбцы.</p>
      <div class="kc-list">${COLS.map(([id, t]) => `<label class="field check"><input type="checkbox" value="${id}"${on(id) ? ' checked' : ''}><span>${t}</span></label>`).join('')}</div>
      <div class="ask-row"><button class="act" value="cancel">Отмена</button><button class="act main" value="ok">Выгрузить</button></div></form>`;
    d.addEventListener('close', () => {
      const cols = [...d.querySelectorAll('input:checked')].map(i => i.value);
      d.classList.add('out'); setTimeout(() => d.remove(), 200);
      if (d.returnValue !== 'ok') return resolve(null);
      try { localStorage.setItem(KEY, JSON.stringify(cols)); } catch { /* не страшно */ }
      resolve(cols);
    });
    document.body.append(d);
    d.showModal();
  });
}

// Значения ячеек сцены по столбцам.
function cellsOf(p, s, info, cols) {
  const it = sceneItems(p, s.id, info);
  const join = (label, list) => (list.length ? `${label}: ${list.join(', ')}` : '');
  const V = {
    dur: s.dur || '', time: s.time ? title(s.time) : '', ie: s.ie ? title(s.ie) : '',
    obj: objectOf(p, s).name || s.place || s.text, sub: objectOf(p, s).sub,
    syn: synopsisOf(p, s),
    cast: [join('Персонажи', s.chars.map(title).concat(it.cast.filter(c => !s.chars.includes(c)))), join('Массовка', it.extras)].filter(Boolean).join('\n'),
    makeup: [join('Грим', it.makeup), join('Костюм', it.costume)].filter(Boolean).join('\n'),
    props: [join('Реквизит', it.props), join('Транспорт', it.vehicles), join('Животные', it.animals)].filter(Boolean).join('\n'),
    sfx: [join('Эффекты', it.sfx), join('Трюки', it.stunts)].filter(Boolean).join('\n'),
    sound: it.sound.join(', '),
    note: sceneMeta(p, s.id).note,
  };
  return cols.map(c => V[c] || '');
}

function groups(p, info) {
  const sch = p.schedule, cast = castList(p, info), list = [];
  sch.days.forEach((d, i) => {
    const di = dayInfo(p, d, info, cast);
    const date = d.date ? new Date(d.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' }) : '';
    list.push({
      head: (d.kind === 'work' ? [date, `Смена №${shiftNo(p, d)}${d.night ? ', ночная' : ''}`, `сцен: ${di.scenes.length}`, di.dur ? `хрон: ${clockText(di.dur)}` : '', d.kppNote] : [date, DAY_KINDS[d.kind], d.kppNote]).filter(Boolean).join(' · '),
      rows: d.items.map(x => x.type === 'banner' ? { banner: x.text } : { scene: info.find(s => s.id === x.sceneId) }).filter(r => r.banner || r.scene),
    });
  });
  const done = new Set(sch.days.flatMap(d => d.items.map(x => x.sceneId)));
  const rest = info.filter(s => !done.has(s.id));
  if (rest.length) list.push({ head: 'Не разложено по дням', rows: rest.map(scene => ({ scene })) });
  return list;
}

export async function exportKPP(p, fmt) {
  if (!p.schedule.days.length) return toast('В КПП пока нет съёмочных дней');
  const cols = await pick();
  if (!cols) return;
  const info = sceneInfo(p), use = COLS.filter(c => cols.includes(c[0])), gs = groups(p, info);
  const head = ['Сцена', ...use.map(c => c[1])];
  const first = p.schedule.days.find(d => d.date), last = [...p.schedule.days].reverse().find(d => d.date);
  const period = first && last ? `с ${new Date(first.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} по ${new Date(last.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}` : '';
  const vname = p.schedule.variants.length ? variantTitle(p.schedule) : '';
  const name = safeName(p.name) + ', КПП' + (vname ? `, ${safeName(vname)}` : '');
  if (fmt === 'xlsx') {
    const rows = [
      { cells: [`КПП «${p.name}»${vname ? ` (${vname})` : ''} ${period}`.trim()], style: 1, height: 28, merge: true },
      { cells: head, style: 3, height: 32 },
    ];
    for (const g of gs) {
      rows.push({ cells: [g.head], style: 4, height: 22, merge: true });
      for (const r of g.rows) {
        if (r.banner) { rows.push({ cells: [r.banner], style: 2, merge: true }); continue; }
        const c = cellsOf(p, r.scene, info, cols);
        const lines = Math.max(1, ...c.map((t, i) => String(t).split('\n').reduce((n, l) => n + Math.ceil((l.length || 1) / Math.max(6, use[i][2] * 1.1)), 0)));
        rows.push({ cells: [String(r.scene.n), ...c], style: [6, ...c.map(() => 5)], height: Math.min(300, 15 * lines + 6) });
      }
    }
    download(makeXlsx({ name: 'КПП', widths: [7, ...use.map(c => c[2])], rows, freeze: 3 }), name + '.xlsx');
    toast('КПП сохранён в загрузки');
    return;
  }
  const td = v => `<td>${esc(v).replace(/\n/g, '<br>')}</td>`;
  const body = gs.map(g => `<tr class="pr-scene"><th colspan="${head.length}">${esc(g.head)}</th></tr>` + g.rows.map(r => r.banner
    ? `<tr class="kp-banner"><td colspan="${head.length}">${esc(r.banner)}</td></tr>`
    : `<tr><td><b>${r.scene.n}</b></td>${cellsOf(p, r.scene, info, cols).map(td).join('')}</tr>`).join('')).join('');
  printHTML(`<div class="pr-head"><p>КПП</p><h1>${esc(p.name)}</h1><p>${esc([vname && `Вариант «${vname}»`, period].filter(Boolean).join(' · '))}</p></div>
    <table class="pr-table kp-table"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`, 'size: A4 landscape; margin: 10mm;', name);
}
