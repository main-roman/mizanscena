// Режиссёрский сценарий: таблица кадров по сценам. Кадры общие с Shot Designer,
// объектив, свет и персонажи подтягиваются из плана, к которому привязан кадр.
import { store, $, $$, uid, esc, toast, download, safeName, storeImage, pickFile, printHTML, numbering, scenesOf, shotAuto, SIZES, MOVES } from './store.js';
import { planSVG, caption, atPhase } from './shapes.js';
import { makeXlsx } from './xlsx.js';
import { CATS, sceneInfo, sceneItems, summaryLine, syncShotProps, catOf, cycleCat, splitItems } from './breakdown.js';
import { srcOf } from './storage.js';

const HEAD = ['№', 'Примечания', 'Режим, хронометраж', 'Раскадровка', 'План', 'Содержание', 'Персонажи', 'Реквизит, грим, костюм', 'Операторская техника, звук'];
const ICON = {
  up: '<svg viewBox="0 0 24 24"><path d="M6 14l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 10l6 6 6-6"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
let root = null;
const project = () => store.project;

// «1:20», «80» или «1 мин 20 сек» -> секунды
export function seconds(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return 0;
  let m = t.match(/^(\d+):(\d{1,2})$/);
  if (m) return +m[1] * 60 + +m[2];
  m = t.match(/(\d+)\s*м/);
  const s = t.match(/(\d+)\s*с/);
  if (m || s) return (m ? +m[1] * 60 : 0) + (s ? +s[1] : 0);
  return parseFloat(t.replace(',', '.')) || 0;
}
export const clock = sec => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
export const totalSeconds = p => p.shots.reduce((a, s) => a + seconds(s.dur), 0);

// Сцены сценария плюс группа кадров без сцены.
function groups(p) {
  const scenes = scenesOf(p), ids = new Set(scenes.map(s => s.id));
  const list = scenes.map((s, i) => ({ id: s.id, title: `${i + 1}. ${s.text || 'Без названия'}`, shots: p.shots.filter(x => x.sceneId === s.id) }));
  const loose = p.shots.filter(x => !ids.has(x.sceneId));
  if (loose.length || !scenes.length) list.push({ id: '', title: scenes.length ? 'Кадры без сцены' : 'Кадры', shots: loose });
  return list;
}

function techLines(p, s) {
  const a = shotAuto(p, s);
  return [s.size, s.move, a.lens, a.lights.length ? 'Свет: ' + a.lights.join(', ') : ''].filter(Boolean);
}

export function mountDirector(el) {
  root = el;
  el.innerHTML = `<div class="ds"><div class="ds-bar"><p class="ds-sum" id="ds-sum"></p>
    <button class="act" data-act="print">PDF</button><button class="act" data-act="csv">Excel</button></div>
    <div class="ds-scroll" id="ds-scroll"></div></div>`;
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
  render();
}
export function unmountDirector() {
  if (!root) return;
  root.removeEventListener('click', onClick);
  root.removeEventListener('input', onInput);
  root.removeEventListener('change', onChange);
  root = null;
}

function summary() {
  const p = project(), sec = totalSeconds(p);
  $('#ds-sum', root).textContent = `Кадров: ${p.shots.length}` + (sec ? `. Хронометраж ${clock(sec)}` : '');
}

// подсказки из разбора сцены: то, чего ещё нет в тексте ячейки; щелчок дописывает в ячейку
const has = (text, t) => String(text || '').toLowerCase().includes(t.toLowerCase());
const sugs = (key, list, cur) => {
  const left = list.filter(t => !has(cur, t));
  return left.length ? `<div class="ds-sug">${left.map(t => `<button data-sug="${key}" data-text="${esc(t)}" title="Дописать в ячейку">+ ${esc(t)}</button>`).join('')}</div>` : '';
};

// пункты, вписанные в ячейку реквизита, с графой из разбора; щелчок меняет графу
const tags = (p, s) => {
  if (!s.sceneId) return '';
  const list = splitItems(s.props).map(t => [t, catOf(p, s.sceneId, t)]).filter(([, c]) => c);
  return list.length ? `<div class="ds-tags">${list.map(([t, c]) => `<button class="ds-tag cat-${c}" data-tag="${esc(t)}" title="${CATS[c]}. Щёлкните, чтобы сменить: реквизит, костюм, грим"><i>${CATS[c]}</i>${esc(t)}</button>`).join('')}</div>` : '';
};

function render() {
  const p = project(), nums = numbering(p), scenes = scenesOf(p), gs = groups(p), info = sceneInfo(p);
  const bd = new Map(scenes.map(s => [s.id, sceneItems(p, s.id, info)]));
  const area = (s, key, ph) => `<textarea class="auto" data-key="${key}" rows="1" placeholder="${esc(ph)}">${esc(s[key])}</textarea>`;
  const row = (s, i, g) => {
    const a = shotAuto(p, s);
    const cams = a.plan ? a.plan.objects.filter(o => o.type === 'camera') : [];
    return `<tr class="ds-row" data-id="${s.id}">
      <td data-label="№" class="ds-num"><b>${nums.get(s.id)}</b>
        ${scenes.length ? `<select data-key="sceneId" aria-label="Сцена" title="Перенести в другую сцену"><option value="">Без сцены</option>${scenes.map((x, k) =>
          `<option value="${x.id}"${x.id === s.sceneId ? ' selected' : ''}>Сцена ${k + 1}</option>`).join('')}</select>` : ''}
        <span class="ds-tools">
          <button class="ico" data-act="up" aria-label="Выше" title="Выше"${i ? '' : ' disabled'}>${ICON.up}</button>
          <button class="ico" data-act="down" aria-label="Ниже" title="Ниже"${i < g.shots.length - 1 ? '' : ' disabled'}>${ICON.down}</button>
          <button class="ico" data-act="del" aria-label="Убрать кадр" title="Убрать кадр">${ICON.del}</button>
        </span></td>
      <td data-label="Примечания">${area(s, 'note', 'Примечание')}</td>
      <td data-label="Режим, хронометраж"><input type="text" data-key="mode" value="${esc(s.mode)}" placeholder="День" aria-label="Режим">
        <input type="text" data-key="dur" value="${esc(s.dur)}" placeholder="0:10" aria-label="Хронометраж" inputmode="numeric"></td>
      <td data-label="Раскадровка" class="ds-pic">${s.frame
        ? `<button class="ds-frame" data-act="frame" title="Заменить картинку"><img src="${esc(srcOf(s.frame))}" alt="Раскадровка кадра ${nums.get(s.id)}"></button><button class="ds-link" data-act="unframe">Убрать</button>`
        : `<button class="ds-frame empty" data-act="frame">Добавить картинку</button>`}</td>
      <td data-label="План" class="ds-pic">
        ${a.plan ? `<a class="ds-plan" href="#/p/${p.id}/plan/${a.plan.id}${s.cameraId ? '/' + s.cameraId : ''}" title="Открыть план">${planSVG(atPhase(a.plan, s.phaseId), { cameraId: s.cameraId || null })}</a>` : ''}
        <select data-key="planId" aria-label="План"><option value="">Без плана</option>${p.plans.map(x => `<option value="${x.id}"${x.id === s.planId ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        ${a.plan ? `<select data-key="cameraId" aria-label="Камера"><option value="">Камера не выбрана</option>${cams.map(c => `<option value="${c.id}"${c.id === s.cameraId ? ' selected' : ''}>${esc(caption(c))}</option>`).join('')}</select>` : ''}
        ${a.plan && (a.plan.phases || []).length > 1 ? `<select data-key="phaseId" aria-label="Фаза"><option value="">Фаза как сейчас на плане</option>${a.plan.phases.map(ph => `<option value="${ph.id}"${ph.id === s.phaseId ? ' selected' : ''}>${esc(ph.name)}</option>`).join('')}</select>` : ''}</td>
      <td data-label="Содержание" class="ds-wide">${area(s, 'content', 'Что происходит в кадре')}</td>
      <td data-label="Персонажи">${area(s, 'chars', a.chars.length ? a.chars.join(', ') : 'Кто в кадре')}${bd.has(s.sceneId) ? sugs('chars', bd.get(s.sceneId).cast, s.chars) : ''}</td>
      <td data-label="Реквизит, грим, костюм">${area(s, 'props', 'Реквизит')}${tags(p, s)}${bd.has(s.sceneId) ? sugs('props', [...bd.get(s.sceneId).props, ...bd.get(s.sceneId).costume, ...bd.get(s.sceneId).makeup], s.props) : ''}</td>
      <td data-label="Операторская техника, звук" class="ds-tech">
        <select data-key="size" aria-label="Крупность">${SIZES.map(v => `<option${v === s.size ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <select data-key="move" aria-label="Движение камеры">${MOVES.map(v => `<option${v === s.move ? ' selected' : ''}>${v}</option>`).join('')}</select>
        ${a.lens || a.lights.length ? `<p class="ds-auto" title="Подтянуто из плана">${[a.lens, a.lights.length ? 'Свет: ' + esc(a.lights.join(', ')) : ''].filter(Boolean).join('<br>')}</p>` : ''}
        ${area(s, 'tech', 'Штатив, ронин, звук')}</td>
    </tr>`;
  };
  const body = gs.map(g => `<tbody data-scene="${g.id}">
      <tr class="ds-scene"><th colspan="9"><span>${g.id ? `<button class="linkbtn ds-scene-open" data-scene-open="${g.id}" title="Открыть текст сцены рядом">${esc(g.title)}</button>` : esc(g.title)}</span>
        ${g.id ? `<a class="act" href="#/p/${p.id}/scene/${g.id}" title="Страница сцены: разбор, локация, планы">Разбор сцены</a>` : ''}<button class="act" data-act="add">Добавить кадр</button>
        ${g.id ? bdLine(bd.get(g.id), p, g.id) : ''}</th></tr>
      ${g.shots.map((s, i) => row(s, i, g)).join('')}
    </tbody>`).join('');
  const hint = scenes.length ? '' : `<p class="empty ds-hint">Сцены появятся здесь сами, когда в сценарии будут строки «Время и место». Кадры можно добавлять уже сейчас.</p>`;
  const scroll = $('#ds-scroll', root), top = scroll.scrollTop;
  scroll.innerHTML = `${hint}<table class="ds-table"><thead><tr>${HEAD.map(h => `<th>${h}</th>`).join('')}</tr></thead>${body}</table>`;
  scroll.scrollTop = top;
  $$('textarea.auto', root).forEach(grow);
  summary();
}

// разбор сцены под её заголовком: графы цветными метками, локации ссылками
function bdLine(items, p, sid) {
  const locs = p.locations.filter(l => l.sceneIds.includes(sid));
  const parts = Object.entries(items).filter(([, v]) => v.length).map(([c, v]) => `<span class="ds-bd-cat cat-${c}"><b>${CATS[c]}</b> ${v.map(esc).join(', ')}</span>`);
  if (locs.length) parts.unshift(`<span class="ds-bd-cat"><b>Локация</b> ${locs.map(l => `<button class="linkbtn" data-loc-open="${l.id}">${esc(l.name)}</button>`).join(', ')}</span>`);
  return parts.length ? `<div class="ds-bd">${parts.join('')}</div>` : '';
}

function grow(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 2 + 'px';
}

const shotOf = el => project().shots.find(s => s.id === el.closest('.ds-row')?.dataset.id);

function onInput(e) {
  const key = e.target.dataset.key, s = shotOf(e.target);
  if (!key || !s) return;
  s[key] = e.target.value;
  if (e.target.matches('textarea.auto')) grow(e.target);
  if (key === 'dur') summary();
  store.touch();
}

function onChange(e) {
  const key = e.target.dataset.key, s = shotOf(e.target);
  // вписанное в реквизит кадра попадает в разбор сцены и в реквизит её локации
  if (s && key === 'props' && e.target.matches('textarea')) {
    if (s.sceneId) { const n = syncShotProps(project(), s.sceneId, s.props, uid); if (n) toast(`В разбор сцены добавлено: ${n}`); }
    store.touch(); render();
    return;
  }
  if (!s || !e.target.matches('select')) return;
  if (key === 'planId') {
    const plan = project().plans.find(x => x.id === s.planId);
    const cams = plan ? plan.objects.filter(o => o.type === 'camera') : [];
    s.cameraId = cams.length === 1 ? cams[0].id : '';
  }
  store.touch();
  render();
}

async function onClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const p = project(), act = b.dataset.act;
  if (b.dataset.tag) {
    const s = shotOf(b);
    if (!s) return;
    const c = cycleCat(p, s.sceneId, b.dataset.tag, uid);
    store.touch(); render();
    toast(`«${b.dataset.tag}»: ${CATS[c].toLowerCase()}`);
    return;
  }
  if (b.dataset.sug) {
    const s = shotOf(b), key = b.dataset.sug;
    if (!s) return;
    s[key] = [s[key].trim().replace(/[,;]\s*$/, ''), b.dataset.text].filter(Boolean).join(', ');
    const t = $(`[data-key="${key}"]`, b.closest('td'));
    t.value = s[key]; grow(t);
    const box = b.parentElement; b.remove(); if (!box.children.length) box.remove();
    store.touch();
    return;
  }
  if (act === 'print') return printDirector(p);
  if (act === 'csv') return csvDirector(p);
  if (act === 'add') {
    const sceneId = b.closest('tbody').dataset.scene;
    const plan = p.plans.find(x => x.sceneId && x.sceneId === sceneId);
    const cams = plan ? plan.objects.filter(o => o.type === 'camera') : [];
    const shot = { id: uid(), sceneId, planId: plan ? plan.id : '', cameraId: cams.length === 1 ? cams[0].id : '', size: SIZES[2], move: MOVES[0],
      content: '', note: '', mode: '', dur: '', chars: '', props: '', tech: '', frame: '' };
    // новый кадр встаёт в конец своей сцены
    const mates = p.shots.filter(x => x.sceneId === sceneId);
    p.shots.splice(mates.length ? p.shots.indexOf(mates[mates.length - 1]) + 1 : p.shots.length, 0, shot);
    store.touch(); render();
    const t = $(`.ds-row[data-id="${shot.id}"] [data-key="content"]`, root);
    t.scrollIntoView({ block: 'center' });
    t.focus({ preventScroll: true });
    return;
  }
  const s = shotOf(b);
  if (!s) return;
  if (act === 'frame') {
    const file = await pickFile('image/*');
    if (!file) return;
    try { s.frame = (await storeImage(file)).src; store.touch(); render(); }
    catch { toast('Не получилось открыть картинку'); }
  }
  if (act === 'unframe') { s.frame = ''; store.touch(); render(); }
  if (act === 'del') {
    if (!confirm('Убрать этот кадр из режиссёрского сценария?')) return;
    p.shots.splice(p.shots.indexOf(s), 1); store.touch(); render();
  }
  if (act === 'up' || act === 'down') {
    const g = groups(p).find(x => x.shots.includes(s)), i = g.shots.indexOf(s), other = g.shots[i + (act === 'up' ? -1 : 1)];
    if (!other) return;
    const ia = p.shots.indexOf(s), ib = p.shots.indexOf(other);
    [p.shots[ia], p.shots[ib]] = [p.shots[ib], p.shots[ia]];
    store.touch(); render();
  }
}

// ---------- выгрузка ----------

function cells(p, s, nums) {
  const a = shotAuto(p, s);
  return [nums.get(s.id), s.note, [s.mode, s.dur].filter(Boolean).join('\n'), s.content, s.chars || a.chars.join('\n'), s.props, [...techLines(p, s), s.tech].filter(Boolean).join('\n')];
}

export function printDirector(p) {
  if (!p.shots.length) return toast('В режиссёрском сценарии пока нет кадров');
  const nums = numbering(p);
  const date = new Date().toLocaleDateString('ru-RU');
  const info = sceneInfo(p);
  const line = id => { const t = id ? summaryLine(sceneItems(p, id, info)) : ''; return t ? `<tr class="pr-bd"><td colspan="9">${esc(t)}</td></tr>` : ''; };
  const body = groups(p).filter(g => g.shots.length).map(g => `<tr class="pr-scene"><th colspan="9">${esc(g.title)}</th></tr>${line(g.id)}` + g.shots.map(s => {
    const c = cells(p, s, nums), a = shotAuto(p, s);
    const td = v => `<td>${esc(v).replace(/\n/g, '<br>')}</td>`;
    return `<tr>${td(c[0])}${td(c[1])}${td(c[2])}<td class="pr-pic">${s.frame ? `<img src="${esc(srcOf(s.frame))}">` : ''}</td>
      <td class="pr-pic">${a.plan ? planSVG(atPhase(a.plan, s.phaseId), { cameraId: s.cameraId || null }) : ''}</td>${td(c[3])}${td(c[4])}${td(c[5])}${td(c[6])}</tr>`;
  }).join('')).join('');
  printHTML(`<div class="pr-head"><p>Режиссёрский сценарий</p><h1>${esc(p.name)}</h1><p>${date}</p></div>
    <table class="pr-table"><thead><tr>${HEAD.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`, 'size: A4 landscape; margin: 10mm;', safeName(p.name) + ', режиссёрский сценарий');
}

// Красивый Excel: заголовок, шапка, сцены отдельными строками, перенос текста, ширина колонок по смыслу.
export function csvDirector(p) {
  const nums = numbering(p), gs = groups(p).filter(g => g.shots.length || g.id);
  if (!gs.length) return toast('В режиссёрском сценарии пока нет сцен и кадров');
  const head = ['№', 'Примечания', 'Режим, хронометраж', 'Содержание', 'Персонажи', 'Реквизит, грим, костюм', 'План и камера', 'Операторская техника, свет, звук'];
  const rows = [
    { cells: ['Режиссёрский сценарий: ' + p.name], style: 1, height: 28, merge: true },
    { cells: [`${new Date().toLocaleDateString('ru-RU')}. Кадров: ${p.shots.length}` + (totalSeconds(p) ? `, хронометраж ${clock(totalSeconds(p))}` : '')], style: 2, merge: true },
    { cells: head, style: 3, height: 32 },
  ];
  for (const g of gs) {
    rows.push({ cells: [g.title], style: 4, height: 22, merge: true });
    const t = g.id ? summaryLine(sceneItems(p, g.id)) : '';
    if (t) rows.push({ cells: [t], style: 2, height: Math.min(120, 15 * Math.ceil(t.length / 150) + 6), merge: true });
    for (const s of g.shots) {
      const c = cells(p, s, nums), a = shotAuto(p, s);
      const cam = a.plan ? [a.plan.name, a.camera ? `Камера ${a.camera.name}, ${a.camera.lens} мм` : ''].filter(Boolean).join('\n') : '';
      const lines = Math.max(1, ...[c[3], c[6], c[4]].map(t => String(t).split('\n').reduce((n, l) => n + Math.ceil((l.length || 1) / 45), 0)));
      rows.push({ cells: [c[0], c[1], c[2], c[3], c[4], c[5], cam, c[6]], style: [6, 5, 5, 5, 5, 5, 5, 5], height: Math.min(300, 15 * lines + 6) });
    }
  }
  const blob = makeXlsx({ name: 'Режиссёрский сценарий', widths: [7, 18, 14, 52, 20, 24, 22, 34], rows, freeze: 4 });
  download(blob, safeName(p.name) + ', режиссёрский сценарий.xlsx');
}
