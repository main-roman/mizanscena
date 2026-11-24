// Выборка: текст сцен съёмочного дня из сценария подряд — для группы целиком, актёру только его сцены
// (его реплики выделены). Смотрится в боковом окошке, скачивается в PDF или Word.
import { esc, download, safeName, printHTML } from './store.js';
import { sceneInfo, sceneItems, cleanName } from './breakdown.js';
import { castList, shiftNo } from './schedmodel.js';

const title = s => s ? s.charAt(0) + s.slice(1).toLowerCase() : '';
const longDate = d => { if (!d) return 'дата не назначена'; const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };

// Сцены выборки и кто её получает.
// Настройки (общие для проекта): каждая сцена с новой страницы, соседние сцены по сюжету для справки,
// персонажи и массовка под шапкой сцены, колонтитул с названием и датой на каждой странице.
export const SIDES_OPTS = [['pageBreak', 'Каждая сцена с новой страницы'], ['neighbours', 'Соседние сцены по сюжету'], ['castHead', 'Персонажи под шапкой'], ['header', 'Колонтитул']];
const optsOf = p => p.schedule.info.sides || {};

export function sidesData(p, day, char = '') {
  const info = sceneInfo(p), n = shiftNo(p, day) || p.schedule.days.indexOf(day) + 1, o = optsOf(p);
  const scenes = day.items.filter(x => x.type === 'scene').map(x => info.find(s => s.id === x.sceneId)).filter(s => s && (!char || s.chars.includes(char)));
  const who = char ? castList(p, info).find(c => c.char === char) : null;
  // соседние сцены по сценарию — до и после каждой, если их нет в выборке
  let list = scenes.map(s => ({ s, ref: false }));
  if (o.neighbours) {
    const have = new Set(scenes.map(s => s.id)), out = [];
    const ref = nb => { if (nb && !have.has(nb.id)) { have.add(nb.id); out.push({ s: nb, ref: true }); } };
    for (const s of scenes) { const i = info.indexOf(s); ref(info[i - 1]); out.push({ s, ref: false }); ref(info[i + 1]); }
    list = out;
  }
  for (const x of list) {
    const ex = sceneItems(p, x.s.id, info).extras;
    x.cast = [x.s.chars.length ? 'Персонажи: ' + x.s.chars.map(title).join(', ') : '', ex.length ? 'Массовка: ' + ex.join(', ') : ''].filter(Boolean).join('. ');
  }
  return { n, scenes, list, who, o, forWhom: who ? `${title(who.char)}${who.actor ? ` — ${who.actor}` : ''}` : 'для группы' };
}
const runHead = (p, day, n) => `${p.name} · выборка · смена ${n} · ${longDate(day.date)}`;

// Блоки сцены с пометкой, чьи реплики выделять.
function marked(s, char) {
  let speaker = '';
  return s.blocks.filter(b => b.type !== 'note' && b.text.trim()).map(b => {
    if (b.type === 'character') speaker = cleanName(b.text);
    else if (b.type !== 'dialogue' && b.type !== 'paren') speaker = '';
    return { ...b, mine: !!char && ['character', 'dialogue', 'paren'].includes(b.type) && speaker.startsWith(char) };
  });
}

export function sidesHTML(p, day, char = '', print = false) {
  const { n, scenes, list, o, forWhom } = sidesData(p, day, char);
  const one = (x, i) => `<section class="sd-scene${x.ref ? ' sd-ref' : ''}${o.pageBreak && i ? ' sd-break' : ''}">${x.ref ? '<p class="sd-reftag">Для справки — соседняя сцена по сюжету</p>' : ''}<div data-type="scene">${x.s.n}. ${esc(x.s.text)}</div>`
    + (o.castHead && x.cast ? `<p class="sd-cast">${esc(x.cast)}</p>` : '')
    + marked(x.s, x.ref ? '' : char).map(b => `<div data-type="${b.type}"${b.mine ? ' class="mine"' : ''}>${esc(b.text)}</div>`).join('') + '</section>';
  return (print && o.header ? `<div class="sd-runhead">${esc(runHead(p, day, n))}</div>` : '')
    + `<div class="sides-title"><b>${esc(p.name)}</b><span>Выборка · смена ${n} · ${esc(longDate(day.date))}</span>
      <span>${esc(forWhom)} · сцены ${scenes.map(s => s.n).join(', ')}</span></div>
    <div class="sheet sides${o.pageBreak && !print ? ' sd-pages' : ''}">${list.map(one).join('')}</div>`;
}

