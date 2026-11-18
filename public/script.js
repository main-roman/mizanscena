// Редактор сценария: блоки как в «КИТ Сценаристе», разметка по российскому формату.
import { store, $, $$, uid, esc, toast, download, safeName, pickFile, printHTML, reduced } from './store.js';
import { importScriptFile } from './importers.js';

export const SCRIPT_FILES = '.docx,.pdf,.fountain,.fdx,.txt,text/plain';
// Читает сценарий из Word, PDF или текстового файла и кладёт его в проект. Возвращает число сцен.
export async function loadScriptInto(p, file) {
  const parsed = await importScriptFile(file, { parseFountain, parseFDX });
  if (!parsed.blocks.length) throw new Error('empty');
  p.script.blocks = parsed.blocks;
  if (parsed.title && /^(Новый проект|Без названия)$/.test(p.name)) p.name = parsed.title.charAt(0) + parsed.title.slice(1).toLowerCase();
  store.touch();
  return parsed.blocks.filter(b => b.type === 'scene').length;
}

export const TYPES = {
  scene: 'Время и место', action: 'Действие', character: 'Персонаж', dialogue: 'Реплика',
  paren: 'Ремарка', transition: 'Переход', title: 'Титр', note: 'Примечание',
};
const ORDER = Object.keys(TYPES);
// какой блок начинается по Enter и во что блок превращается по Enter в пустой строке; Tab идёт по кругу через все типы
const ENTER = { scene: 'action', action: 'action', character: 'dialogue', dialogue: 'action', paren: 'dialogue', transition: 'scene', title: 'action', note: 'action' };
const EMPTY_ENTER = { scene: 'action', action: 'scene', character: 'action', dialogue: 'action', paren: 'dialogue', transition: 'action', title: 'action', note: 'action' };

let root = null, sheet = null, syncTimer = 0;

const blockHTML = b => `<div data-type="${b.type}"${b.type === 'scene' && b.id ? ` data-id="${b.id}"` : ''}>${esc(b.text) || '<br>'}</div>`;

export function mountScript(el) {
  root = el;
  const blocks = store.project.script.blocks;
  el.innerHTML = `
    <div class="sc">
      <aside class="sc-nav"><h2>Сцены</h2><ol id="sc-scenes"></ol><p class="sc-stat" id="sc-stat"></p></aside>
      <div class="sc-main">
        <div class="sc-bar" role="toolbar" aria-label="Тип блока">
          <div class="sc-types">${ORDER.map((t, i) => `<button data-type="${t}" title="Alt+${i + 1}">${TYPES[t]}</button>`).join('')}</div>
          <div class="sc-file">
            <button data-act="open" title="Word, PDF, Fountain, Final Draft или текст">Открыть файл</button>
            <button data-act="fountain" title="Скачать в формате Fountain">Fountain</button>
            <button data-act="pdf">PDF</button>
          </div>
        </div>
        <div class="sc-scroll"><div class="sheet" id="sheet" contenteditable="true" spellcheck="true" aria-label="Текст сценария">${
          (blocks.length ? blocks : [{ type: 'scene', text: '' }]).map(blockHTML).join('')}</div></div>
        <p class="sc-keys">Enter начинает следующий блок. Tab меняет тип блока по кругу, Shift+Tab в обратную сторону.</p>
      </div>
    </div>`;
  sheet = $('#sheet', el);
  sheet.addEventListener('keydown', onKey);
  sheet.addEventListener('input', onInput);
  sheet.addEventListener('paste', onPaste);
  // кнопки не должны забирать курсор из текста
  $('.sc-bar', el).addEventListener('pointerdown', e => { if (e.target.closest('.sc-types button')) e.preventDefault(); });
  $('.sc-bar', el).addEventListener('click', onBar);
  $('#sc-scenes', el).addEventListener('click', e => {
    const li = e.target.closest('li');
    if (!li) return;
    const b = sheet.querySelector(`[data-id="${li.dataset.id}"]`);
    if (!b) return;
    b.scrollIntoView({ block: 'start', behavior: reduced.matches ? 'auto' : 'smooth' });
    caretTo(b, true);
  });
  document.addEventListener('selectionchange', markType);
  refresh();
}

