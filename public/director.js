// Режиссёрский сценарий: таблица кадров по сценам. Кадры общие с Shot Designer,
// объектив, свет и персонажи подтягиваются из плана, к которому привязан кадр.
import { framesOf, setFrames, addFrameFiles } from './store.js';
import { store, $, $$, uid, esc, toast, download, safeName, storeImage, pickFile, printHTML, numbering, scenesOf, shotAuto, SIZES, MOVES } from './store.js';
import { planSVG, caption, atPhase } from './shapes.js';
import { makeXlsx } from './xlsx.js';
import { CATS, sceneInfo, sceneItems, syncShotProps, catOf, cycleCat, splitItems, guessCat } from './breakdown.js';
import { srcOf } from './storage.js';
import { pointerDrag } from './dragsort.js';
import { openPhoto, openKind } from './split.js';

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

// Перетаскивание строк: хватать можно за любое место строки, кроме полей и кнопок.
// Кадр встаёт перед или после строки под мышью; в другой сцене — становится кадром той сцены.
let dragBound = false;
const NOGRAB = 'input, textarea, select, button, a, [contenteditable], .ds-chips';
const unmarkRows = () => { for (const c of ['drop-before', 'drop-after']) for (const x of root.querySelectorAll('.' + c)) x.classList.remove(c); };
function rowSpot(y) {
  const rows = [...root.querySelectorAll('.ds-row:not(.drag-src)')];
  const at = document.elementFromPoint(innerWidth / 2, y);
  const head = at && at.closest('.ds-scene');
  if (head) return { scene: head.closest('tbody').dataset.scene };
  const r = rows.find(x => { const b = x.getBoundingClientRect(); return y >= b.top && y <= b.bottom; }) || null;
  if (!r) return null;
  const b = r.getBoundingClientRect();
  return { row: r, after: y > b.top + b.height / 2 };
}
function bindDrag(el) {
  if (dragBound) return;
  dragBound = true;
  pointerDrag(el, {
    scroller: () => $('#ds-scroll', el),
    pick(e) {
      const row = e.target.closest('.ds-row');
      if (!row || e.target.closest(NOGRAB)) return null;
      // ширина ячеек — у копии, что едет за мышью, такая же, как у строки
      for (const td of row.children) td.style.width = td.getBoundingClientRect().width + 'px';
      return { el: row, data: row.dataset.id };
    },
    move(id, x, y) {
      unmarkRows();
      const t = rowSpot(y);
      if (t && t.row) t.row.classList.add(t.after ? 'drop-after' : 'drop-before');
    },
    drop(id, x, y) {
      const t = rowSpot(y), p = project(), s = p.shots.find(q => q.id === id);
      if (!t || !s) return;
      p.shots.splice(p.shots.indexOf(s), 1);
      if (t.row) {
        const o = p.shots.find(q => q.id === t.row.dataset.id);
        if (!o) { p.shots.push(s); }
        else { s.sceneId = o.sceneId; p.shots.splice(p.shots.indexOf(o) + (t.after ? 1 : 0), 0, s); }
      } else {
        // на заголовок сцены — первым кадром этой сцены
        s.sceneId = t.scene;
        const first = p.shots.find(q => q.sceneId === t.scene);
        p.shots.splice(first ? p.shots.indexOf(first) : p.shots.length, 0, s);
      }
      store.touch();
    },
    end() { unmarkRows(); render(); },
  });
}

