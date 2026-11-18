// Импорт сценария из Word (.docx), PDF и текстовых форматов (Fountain, Final Draft, .txt).
// Из каждой строки получается блок сценария: время и место, действие, персонаж, ремарка, реплика.
import { uid } from './store.js';

const HEADING = /^(\d+[.)]?\s*)?(ИНТ|НАТ|ЭКСТ|ИНТ\/НАТ|НАТ\/ИНТ|INT|EXT|I\/E|ЗТМ|ЗАТЕМНЕНИЕ)[.\s/]/i;
const clean = t => t.replace(/[​‌‍﻿]/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
// имя персонажа: прописными, коротко, без точки в конце и без запятых (строка «БАТЫР, ОТЕЦ» под заголовком сцены — это список персонажей)
const isName = t => t.length <= 40 && t === t.toUpperCase() && /[A-ZА-ЯЁ]/.test(t) && !/[,.!?:;»]$/.test(t) && !t.includes(',') && t.split(' ').length <= 5;
const isTransition = t => t === t.toUpperCase() && /(ЗТМ|ЗАТЕМНЕНИЕ|CUT TO:|FADE OUT|FADE IN:|ПЛАВНЫЙ ПЕРЕХОД|СМЕНА РАКУРСА)\.?$/.test(t);

// lines: [{ text, indent (0…1, доля ширины страницы), gap (была ли пустая строка перед) }]
export function classify(lines) {
  const blocks = [];
  let started = false, talk = false, title = '';
  const push = (type, text, join) => {
    const last = blocks[blocks.length - 1];
    if (join && last && last.type === type) { last.text += ' ' + text; return; }
    blocks.push(type === 'scene' ? { type, text, id: 'sc-' + uid() } : { type, text });
  };
  for (let i = 0; i < lines.length; i++) {
    const { text: raw, indent = 0, gap = false } = lines[i];
    const t = clean(raw);
    if (!t || /^\d{1,3}\.?$/.test(t)) continue; // номера страниц
    if (HEADING.test(t)) {
      started = true; talk = false;
      push('scene', t.replace(/^\d+[.)]?\s*/, '').toUpperCase());
      continue;
    }
    if (!started) { if (!title) title = t; continue; } // титульный лист
    const prev = blocks[blocks.length - 1];
    if (prev && prev.type === 'scene' && t === t.toUpperCase() && t.includes(',') && !gap) { push('note', 'Персонажи: ' + t); continue; }
    if (prev && prev.type === 'note' && prev.text.startsWith('Персонажи:') && t === t.toUpperCase() && !gap && blocks.length && lines[i - 1] && !lines[i - 1].gap) { prev.text += ' ' + t; continue; }
    if (isTransition(t) && indent > 0.25) { push('transition', t); talk = false; continue; }
    if (isName(t) && (indent > 0.12 || !lines[i + 1] || lines[i + 1].indent > 0.12 || !isName(clean(lines[i + 1].text || '')))) {
      const next = lines.slice(i + 1).find(l => clean(l.text));
      if (next && !HEADING.test(clean(next.text)) && (next.indent > 0.12 || indent > 0.25)) {
        push('character', t); talk = true; continue;
      }
    }
    if (talk && /^\(/.test(t)) {
      // ремарка может занимать несколько строк: собираем до закрывающей скобки
      let text = t;
      while (!text.includes(')') && i + 1 < lines.length && !lines[i + 1].gap) text += ' ' + clean(lines[++i].text);
      push('paren', text.replace(/^\(|\)$/g, '').trim());
      continue;
    }
    if (talk) {
      // реплика продолжается, пока строки идут с отступом; строка у левого края после пустой строки — уже действие
      if (gap && prev && prev.type === 'dialogue' && indent < 0.1) { talk = false; }
      else { push('dialogue', t, prev && prev.type === 'dialogue' && !gap); continue; }
    }
    push('action', t, prev && prev.type === 'action' && !gap);
  }
  return { blocks, title };
}

// ---------- PDF (pdf.js): строки с их отступом ----------
async function pdfLines(buf) {
  const pdfjs = await import('./vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || 12;
      let row = rows.find(r => Math.abs(r.y - y) < h * 0.4);
      if (!row) rows.push(row = { y, h, items: [] });
      row.items.push({ x, str: it.str, w: it.width });
    }
    rows.sort((a, b) => b.y - a.y);
    // левый край текста этой страницы: самый частый отступ
    const xs = rows.map(r => Math.round(Math.min(...r.items.map(i => i.x)) / 4) * 4);
    const counts = {};
    xs.forEach(x => { counts[x] = (counts[x] || 0) + 1; });
    const base = +Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] || 0;
    const left = Math.min(base, ...xs);
    let prevY = null;
    for (const r of rows) {
      r.items.sort((a, b) => a.x - b.x);
      // кусочки текста склеиваем с пробелом, только если между ними на странице есть промежуток
      let text = '', end = null;
      for (const it of r.items) {
        const space = end !== null && it.x - end > r.h * 0.18 && !text.endsWith(' ') && !it.str.startsWith(' ');
        text += (space ? ' ' : '') + it.str;
        end = it.x + (it.w || 0);
      }
      const x = r.items[0].x;
      const gap = prevY !== null && prevY - r.y > r.h * 1.9;
      out.push({ text, indent: (x - left) / vp.width, gap: n > 1 && prevY === null ? false : gap });
      prevY = r.y;
    }
  }
  return out;
}

// ---------- Word (.docx): разбираем архив и document.xml ----------
async function unzip(buf) {
  const v = new DataView(buf), files = {};
  let e = buf.byteLength - 22;
  while (e > 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  let p = v.getUint32(e + 16, true);
  const n = v.getUint16(e + 10, true);
  for (let i = 0; i < n; i++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
    const dataStart = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const raw = new Uint8Array(buf, dataStart, size);
    files[name] = async () => method === 0 ? raw : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    p += 46 + nameLen + extra + comment;
  }
  return files;
}
async function docxLines(buf) {
  const files = await unzip(buf);
  if (!files['word/document.xml']) throw new Error('not docx');
  const xml = new TextDecoder().decode(await files['word/document.xml']());
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const out = [];
  let gap = false;
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    let text = '';
    for (const n of p.getElementsByTagNameNS(W, '*')) {
      if (n.localName === 't') text += n.textContent;
      else if (n.localName === 'tab') text += ' ';
      else if (n.localName === 'br') text += '\n';
    }
    if (!text.trim()) { gap = true; continue; }
    const ind = p.getElementsByTagNameNS(W, 'ind')[0], jc = p.getElementsByTagNameNS(W, 'jc')[0];
    const leftTw = ind ? +(ind.getAttributeNS(W, 'left') || ind.getAttributeNS(W, 'start') || 0) : 0;
    const center = jc && /center/.test(jc.getAttributeNS(W, 'val'));
    const indent = center ? 0.3 : leftTw / 11906; // ширина листа A4 в twips
    text.split('\n').forEach((t, i) => out.push({ text: t, indent, gap: i === 0 && gap }));
    gap = false;
  }
  return out;
}

// Возвращает { blocks, title } по выбранному файлу.
export async function importScriptFile(file, { parseFountain, parseFDX }) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return classify(await pdfLines(await file.arrayBuffer()));
  if (name.endsWith('.docx')) return classify(await docxLines(await file.arrayBuffer()));
  const src = await file.text();
  if (name.endsWith('.fdx')) return parseFDX(src);
  return parseFountain(src);
}