export function unmountScript() {
  if (!root) return;
  if (syncTimer) { clearTimeout(syncTimer); sync(); }
  document.removeEventListener('selectionchange', markType);
  root = sheet = null;
}

// ---------- курсор и блоки ----------

function current() {
  const s = getSelection();
  if (!s.rangeCount || !sheet) return null;
  let node = s.anchorNode;
  if (!node || !sheet.contains(node)) return null;
  if (node === sheet) return sheet.children[Math.min(s.anchorOffset, sheet.children.length - 1)] || null;
  while (node && node.parentNode !== sheet) node = node.parentNode;
  return node && node.nodeType === 1 ? node : null;
}

function caretTo(block, end = false) {
  const r = document.createRange();
  r.selectNodeContents(block);
  r.collapse(!end);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
  sheet.focus({ preventScroll: true });
}

function setType(block, type) {
  block.dataset.type = type;
  if (type !== 'scene') block.removeAttribute('data-id');
  markType();
  queueSync();
}

function markType() {
  if (!root) return;
  const b = current();
  $$('.sc-types button', root).forEach(x => x.setAttribute('aria-pressed', !!b && x.dataset.type === b.dataset.type));
}

const isEmpty = b => !b.textContent.replace(/​/g, '').trim();

function onKey(e) {
  const b = current();
  if (!b) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (isEmpty(b)) { setType(b, EMPTY_ENTER[b.dataset.type] || 'action'); return; }
    const type = b.dataset.type;
    const s = getSelection(), tail = document.createRange();
    tail.selectNodeContents(b);
    tail.setStart(s.focusNode, s.focusOffset);
    const atEnd = !tail.toString().trim();
    document.execCommand('insertParagraph');
    let nb = current();
    if (!nb || nb === b) { // браузер не разрезал блок сам
      nb = document.createElement('div');
      nb.innerHTML = '<br>';
      b.after(nb);
      caretTo(nb);
    }
    nb.removeAttribute('data-id');
    nb.dataset.type = atEnd ? ENTER[type] : type;
    if (!nb.firstChild) nb.innerHTML = '<br>';
    nb.scrollIntoView({ block: 'nearest' });
    markType();
    queueSync();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const i = Math.max(0, ORDER.indexOf(b.dataset.type));
    setType(b, ORDER[(i + (e.shiftKey ? ORDER.length - 1 : 1)) % ORDER.length]);
  } else if (e.altKey && /^Digit[1-8]$/.test(e.code)) {
    e.preventDefault();
    setType(b, ORDER[+e.code.slice(5) - 1]);
  }
}

function onInput() {
  // после «выделить всё и удалить» браузер может оставить лист без блоков
  if (!sheet.querySelector(':scope > div')) {
    const text = sheet.textContent;
    sheet.innerHTML = blockHTML({ type: text ? 'action' : 'scene', text });
    caretTo(sheet.firstChild, true);
  }
  for (const node of [...sheet.childNodes]) {
    if (node.nodeType === 3 && node.textContent.trim()) { const d = document.createElement('div'); d.dataset.type = 'action'; node.replaceWith(d); d.append(node); }
    else if (node.nodeType === 1 && !node.dataset.type) node.dataset.type = 'action';
  }
  queueSync();
}

function onPaste(e) {
  e.preventDefault();
  const text = (e.clipboardData.getData('text/plain') || '').replace(/\r/g, '');
  if (!text.includes('\n')) { document.execCommand('insertText', false, text); return; }
  const b = current(), blocks = parseFountain(text).blocks;
  if (!blocks.length) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = blocks.map(blockHTML).join('');
  const last = tpl.content.lastChild;
  if (b && isEmpty(b)) b.replaceWith(tpl.content); else if (b) b.after(tpl.content); else sheet.append(tpl.content);
  caretTo(last, true);
  queueSync();
}