export function mountDirector(el) {
  root = el;
  bindDrag(el);
  el.innerHTML = `<div class="ds"><div class="ds-bar"><p class="ds-sum" id="ds-sum"></p>
    <button class="act" data-act="print">PDF</button><button class="act" data-act="csv">Excel</button></div>
    <div class="ds-scroll" id="ds-scroll"></div></div>`;
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
  el.addEventListener('keydown', onKey);
  render();
}
export function unmountDirector() {
  if (!root) return;
  root.removeEventListener('click', onClick);
  root.removeEventListener('input', onInput);
  root.removeEventListener('change', onChange);
  root.removeEventListener('keydown', onKey);
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

const title = t => t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
const listOf = v => splitItems(v);
const has2 = (list, t) => list.some(x => x.toLowerCase() === t.toLowerCase());
// Персонажи кадра — плашками; добавить из персонажей сценария (сначала — этой сцены), убрать крестиком.
function charChips(s, sceneChars, allChars) {
  const cur = listOf(s.chars), left = [...sceneChars, ...allChars.filter(c => !sceneChars.includes(c))].filter(c => !has2(cur, title(c)) && !has2(cur, c));
  return `<div class="ds-chips">${cur.map(t => `<span class="ds-chip ds-char">${esc(t)}<button class="ds-chip-x" data-chipdel="chars" data-text="${esc(t)}" title="Убрать из кадра" aria-label="Убрать">×</button></span>`).join('')}
    ${left.length ? `<select class="ds-chip-add" data-charadd aria-label="Добавить персонажа"><option value="">+ персонаж</option>${left.map(c => `<option value="${esc(title(c))}">${esc(title(c))}${sceneChars.includes(c) ? '' : ' (не в сцене)'}</option>`).join('')}</select>` : ''}</div>`;
}
// Реквизит, костюм, грим кадра — цветными плашками, как в разборе; щелчок по названию меняет графу, крестик убирает.
function propChips(p, s, offer) {
  const cur = listOf(s.props), left = offer.filter(t => !has2(cur, t));
  const cat = t => (s.sceneId && catOf(p, s.sceneId, t)) || guessCat(t);
  return `<div class="ds-chips">${cur.map(t => { const c = cat(t); return `<span class="ds-chip ds-tag cat-${c}"><button class="ds-chip-t" data-tag="${esc(t)}" title="${CATS[c]}. Щёлкните, чтобы сменить: реквизит, костюм, грим">${esc(t)}</button><button class="ds-chip-x" data-chipdel="props" data-text="${esc(t)}" title="Убрать из кадра" aria-label="Убрать">×</button></span>`; }).join('')}
    <input class="ds-chip-add" data-chipadd="props" list="ds-props-${s.id}" placeholder="+ добавить" aria-label="Добавить реквизит, костюм или грим">
    <datalist id="ds-props-${s.id}">${left.map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>`;
}

// пункты, вписанные в ячейку реквизита, с графой из разбора; щелчок меняет графу
const tags = (p, s) => {
  if (!s.sceneId) return '';
  const list = splitItems(s.props).map(t => [t, catOf(p, s.sceneId, t)]).filter(([, c]) => c);
  return list.length ? `<div class="ds-tags">${list.map(([t, c]) => `<button class="ds-tag cat-${c}" data-tag="${esc(t)}" title="${CATS[c]}. Щёлкните, чтобы сменить: реквизит, костюм, грим"><i>${CATS[c]}</i>${esc(t)}</button>`).join('')}</div>` : '';
};

function render() {
  const p = project(), nums = numbering(p), scenes = scenesOf(p), gs = groups(p), info = sceneInfo(p);
  const bd = new Map(scenes.map(s => [s.id, sceneItems(p, s.id, info)]));
  const allChars = [...new Set(info.flatMap(x => x.chars))];
  let filled = 0;
  for (const s of p.shots) {
    if (s.filled === 2 || !bd.has(s.sceneId)) continue;
    const it = bd.get(s.sceneId), props = [...it.props, ...it.costume, ...it.makeup], chars = it.cast.map(title);
    if (s.filled === true) { // заполнено раньше через запятую — пункты с запятой внутри разваливались
      if (s.props === props.join(', ')) s.props = props.join('\n');
      if (s.chars === chars.join(', ')) s.chars = chars.join('\n');
    } else {
      if (!String(s.props || '').trim()) s.props = props.join('\n');
      if (!String(s.chars || '').trim()) s.chars = chars.join('\n');
    }
    s.filled = 2; filled++;
  }
  if (filled) store.touch();
  const area = (s, key, ph) => `<textarea class="auto" data-key="${key}" rows="1" placeholder="${esc(ph)}">${esc(s[key])}</textarea>`;
  const row = (s, i, g) => {
    const a = shotAuto(p, s);
    const cams = a.plan ? a.plan.objects.filter(o => o.type === 'camera') : [];
    return `<tr class="ds-row" data-id="${s.id}">
      <td data-label="№" class="ds-num"><b>${nums.get(s.id)}</b>
        ${scenes.length ? `<select data-key="sceneId" aria-label="Сцена" title="Перенести в другую сцену"><option value="">Без сцены</option>${scenes.map((x, k) =>
          `<option value="${x.id}"${x.id === s.sceneId ? ' selected' : ''}>Сцена ${k + 1}</option>`).join('')}</select>` : ''}
        <span class="ds-tools">
          <span class="ds-grip" title="Перетащите строку вверх или вниз — кадр встанет на новое место и в разделе «Кадры»" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg></span>
          <button class="ico" data-act="del" aria-label="Убрать кадр" title="Убрать кадр">${ICON.del}</button>
        </span></td>
      <td data-label="Примечания">${area(s, 'note', 'Примечание')}</td>
      <td data-label="Режим, хронометраж"><input type="text" data-key="mode" value="${esc(s.mode)}" placeholder="День" aria-label="Режим">
        <input type="text" data-key="dur" value="${esc(s.dur)}" placeholder="0:10" aria-label="Хронометраж" inputmode="numeric"></td>
      <td data-label="Раскадровка" class="ds-pic ds-frames" data-framedrop="${s.id}">${framesOf(s).length
        ? `<div class="ds-fstrip n${Math.min(4, framesOf(s).length)}">${framesOf(s).map((f, k) => `<span class="ds-fr"><button class="ds-frame" data-act="view-frame" data-k="${k}" title="Открыть крупно"><img src="${esc(srcOf(f))}" alt="Раскадровка кадра ${nums.get(s.id)}, ${k + 1}"></button><button class="ds-fx" data-act="unframe" data-k="${k}" title="Убрать эту картинку" aria-label="Убрать картинку">×</button></span>`).join('')}</div>
          <button class="ds-link" data-act="frame">+ ещё картинки</button>`
        : `<button class="ds-frame empty" data-act="frame">Добавить картинки</button>`}</td>
      <td data-label="План" class="ds-pic">
        ${a.plan ? `<button class="ds-plan" data-act="view-mise" title="Открыть мизансцену в окошке справа">${planSVG(atPhase(a.plan, s.phaseId), { cameraId: s.cameraId || null })}</button>`
          : `<button class="ds-frame empty" data-act="view-mise">Выбрать мизансцену</button>`}</td>
      <td data-label="Содержание" class="ds-wide">${area(s, 'content', 'Что происходит в кадре')}</td>
      <td data-label="Персонажи">${charChips(s, bd.has(s.sceneId) ? bd.get(s.sceneId).cast : [], allChars)}</td>
      <td data-label="Реквизит, грим, костюм">${propChips(p, s, bd.has(s.sceneId) ? [...bd.get(s.sceneId).props, ...bd.get(s.sceneId).costume, ...bd.get(s.sceneId).makeup] : [])}</td>
      <td data-label="Операторская техника, звук" class="ds-tech">
        <select data-key="size" aria-label="Крупность"><option value=""${s.size ? '' : ' selected'}>—</option>${SIZES.map(v => `<option${v === s.size ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <input data-key="move" list="ds-moves" value="${esc(s.move)}" placeholder="Статика, штатив" aria-label="Движение камеры и техника">
        ${a.lens || a.lights.length ? `<p class="ds-auto" title="Подтянуто из плана">${[a.lens, a.lights.length ? 'Свет: ' + esc(a.lights.join(', ')) : ''].filter(Boolean).join('<br>')}</p>` : ''}
        ${area(s, 'tech', 'Штатив, ронин, звук')}</td>
    </tr>`;
  };
  const body = gs.map(g => `<tbody data-scene="${g.id}">
      <tr class="ds-scene"><th colspan="9"><span>${g.id ? `<button class="linkbtn ds-scene-open" data-scene-open="${g.id}" title="Открыть разбор сцены рядом">${esc(g.title)}</button>` : esc(g.title)}</span>
        <button class="act" data-act="add">Добавить кадр</button></th></tr>
      ${g.shots.map((s, i) => row(s, i, g)).join('')}
    </tbody>`).join('');
  const hint = scenes.length ? '' : `<p class="empty ds-hint">Сцены появятся здесь сами, когда в сценарии будут строки «Время и место». Кадры можно добавлять уже сейчас.</p>`;
  const scroll = $('#ds-scroll', root), top = scroll.scrollTop;
  scroll.innerHTML = `${hint}<datalist id="ds-moves">${MOVES.map(v => `<option value="${v}">`).join('')}</datalist><table class="ds-table"><thead><tr>${HEAD.map(h => `<th>${h}</th>`).join('')}</tr></thead>${body}</table>`;
  scroll.scrollTop = top;
  $$('textarea.auto', root).forEach(grow);
  summary();
}

function grow(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 2 + 'px';
}

const shotOf = el => project().shots.find(s => s.id === el.closest('.ds-row')?.dataset.id);

function onKey(e) {
  if (e.key === 'Enter' && e.target.matches('[data-chipadd]')) { e.preventDefault(); addProp(shotOf(e.target), e.target.value); }
}

function onInput(e) {
  const key = e.target.dataset.key, s = shotOf(e.target);
  if (!key || !s) return;
  s[key] = e.target.value;
  if (e.target.matches('textarea.auto')) grow(e.target);
  if (key === 'dur') summary();
  store.touch();
}

function addProp(s, t) {
  t = t.trim();
  if (!s || !t || has2(listOf(s.props), t)) return;
  s.props = [...listOf(s.props), t].join('\n');
  // новое попадает в разбор сцены и в реквизит её локации (одним пунктом, даже с запятой внутри)
  if (s.sceneId) { const n = syncShotProps(project(), s.sceneId, t + '\n', uid); if (n) toast(`В разбор сцены добавлено: ${t}`); }
  store.touch(); render();
  $(`.ds-row[data-id="${s.id}"] [data-chipadd]`, root)?.focus();
}

function onChange(e) {
  const key = e.target.dataset.key, s = shotOf(e.target);
  if (e.target.matches('[data-charadd]') && e.target.value) {
    const sh = shotOf(e.target); sh.chars = [...listOf(sh.chars), e.target.value].join('\n'); store.touch(); render(); return;
  }
  if (e.target.matches('[data-chipadd]')) { addProp(shotOf(e.target), e.target.value); return; }
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
  if (b.dataset.chipdel) {
    const s = shotOf(b), key = b.dataset.chipdel;
    if (!s) return;
    s[key] = listOf(s[key]).filter(t => t.toLowerCase() !== b.dataset.text.toLowerCase()).join('\n');
    store.touch(); render();
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
    // мизансцена не подключается сама — её выбирают в кадре
    const shot = { id: uid(), sceneId, planId: '', cameraId: '', size: '', move: '',
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
    const files = await pickFile('image/*', true);
    if (!files || !files.length) return;
    toast(files.length > 1 ? `Сжимаю картинки: ${files.length}…` : 'Сжимаю картинку…');
    const n = await addFrameFiles(s, [...files], 1800);
    store.touch(); render();
    if (!n) toast('Не получилось открыть картинку');
  }
  if (act === 'view-frame') { openPhoto('shot', s.id, b.dataset.k || '0'); return; }
  if (act === 'view-mise') { openKind('mise', s.id); return; }
  if (act === 'unframe') { const l = framesOf(s).slice(); l.splice(+(b.dataset.k || 0), 1); setFrames(s, l); store.touch(); render(); }
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
  const body = groups(p).filter(g => g.shots.length).map(g => `<tr class="pr-scene"><th colspan="9">${esc(g.title)}</th></tr>` + g.shots.map(s => {
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

document.addEventListener('miz:shot-changed', () => { if (document.body.dataset.view === 'director') render(); });

// картинки из папки — прямо в ячейку раскадровки (сколько угодно сразу)
const filesOver = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
document.addEventListener('dragover', e => {
  const c = e.target.closest && e.target.closest('#view-director [data-framedrop]');
  if (!c || !filesOver(e)) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  for (const x of document.querySelectorAll('#view-director .frame-hot')) if (x !== c) x.classList.remove('frame-hot');
  c.classList.add('frame-hot');
});
document.addEventListener('dragleave', e => { const c = e.target.closest && e.target.closest('#view-director .frame-hot'); if (c && !c.contains(e.relatedTarget)) c.classList.remove('frame-hot'); });
document.addEventListener('drop', async e => {
  const c = e.target.closest && e.target.closest('#view-director [data-framedrop]');
  if (!c || !filesOver(e)) return;
  e.preventDefault(); c.classList.remove('frame-hot');
  const s = project().shots.find(x => x.id === c.dataset.framedrop), files = [...e.dataTransfer.files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name));
  if (!s || !files.length) return toast('Это не картинки');
  toast(files.length > 1 ? `Сжимаю картинки: ${files.length}…` : 'Сжимаю картинку…');
  const n = await addFrameFiles(s, files, 1800);
  store.touch(); render(); toast(`Раскадровка кадра: +${n}`);
});
