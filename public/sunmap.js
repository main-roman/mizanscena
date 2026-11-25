// Карта места съёмки с солнцем: квадрат OpenStreetMap, дуга солнца от начала смены до стоп-мотора
// и ползунок времени — луч показывает, откуда светит солнце, пунктир — куда падает тень.
import { esc } from './store.js';
import { sunAt, sideOf } from './sun.js';

const Z = 17, S = 280, R = 96; // масштаб карты, сторона квадрата и радиус дуги солнца, px
const toMin = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const hm = v => `${String(Math.floor(v / 60) % 24).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
const dir = (az, r) => [Math.sin(az * Math.PI / 180) * r, -Math.cos(az * Math.PI / 180) * r];
const n = v => Math.round(v * 10) / 10;

function tiles(c) {
  const k = 2 ** Z, xt = (c.lng + 180) / 360 * k, la = c.lat * Math.PI / 180;
  const yt = (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * k;
  const out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const tx = Math.floor(xt) + dx, ty = Math.floor(yt) + dy;
    out.push(`<img src="https://tile.openstreetmap.org/${Z}/${tx}/${ty}.png" style="left:${n(S / 2 + tx * 256 - xt * 256)}px;top:${n(S / 2 + ty * 256 - yt * 256)}px" alt="" draggable="false">`);
  }
  return out.join('');
}

export function sunMapHTML({ date, c, from, to, at }) {
  let a = toMin(from), b = toMin(to);
  if (a == null || b == null) return '';
  if (b <= a) b += 24 * 60; // ночная смена через полночь
  const now = Math.min(b, Math.max(a, toMin(at) ?? a));
  // дуга: точки каждые 10 минут, пока солнце над горизонтом; подписи по часам
  const pts = [], marks = [];
  for (let t = a; t <= b; t += 10) {
    const s = sunAt(date, hm(t), c);
    if (!s || s.alt <= 0) continue;
    const [x, y] = dir(s.az, R);
    pts.push(`${n(x)},${n(y)}`);
    if (t % 60 === 0) { const [lx, ly] = dir(s.az, R + 15); marks.push(`<circle cx="${n(x)}" cy="${n(y)}" r="2.4"/><text x="${n(lx)}" y="${n(ly + 3.5)}">${Math.floor(t / 60) % 24}</text>`); }
  }
  return `<div class="sunmap" data-sunmap="${esc(JSON.stringify({ date, c, a, b }))}">
    <div class="sunmap-map">
      <div class="sunmap-tiles">${tiles(c)}</div>
      <svg class="sunmap-svg" viewBox="${-S / 2} ${-S / 2} ${S} ${S}" aria-hidden="true">
        <circle class="sm-ring" r="${R}"/>
        <text class="sm-n" x="0" y="${-R - 8}">С</text>
        ${pts.length > 1 ? `<polyline class="sm-arc" points="${pts.join(' ')}"/>` : ''}
        <g class="sm-marks">${marks.join('')}</g>
        <line class="sm-shadow" x1="0" y1="0" x2="0" y2="0"/>
        <line class="sm-ray" x1="0" y1="0" x2="0" y2="0"/>
        <circle class="sm-sun" r="9" cx="0" cy="0"/>
        <circle class="sm-here" r="5"/>
      </svg>
      <span class="sunmap-copy">© OpenStreetMap</span>
    </div>
    <input type="range" min="${a}" max="${b}" step="5" value="${now}" aria-label="Время съёмки">
    <div class="sunmap-info"><b class="sm-time"></b><span class="sm-what"></span></div>
  </div>`;
}

function draw(el, t) {
  const d = JSON.parse(el.dataset.sunmap), s = sunAt(d.date, hm(t), d.c);
  const q = sel => el.querySelector(sel);
  q('.sm-time').textContent = hm(t);
  const up = !!s && s.alt > 0;
  el.classList.toggle('night', !up);
  if (!up) { q('.sm-what').textContent = 'солнце за горизонтом'; return; }
  const [x, y] = dir(s.az, R), [sx, sy] = dir(s.az + 180, Math.max(12, Math.min(R, 26 / Math.tan(s.alt * Math.PI / 180))));
  q('.sm-ray').setAttribute('x2', n(x)); q('.sm-ray').setAttribute('y2', n(y));
  q('.sm-shadow').setAttribute('x2', n(sx)); q('.sm-shadow').setAttribute('y2', n(sy));
  q('.sm-sun').setAttribute('cx', n(x)); q('.sm-sun').setAttribute('cy', n(y));
  q('.sm-what').textContent = `${sideOf(s.az)}, ${s.alt}°${s.alt < 6 ? ' · режим' : ''}`;
}

export function bindSunMaps(root) {
  for (const el of root.querySelectorAll('[data-sunmap]')) {
    const r = el.querySelector('input[type=range]');
    draw(el, +r.value);
    // перерисовка не чаще кадра — ползунок не дёргается
    let raf = 0;
    r.addEventListener('input', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => draw(el, +r.value)); });
    // pointerDrag карточек не должен перехватывать ползунок
    r.addEventListener('pointerdown', e => e.stopPropagation());
  }
}
