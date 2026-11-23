// Выгрузка плана Shot Designer картинкой (JPG, PNG) или PDF — без окна печати.
import { bounds, planSVG, gridPattern, PAPER, esc } from './shapes.js';
import { srcOf } from './storage.js';
import { download, safeName, toast } from './store.js';

// План на холсте; withTitle — с названием и заметкой сверху (для PDF).
async function planCanvas(plan, withTitle = false) {
  const b = bounds(plan), pad = 1, w0 = b.w + pad * 2, h0 = b.h + pad * 2;
  const ppm = Math.min(220, 4200 / Math.max(w0, h0));
  const w = Math.round(w0 * ppm), h = Math.round(h0 * ppm);
  let markup = planSVG(plan, { pad, attrs: `width="${w}" height="${h}"` })
    .replace('</svg>', `<defs>${gridPattern('', 'g2')}</defs><rect x="${b.x - pad}" y="${b.y - pad}" width="${w0}" height="${h0}" fill="url(#g2)" pointer-events="none"/></svg>`);
  // картинки-подложки встраиваем внутрь, иначе браузер не нарисует их на холсте
  for (const o of plan.objects.filter(q => q.type === 'image' && q.src && !q.src.startsWith('data:'))) {
    try {
      const blob = await (await fetch(srcOf(o.src))).blob();
      const data = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      markup = markup.split(`href="${esc(srcOf(o.src))}"`).join(`href="${data}"`);
    } catch { /* подложка просто не попадёт в картинку */ }
  }
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  });
  const head = withTitle ? Math.round(Math.max(w, h) * 0.05) + (plan.note ? Math.round(Math.max(w, h) * 0.03) : 0) : 0;
  const c = document.createElement('canvas');
  c.width = w; c.height = h + head;
  const g = c.getContext('2d');
  g.fillStyle = withTitle ? '#FFFFFF' : PAPER; g.fillRect(0, 0, c.width, c.height);
  if (withTitle) {
    const fs = Math.round(Math.max(w, h) * 0.026);
    g.fillStyle = '#1C2A30';
    g.font = `600 ${fs}px "Segoe UI", system-ui, sans-serif`;
    g.fillText(plan.name, fs * 0.8, fs * 1.4);
    if (plan.note) { g.font = `${Math.round(fs * 0.6)}px "Segoe UI", system-ui, sans-serif`; g.fillStyle = '#5E6C70'; g.fillText(plan.note.split('\n')[0].slice(0, 160), fs * 0.8, fs * 2.5); }
    g.fillStyle = PAPER; g.fillRect(0, head, w, h);
  }
  g.drawImage(img, 0, head, w, h);
  return c;
}

const blobOf = (c, type, q) => new Promise(res => c.toBlob(res, type, q));

// Одна страница PDF с картинкой JPEG: A4, книжный или альбомный по форме плана, картинка вписана с полями.
function pdfFromJpeg(bytes, iw, ih) {
  const land = iw >= ih, W = land ? 842 : 595, H = land ? 595 : 842, m = 24, k = Math.min((W - 2 * m) / iw, (H - 2 * m) / ih);
  const dw = +(iw * k).toFixed(2), dh = +(ih * k).toFixed(2), x = +((W - dw) / 2).toFixed(2), y = +((H - dh) / 2).toFixed(2);
  const enc = new TextEncoder(), parts = [], offs = [];
  let len = 0;
  const put = d => { const u = typeof d === 'string' ? enc.encode(d) : d; parts.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; put(`${n} 0 obj\n`); for (const b of [].concat(body)) put(b); put('\nendobj\n'); };
  const content = `q ${dw} 0 0 ${dh} ${x} ${y} cm /Im0 Do Q`;
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`, bytes, '\nendstream']);
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  put(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map(n => String(offs[n]).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

// fmt: 'jpg' | 'png' | 'pdf'
export async function exportPlan(plan, fmt) {
  try {
    const c = await planCanvas(plan, fmt === 'pdf');
    const name = safeName(plan.name);
    if (fmt === 'png') download(await blobOf(c, 'image/png'), name + '.png');
    else if (fmt === 'jpg') download(await blobOf(c, 'image/jpeg', 0.92), name + '.jpg');
    else {
      const jpeg = new Uint8Array(await (await blobOf(c, 'image/jpeg', 0.92)).arrayBuffer());
      download(pdfFromJpeg(jpeg, c.width, c.height), name + '.pdf');
    }
    toast(`План сохранён в загрузки: ${name}.${fmt}`);
  } catch (e) { console.error(e); toast('Не получилось собрать картинку плана'); }
}