async function onBar(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.type) {
    const b = current() || sheet.lastElementChild;
    setType(b, btn.dataset.type);
    if (!current()) caretTo(b, true);
    return;
  }
  sync();
  const p = store.project;
  if (btn.dataset.act === 'pdf') printScript(p);
  if (btn.dataset.act === 'fountain') download(new Blob([toFountain(p)], { type: 'text/plain;charset=utf-8' }), safeName(p.name) + '.fountain');
  if (btn.dataset.act === 'open') {
    const file = await pickFile(SCRIPT_FILES);
    if (!file) return;
    const has = p.script.blocks.some(b => b.text.trim());
    if (has && !confirm('Заменить текущий сценарий текстом из файла? Привязки кадров и планов к сценам сбросятся.')) return;
    try {
      const n = await loadScriptInto(p, file);
      const host = root;
      unmountScript();
      mountScript(host);
      toast(`Сценарий открыт: сцен ${n}. Они уже есть в режиссёрском сценарии`);
    } catch (err) {
      console.error(err);
      toast('Не получилось прочитать этот файл');
    }
  }
}

// ---------- текст на листе -> проект ----------

function queueSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 250);
}

function sync() {
  syncTimer = 0;
  if (!sheet) return;
  const seen = new Set();
  const blocks = [...sheet.children].map(el => {
    const type = TYPES[el.dataset.type] ? el.dataset.type : 'action';
    const b = { type, text: el.textContent.replace(/[ ​]/g, ' ').replace(/\s+$/, '') };
    if (type === 'scene') {
      let id = el.dataset.id;
      if (!id || seen.has(id)) { id = 'sc-' + uid(); el.dataset.id = id; }
      seen.add(id);
      b.id = id;
    }
    return b;
  });
  const p = store.project;
  if (JSON.stringify(blocks) !== JSON.stringify(p.script.blocks)) { p.script.blocks = blocks; store.touch(); }
  refresh();
}

function refresh() {
  const blocks = store.project.script.blocks, scenes = blocks.filter(b => b.type === 'scene');
  sheet.classList.toggle('blank', blocks.length <= 1 && !blocks.some(b => b.text));
  $('#sc-scenes', root).innerHTML = scenes.map(s => `<li data-id="${s.id}">${esc(s.text) || 'Без названия'}</li>`).join('')
    || '<p class="empty">Начните со строки «Время и место», например: ИНТ. КУХНЯ. ВЕЧЕР</p>';
  const st = scriptStats(store.project);
  $('#sc-stat', root).textContent = blocks.some(b => b.text) ? `Сцен: ${st.scenes}. Страниц примерно ${st.pages}, это около ${st.pages} мин экрана.` : '';
}

// Оценка объёма: страница сценария в этой разметке вмещает около 58 строк и равна примерно минуте экрана.
export function scriptStats(p) {
  const width = { action: 58, scene: 58, dialogue: 29, paren: 19, character: 31, transition: 58, title: 58, note: 58 };
  let lines = 0, scenes = 0;
  for (const b of p.script.blocks) {
    if (b.type === 'scene') scenes++;
    if (b.type === 'note') continue;
    lines += Math.max(1, Math.ceil(b.text.length / width[b.type])) + (b.type === 'scene' ? 2 : b.type === 'dialogue' || b.type === 'paren' ? 0 : 1);
  }
  return { scenes, pages: Math.max(1, Math.ceil(lines / 58)) };
}

// ---------- Fountain, FDX, печать ----------

const HEADING = /^(INT\.?\/EXT|EXT\.?\/INT|INT|EXT|EST|I\/E|ИНТ\.?\/НАТ|НАТ\.?\/ИНТ|ИНТ|НАТ|ЭКСТ)[.\s]/i;
const upper = t => t === t.toUpperCase() && /[A-ZА-ЯЁ]/.test(t);