const fileName = (p, day, char) => safeName(`${p.name}, выборка, смена ${shiftNo(p, day) || p.schedule.days.indexOf(day) + 1}${char ? ', ' + title(char) : ''}`);

// колонтитул в PDF: position: fixed печатается на каждой странице
const PRINT_CSS = `<style>.sd-break { break-before: page; } .sd-runhead { position: fixed; top: -1.3cm; left: 0; right: 0; font: 9pt 'Courier New', monospace; color: #666; border-bottom: 0.5pt solid #999; padding-bottom: 2pt; }
  .sd-ref { color: #666; } .sd-reftag { font: italic 9pt sans-serif; color: #888; margin: 14pt 0 0; } .sd-cast { font: 10pt 'Courier New', monospace; color: #444; margin: 4pt 0 0; }</style>`;
export function sidesPDF(p, day, char = '') {
  printHTML(PRINT_CSS + sidesHTML(p, day, char, true), 'size: A4; margin: 2cm 2cm 1.5cm 3cm;', fileName(p, day, char));
}

// Word открывает такой документ как обычный: разметка сценария через отступы абзацев, Courier New 12.
export function sidesWord(p, day, char = '') {
  const { n, scenes, list, o, forWhom } = sidesData(p, day, char);
  const ST = {
    scene: 'margin:18pt 0 0; font-weight:bold; text-transform:uppercase;',
    action: 'margin:12pt 0 0;',
    character: 'margin:12pt 0 0 6.7cm; text-transform:uppercase;',
    dialogue: 'margin:0 3.75cm 0 3.75cm;',
    paren: 'margin:0 4.5cm 0 5.45cm;',
    transition: 'margin:12pt 0 0; text-align:right; text-transform:uppercase;',
    title: 'margin:12pt 0 0;',
  };
  const para = (b, text) => `<p style="${ST[b.type] || ST.action}${b.mine ? ' background:#FFF1B8;' : ''}">${text}</p>`;
  const body = list.map((x, i) => (o.pageBreak && i ? '<br clear="all" style="page-break-before:always">' : '')
    + (x.ref ? '<p style="margin:12pt 0 0; font-family:Arial; font-style:italic; font-size:9pt; color:#888;">Для справки — соседняя сцена по сюжету</p>' : '')
    + para({ type: 'scene' }, `${x.s.n}. ${esc(x.s.text)}`)
    + (o.castHead && x.cast ? `<p style="margin:4pt 0 0; font-size:10pt; color:#444;">${esc(x.cast)}</p>` : '')
    + marked(x.s, x.ref ? '' : char).map(b => para(b, b.type === 'paren' ? `(${esc(b.text)})` : b.type === 'title' ? `ТИТР: ${esc(b.text)}` : esc(b.text))).join('')).join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(p.name)}</title>
<style>@page Section1 { size: 21cm 29.7cm; margin: 2.5cm 2.5cm 1.25cm 3.75cm;${o.header ? ' mso-header: h1; mso-header-margin: 1.2cm;' : ''} } div.Section1 { page: Section1; } p.MsoHeader { font-size: 9pt; color: #666; } body { font-family: 'Courier New', Courier, monospace; font-size: 12pt; line-height: 1.15; } p { margin: 0; }</style></head>
<body><div class="Section1">${o.header ? `<div style="mso-element:header" id="h1"><p class="MsoHeader">${esc(runHead(p, day, n))}</p></div>` : ''}<p style="font-weight:bold;">${esc(p.name)}</p><p>Выборка · смена ${n} · ${esc(longDate(day.date))}</p><p>${esc(forWhom)} · сцены ${scenes.map(s => s.n).join(', ')}</p>${body}</div></body></html>`;
  download(new Blob(['﻿', html], { type: 'application/msword' }), fileName(p, day, char) + '.doc');
}