export function parseFountain(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const blocks = [];
  let i = 0, title = '';
  // титульный лист: строки вида «Ключ: значение» до первой пустой строки
  if (/^(title|credit|authors?|source|draft date|contact|notes|copyright)\s*:/i.test((lines.find(l => l.trim()) || '').trim())) {
    while (i < lines.length && !lines[i].trim()) i++;
    for (; i < lines.length && lines[i].trim(); i++) { const m = lines[i].match(/^title\s*:\s*(.+)/i); if (m) title = m[1].trim(); }
  }
  let blank = true, talk = false;
  const add = (type, text) => blocks.push(type === 'scene' ? { type, text, id: 'sc-' + uid() } : { type, text });
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) { blank = true; talk = false; continue; }
    const next = (lines[i + 1] || '').trim();
    if (/^={3,}$/.test(t)) continue;
    if (/^\[\[.*\]\]$/.test(t)) add('note', t.slice(2, -2).trim());
    else if (t.startsWith('.') && !t.startsWith('..')) add('scene', t.slice(1).trim());
    else if (blank && HEADING.test(t)) add('scene', t);
    else if (t.startsWith('>') && !t.endsWith('<')) add('transition', t.slice(1).trim());
    else if (/^титр\s*:/i.test(t)) add('title', t.replace(/^титр\s*:\s*/i, ''));
    else if (talk) {
      if (/^\(.*\)$/.test(t)) add('paren', t.slice(1, -1));
      else if (blocks[blocks.length - 1].type === 'dialogue') blocks[blocks.length - 1].text += ' ' + t;
      else add('dialogue', t);
    }
    else if (blank && upper(t) && /(TO:|IN:|OUT\.|BLACK\.|ЗТМ\.?|ЗАТЕМНЕНИЕ\.?)$/.test(t) && !next) add('transition', t);
    else if (blank && t.startsWith('@') && next) { add('character', t.slice(1).trim()); talk = true; }
    else if (blank && upper(t) && next && t.length < 45 && !/[.!?»]$/.test(t)) { add('character', t.replace(/\^$/, '').trim()); talk = true; }
    else add('action', t.startsWith('!') ? t.slice(1) : t);
    blank = false;
  }
  return { blocks, title };
}

export function parseFDX(src) {
  const map = { 'Scene Heading': 'scene', Action: 'action', Character: 'character', Dialogue: 'dialogue', Parenthetical: 'paren', Transition: 'transition', General: 'action', Shot: 'action' };
  const doc = new DOMParser().parseFromString(src, 'application/xml');
  const blocks = [];
  for (const par of doc.querySelectorAll('FinalDraft > Content > Paragraph')) {
    const type = map[par.getAttribute('Type')] || 'action';
    let text = [...par.querySelectorAll('Text')].map(t => t.textContent).join('').trim();
    if (!text) continue;
    if (type === 'paren') text = text.replace(/^\(|\)$/g, '');
    blocks.push(type === 'scene' ? { type, text, id: 'sc-' + uid() } : { type, text });
  }
  return { blocks, title: '' };
}

export function toFountain(p) {
  const out = [`Title: ${p.name}`, ''];
  for (const b of p.script.blocks) {
    const t = b.text.trim();
    if (!t) continue;
    if (b.type === 'scene') out.push('', '.' + t.toUpperCase(), '');
    else if (b.type === 'character') out.push('', '@' + t.toUpperCase());
    else if (b.type === 'dialogue') out.push(t);
    else if (b.type === 'paren') out.push(`(${t})`);
    else if (b.type === 'transition') out.push('', '> ' + t.toUpperCase(), '');
    else if (b.type === 'title') out.push('', 'ТИТР: ' + t, '');
    else if (b.type === 'note') out.push('', `[[${t}]]`, '');
    else out.push('', t);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

export function printScript(p) {
  const blocks = p.script.blocks.filter(b => b.type !== 'note' && b.text.trim());
  if (!blocks.length) return toast('В сценарии пока нет текста');
  printHTML(`<div class="sheet-title"><b>${esc(p.name)}</b></div><div class="sheet">${blocks.map(blockHTML).join('')}</div>`,
    'size: A4; margin: 2.5cm 2.5cm 1.25cm 3.75cm;', safeName(p.name) + ', сценарий');
}
