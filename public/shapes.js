// Условные знаки плана. Все размеры в метрах, знак смотрит вправо (rot = 0), поворот по часовой стрелке.
// Оформление задаётся атрибутами, а не CSS, чтобы план одинаково выглядел в PNG и при печати.
import { srcOf } from './storage.js';

export const INK = '#1C2A30';
export const PAPER = '#E8ECEA';
export const CAM = '#1E58B8';
export const LIGHT = '#E9A21B';
export const DAY = '#8FBDEB';
export const COLORS = ['#D8492F', '#2F8F6B', '#7B55C7', '#1D7FA6', '#B7791F', '#44505A'];
const FONT = "'Segoe UI', system-ui, -apple-system, Roboto, sans-serif";
const S = 0.03; // толщина линии, м
const WHITE = '#FBFCFA';

export const SENSORS = {
  s35: { name: 'Super 35', w: 24.9 },
  ff: { name: 'Полный кадр', w: 36 },
  mft: { name: 'Micro 4/3', w: 17.3 },
  s16: { name: 'Super 16', w: 12.5 },
};

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n = v => +(+v).toFixed(3);

// ---------- кирпичики для рисования ----------
const st = `stroke="${INK}" stroke-width="${S}" stroke-linejoin="round" stroke-linecap="round"`;
const box = (w, h, rx = 0, fill = WHITE) => `<rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" rx="${n(rx)}" fill="${fill}" ${st}/>`;
const rect = (x, y, w, h, rx = 0, fill = 'none') => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(rx)}" fill="${fill}" ${st}/>`;
const ell = (w, h, fill = WHITE) => `<ellipse rx="${n(w / 2)}" ry="${n(h / 2)}" fill="${fill}" ${st}/>`;
const dot = (x, y, r, fill = INK) => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}"/>`;
const ring = (x, y, r, fill = 'none') => `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" ${st}/>`;
// своя толщина линии заменяет обычную: два stroke-width в одном теге ломают выгрузку плана картинкой
const ln = (d, extra = '') => `<path d="${d}" fill="none" ${/stroke-width=/.test(extra) ? st.replace(/stroke-width="[^"]*"\s*/, '') : st} ${extra}/>`;

// ---------- декорация ----------
// cat: furn мебель, room интерьер, ext натура, gear съёмочная техника, people люди
export const FURN = {
  table: { name: 'Стол', cat: 'furn', w: 1.4, h: 0.8, draw: (w, h) => box(w, h) },
  round: { name: 'Круглый стол', cat: 'furn', w: 1, h: 1, draw: (w, h) => ell(w, h) },
  chair: { name: 'Стул', cat: 'furn', w: 0.45, h: 0.45, draw: (w, h) => box(w, h, 0.06) + rect(-w / 2, -h / 2, w * 0.2, h, 0.03, INK) },
  armchair: { name: 'Кресло', cat: 'furn', w: 0.9, h: 0.85, draw: (w, h) => box(w, h, 0.1) + ln(`M${n(-w / 2 + w * 0.25)} ${n(-h / 2)} V${n(h / 2)} M${n(-w / 2 + w * 0.25)} ${n(-h / 2 + h * 0.2)} H${n(w / 2)} M${n(-w / 2 + w * 0.25)} ${n(h / 2 - h * 0.2)} H${n(w / 2)}`) },
  sofa: { name: 'Диван', cat: 'furn', w: 2, h: 0.9, draw: (w, h) => { const b = Math.min(0.22, h * 0.3), x = -w / 2, y = -h / 2; return box(w, h, 0.08) + ln(`M${x} ${n(y + b)} H${-x} M${n(x + b)} ${n(y + b)} V${-y} M${n(-x - b)} ${n(y + b)} V${-y}`); } },
  bed: { name: 'Кровать', cat: 'furn', w: 2, h: 1.6, draw: (w, h) => box(w, h, 0.05) + rect(-w / 2 + 0.08, -h / 2 + 0.1, Math.min(0.45, w * 0.25), h - 0.2, 0.08) + ln(`M${n(-w / 2 + Math.min(0.65, w * 0.35))} ${-h / 2} V${h / 2}`) },
  cabinet: { name: 'Шкаф', cat: 'furn', w: 1.2, h: 0.6, draw: (w, h) => box(w, h) + ln(`M${-w / 2} ${-h / 2} L${w / 2} ${h / 2} M${w / 2} ${-h / 2} L${-w / 2} ${h / 2}`, 'stroke-width="0.02"') },
  shelf: { name: 'Стеллаж', cat: 'furn', w: 1.6, h: 0.35, draw: (w, h) => box(w, h) + ln(`M${n(-w / 6)} ${-h / 2} V${h / 2} M${n(w / 6)} ${-h / 2} V${h / 2}`) },
  bar: { name: 'Стойка', cat: 'furn', w: 2.4, h: 0.6, draw: (w, h) => box(w, h, Math.min(w, h) / 2) },
  piano: { name: 'Пианино', cat: 'furn', w: 1.5, h: 0.6, draw: (w, h) => box(w, h, 0.03, '#39464C') + rect(-w / 2 + 0.06, h / 2 - h * 0.32, w - 0.12, h * 0.24, 0, WHITE) },
  tv: { name: 'Телевизор', cat: 'furn', w: 1.2, h: 0.12, draw: (w, h) => box(w, h, 0.02, '#39464C') + ln(`M0 ${n(-h / 2)} V${n(-h / 2 - 0.12)}`) },
  rug: { name: 'Ковёр', cat: 'furn', w: 2, h: 1.4, draw: (w, h) => box(w, h, 0, '#E6DCC8') + `<rect x="${n(-w / 2 + 0.1)}" y="${n(-h / 2 + 0.1)}" width="${n(w - 0.2)}" height="${n(h - 0.2)}" fill="none" stroke="${INK}" stroke-width="0.015" stroke-dasharray="0.08 0.06"/>` },

  stove: { name: 'Плита', cat: 'room', w: 0.6, h: 0.6, draw: (w, h) => box(w, h, 0.03) + [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => ring(a * w * 0.22, b * h * 0.22, Math.min(w, h) * 0.13)).join('') },
  sink: { name: 'Раковина', cat: 'room', w: 0.6, h: 0.5, draw: (w, h) => box(w, h, 0.03) + rect(-w / 2 + 0.07, -h / 2 + 0.07, w - 0.14, h - 0.14, 0.08) + dot(0, 0, 0.03) },
  fridge: { name: 'Холодильник', cat: 'room', w: 0.6, h: 0.65, draw: (w, h) => box(w, h, 0.03) + ln(`M${n(w / 2 - 0.08)} ${-h / 2} V${h / 2}`) },
  bath: { name: 'Ванна', cat: 'room', w: 1.7, h: 0.75, draw: (w, h) => box(w, h, 0.06) + rect(-w / 2 + 0.08, -h / 2 + 0.08, w - 0.16, h - 0.16, h * 0.3) + dot(-w / 2 + 0.28, 0, 0.035) },
  toilet: { name: 'Унитаз', cat: 'room', w: 0.7, h: 0.4, draw: (w, h) => rect(-w / 2, -h / 2, w * 0.28, h, 0.03, WHITE) + `<ellipse cx="${n(w * 0.14)}" rx="${n(w * 0.36)}" ry="${n(h * 0.42)}" fill="${WHITE}" ${st}/>` },
  stairs: { name: 'Лестница', cat: 'room', w: 2.6, h: 1, draw: (w, h) => { let d = ''; for (let x = -w / 2 + 0.28; x < w / 2 - 0.05; x += 0.28) d += `M${n(x)} ${-h / 2} V${h / 2} `; return box(w, h) + ln(d, 'stroke-width="0.02"') + ln(`M${n(-w / 2 + 0.15)} 0 H${n(w / 2 - 0.15)} M${n(w / 2 - 0.3)} -0.1 L${n(w / 2 - 0.15)} 0 L${n(w / 2 - 0.3)} 0.1`); } },
  column: { name: 'Колонна', cat: 'room', w: 0.4, h: 0.4, draw: (w, h) => box(w, h, 0, INK) },
  fireplace: { name: 'Камин', cat: 'room', w: 1.2, h: 0.5, draw: (w, h) => box(w, h, 0, '#CCD4D1') + rect(-w * 0.3, -h / 2 + h * 0.3, w * 0.6, h * 0.7, 0, '#39464C') },
  mirror: { name: 'Зеркало', cat: 'room', w: 0.8, h: 0.08, draw: (w, h) => box(w, h, 0, '#CFE6F2') },
  curtain: { name: 'Штора', cat: 'room', w: 1.6, h: 0.16, draw: (w, h) => { let d = `M${-w / 2} 0`; const k = Math.max(4, Math.round(w / 0.2)); for (let i = 1; i <= k; i++) d += ` Q${n(-w / 2 + (i - 0.5) * w / k)} ${i % 2 ? -h : h} ${n(-w / 2 + i * w / k)} 0`; return ln(d, 'stroke-width="0.04"'); } },
  plant: { name: 'Растение', cat: 'room', w: 0.6, h: 0.6, draw: (w, h) => ell(w, h, '#9CC59A') + ring(0, 0, Math.min(w, h) * 0.22, '#B07A52') },
  block: { name: 'Блок', cat: 'room', w: 1, h: 1, draw: (w, h) => box(w, h, 0, '#CCD4D1') },

  tree: { name: 'Дерево', cat: 'ext', w: 2, h: 2, draw: (w, h) => `<ellipse rx="${w / 2}" ry="${h / 2}" fill="#7FB58A" fill-opacity="0.45" stroke="#3E7A4C" stroke-width="${S}" stroke-dasharray="0.12 0.06"/>` + dot(0, 0, 0.1, '#5A4632') },
  bush: { name: 'Куст', cat: 'ext', w: 1, h: 0.8, draw: (w, h) => `<ellipse rx="${w / 2}" ry="${h / 2}" fill="#9CC59A" fill-opacity="0.6" stroke="#3E7A4C" stroke-width="${S}" stroke-dasharray="0.05 0.05"/>` },
  rock: { name: 'Камень', cat: 'ext', w: 0.9, h: 0.7, draw: (w, h) => `<polygon points="${[[-0.5, 0.1], [-0.3, -0.42], [0.15, -0.5], [0.5, -0.12], [0.38, 0.4], [-0.15, 0.5]].map(([a, b]) => `${n(a * w)},${n(b * h)}`).join(' ')}" fill="#C3CAC7" ${st}/>` },
  fire: { name: 'Костёр', cat: 'ext', w: 0.7, h: 0.7, draw: (w, h) => ell(w, h, '#F6D9A4') + `<path d="M0 ${n(-h * 0.3)} C${n(w * 0.3)} 0 ${n(w * 0.15)} ${n(h * 0.3)} 0 ${n(h * 0.3)} C${n(-w * 0.2)} ${n(h * 0.3)} ${n(-w * 0.25)} 0 0 ${n(-h * 0.3)}Z" fill="#E36A2C"/>` },
  bench: { name: 'Скамейка', cat: 'ext', w: 1.6, h: 0.45, draw: (w, h) => box(w, h, 0.03) + ln(`M${-w / 2} ${n(-h / 6)} H${w / 2} M${-w / 2} ${n(h / 6)} H${w / 2}`, 'stroke-width="0.02"') },
  lamp: { name: 'Фонарь', cat: 'ext', w: 0.35, h: 0.35, draw: (w) => ring(0, 0, w / 2, '#F6D9A4') + ln(`M${n(-w * 0.35)} ${n(-w * 0.35)} L${n(w * 0.35)} ${n(w * 0.35)} M${n(w * 0.35)} ${n(-w * 0.35)} L${n(-w * 0.35)} ${n(w * 0.35)}`) },
  fence: { name: 'Забор', cat: 'ext', w: 3, h: 0.12, draw: (w, h) => { let d = `M${-w / 2} 0 H${w / 2} `; for (let x = -w / 2; x <= w / 2 + 0.01; x += 0.5) d += `M${n(x)} ${-h} V${h} `; return ln(d, 'stroke-width="0.04"'); } },
  road: { name: 'Дорога', cat: 'ext', w: 8, h: 3, draw: (w, h) => `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="#C6CCCA"/>` + ln(`M${-w / 2} ${-h / 2} H${w / 2} M${-w / 2} ${h / 2} H${w / 2}`) + `<path d="M${-w / 2} 0 H${w / 2}" stroke="#fff" stroke-width="0.1" stroke-dasharray="0.8 0.6"/>` },
  water: { name: 'Вода', cat: 'ext', w: 4, h: 3, draw: (w, h) => `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="0.3" fill="#9CC7E3" fill-opacity="0.55" stroke="#4E88AA" stroke-width="${S}"/>` + `<path d="M${n(-w * 0.25)} 0 q0.15 -0.15 0.3 0 t0.3 0 t0.3 0" fill="none" stroke="#4E88AA" stroke-width="${S}"/>` },
  tent: { name: 'Палатка', cat: 'ext', w: 2.2, h: 1.8, draw: (w, h) => box(w, h, 0, '#D8E0D2') + ln(`M${-w / 2} ${-h / 2} L${w / 2} ${h / 2} M${w / 2} ${-h / 2} L${-w / 2} ${h / 2}`) },
  car: { name: 'Машина', cat: 'ext', w: 4.4, h: 1.8, draw: (w, h) => { const r = Math.min(0.4, h * 0.25), x = -w / 2, y = -h / 2; return box(w, h, r) + rect(x + w * 0.22, y + h * 0.1, w * 0.42, h * 0.8, r * 0.6, '#D6E4EC') + ln(`M${n(x + w * 0.64)} ${n(y + h * 0.1)} L${n(x + w * 0.74)} ${n(y + h * 0.04)} M${n(x + w * 0.64)} ${n(-y - h * 0.1)} L${n(x + w * 0.74)} ${n(-y - h * 0.04)}`); } },
  truck: { name: 'Грузовик', cat: 'ext', w: 7, h: 2.4, draw: (w, h) => box(w, h, 0.1) + rect(w / 2 - w * 0.22, -h / 2 + 0.12, w * 0.14, h - 0.24, 0.08, '#D6E4EC') + ln(`M${n(w / 2 - w * 0.26)} ${-h / 2} V${h / 2}`) },
  bike: { name: 'Мотоцикл', cat: 'ext', w: 2, h: 0.7, draw: (w, h) => ln(`M${n(-w * 0.4)} 0 H${n(w * 0.4)} M${n(w * 0.28)} ${n(-h / 2)} V${n(h / 2)}`, 'stroke-width="0.07"') + `<ellipse cx="${n(-w * 0.38)}" rx="${n(w * 0.12)}" ry="0.07" fill="${INK}"/><ellipse cx="${n(w * 0.38)}" rx="${n(w * 0.12)}" ry="0.07" fill="${INK}"/>` + `<ellipse cx="${n(-w * 0.05)}" rx="${n(w * 0.18)}" ry="${n(h * 0.25)}" fill="${WHITE}" ${st}/>` },

  track: { name: 'Рельсы', cat: 'gear', w: 4, h: 0.62, draw: (w, h) => { let d = ''; for (let x = -w / 2 + 0.25; x < w / 2; x += 0.5) d += `M${n(x)} ${-h / 2} V${h / 2} `; return ln(d, 'stroke-width="0.02" stroke-opacity="0.5"') + ln(`M${-w / 2} ${-h / 2} H${w / 2} M${-w / 2} ${h / 2} H${w / 2}`, 'stroke-width="0.06"'); } },
  dolly: { name: 'Тележка', cat: 'gear', w: 1.2, h: 0.8, draw: (w, h) => box(w, h, 0.06, '#D5DCD9') + [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => dot(a * (w / 2 - 0.1), b * (h / 2), 0.07)).join('') },
  crane: { name: 'Кран', cat: 'gear', w: 4, h: 0.9, draw: (w, h) => ln(`M${n(-w / 2 + 0.3)} 0 H${n(w / 2 - 0.2)}`, 'stroke-width="0.09"') + ring(-w * 0.2, 0, h / 2, '#D5DCD9') + rect(-w / 2, -0.18, 0.4, 0.36, 0.03, '#39464C') + rect(w / 2 - 0.3, -0.15, 0.3, 0.3, 0.04, CAM) },
  monitor: { name: 'Плейбэк', cat: 'gear', w: 0.8, h: 0.5, draw: (w, h) => box(w, h, 0.04, '#D5DCD9') + rect(w / 2 - 0.1, -h / 2 + 0.06, 0.06, h - 0.12, 0, '#39464C') },
  boom: { name: 'Звук, бум', cat: 'gear', w: 2.4, h: 0.4, draw: (w, h) => ln(`M${n(-w / 2 + h / 2)} 0 H${n(w / 2 - 0.2)}`, 'stroke-width="0.04"') + ring(-w / 2 + h / 2, 0, h / 2, '#D5DCD9') + rect(w / 2 - 0.3, -0.06, 0.3, 0.12, 0.06, '#39464C') },
  haze: { name: 'Дым-машина', cat: 'gear', w: 0.6, h: 0.4, draw: (w, h) => box(w, h, 0.04, '#39464C') + [0.2, 0.42, 0.66].map((x, i) => `<circle cx="${n(w / 2 + x)}" cy="${i % 2 ? 0.08 : -0.06}" r="${n(0.1 + i * 0.04)}" fill="#fff" fill-opacity="0.8" stroke="${INK}" stroke-width="0.015"/>`).join('') },
  genny: { name: 'Генератор', cat: 'gear', w: 1.2, h: 0.8, draw: (w, h) => box(w, h, 0.05, '#D5DCD9') + ln(`M0.08 ${n(-h * 0.3)} L-0.1 0.03 H0.08 L-0.06 ${n(h * 0.3)}`, 'stroke-width="0.04"') },
  crowd: { name: 'Массовка', cat: 'people', w: 2, h: 1.4, draw: (w, h) => { let s = `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="0.2" fill="#44505A" fill-opacity="0.08" stroke="${INK}" stroke-width="0.015" stroke-dasharray="0.08 0.06"/>`; const cols = Math.max(1, Math.floor(w / 0.55)), rows = Math.max(1, Math.floor(h / 0.55)); for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) s += ring(-w / 2 + (c + 0.5) * w / cols + (r % 2 ? 0.08 : -0.08), -h / 2 + (r + 0.5) * h / rows, 0.14, '#9AA5AA'); return s; } },
};

// Типажи персонажей для 3D.
export const LOOKS = {
  m1: { name: 'Мужчина, повседневная одежда', sex: 'm', hair: 'short', hairColor: '#2B2118', skin: '#E2B796' },
  m2: { name: 'Мужчина в худи', sex: 'm', hair: 'short', hairColor: '#4A3424', skin: '#D9A781', beard: true },
  m3: { name: 'Мужчина в костюме', sex: 'm', hair: 'thin', hairColor: '#B9B6B0', skin: '#E6C2A6', heavy: true },
  f1: { name: 'Девушка, повседневная одежда', sex: 'f', hair: 'long', hairColor: '#3A2418', skin: '#EBC4A8' },
  f2: { name: 'Девушка в брючном костюме', sex: 'f', hair: 'bob', hairColor: '#C9A368', skin: '#F0CDB4' },
  f3: { name: 'Женщина в рабочей форме и каске', sex: 'f', hair: 'bun', hairColor: '#1F1A17', skin: '#D8A888', dress: true },
  // сканы реальных людей (Renderpeople, CC BY); цвет одежды у них свой, из фотографии
  r1: { name: 'Эрик, костюм (скан)', sex: 'm', hair: 'short', hairColor: '#2B2118', skin: '#D9A781', file: 'rp_eric/scene.gltf', scan: true },
  r2: { name: 'Карла, деловой стиль (скан)', sex: 'f', hair: 'long', hairColor: '#2A1C14', skin: '#D8A888', file: 'rp_carla/scene.gltf', scan: true },
  r3: { name: 'Клаудия, деловой стиль (скан)', sex: 'f', hair: 'long', hairColor: '#3A2418', skin: '#EBC4A8', file: 'rp_claudia/scene.gltf', scan: true },
};
export const POSES = { stand: 'Стоит', sit: 'Сидит' };

// План с расстановкой персонажей и камер из указанной фазы (для миниатюр и печати).
// Камеру или персонажа можно убрать только в некоторых фазах: o.absent — список таких фаз.
export const absentIn = (o, phaseId) => !!phaseId && Array.isArray(o.absent) && o.absent.includes(phaseId);
export function atPhase(plan, phaseId) {
  const phs = plan.phases || [], ph = phs.find(p => p.id === phaseId) || (!phaseId && phs[plan.phase | 0]) || null;
  if (!ph) return plan;
  const gone = new Set(plan.objects.filter(o => absentIn(o, ph.id)).map(o => o.id));
  return { ...plan, objects: plan.objects.filter(o => !gone.has(o.id) && !(o.type === 'path' && gone.has(o.ownerId))).map(o => (ph.pos[o.id] && (o.type !== 'furniture' || o.phased) ? { ...o, ...ph.pos[o.id] } : o)) };
}

export const FURN_CATS = { furn: 'Мебель', room: 'Интерьер', ext: 'Натура', gear: 'Техника' };

// ---------- свет ----------
// shape: spot прибор с лучом, soft софтбокс, bar линейный, glow светит во все стороны, sun, cloth рама или флаг
export const LIGHTS = {
  fresnel: { name: 'Френель', shape: 'spot', r: 0.2, beam: 40, len: 3.2 },
  open: { name: 'Прожектор', shape: 'spot', r: 0.2, beam: 70, len: 2.8, open: true },
  dedo: { name: 'Дедолайт', shape: 'spot', r: 0.12, beam: 18, len: 3 },
  hmi: { name: 'ДИГ', shape: 'spot', r: 0.3, beam: 32, len: 5, color: DAY },
  soft: { name: 'Софтбокс', shape: 'soft', w: 0.9, beam: 95, len: 2.6 },
  panel: { name: 'Панель', shape: 'bar', w: 0.6, beam: 110, len: 2.4 },
  tube: { name: 'Трубка', shape: 'bar', w: 1.2, beam: 150, len: 1.5, thin: true },
  china: { name: 'Китайский шар', shape: 'glow', r: 0.25, glow: 1.8 },
  ring: { name: 'Кольцо', shape: 'ring', w: 0.5, beam: 80, len: 1.8 },
  practical: { name: 'Торшер', shape: 'glow', r: 0.17, glow: 1.2, lamp: true },
  desk: { name: 'Настольная лампа', shape: 'glow', r: 0.11, glow: 0.8, lamp: true },
  sun: { name: 'Солнце', shape: 'sun', w: 1.6 },
  frame: { name: 'Рама, диффузия', shape: 'cloth', w: 1.2, fill: '#fff', dash: true },
  bounce: { name: 'Отражатель', shape: 'cloth', w: 1.2, fill: '#fff' },
  flag: { name: 'Флаг', shape: 'cloth', w: 1, fill: '#111' },
};
export const emits = kind => (LIGHTS[kind] || {}).shape !== 'cloth';

// Горизонтальный угол зрения камеры в градусах.
export function fov(o) {
  const w = (SENSORS[o.sensor] || SENSORS.s35).w;
  return 2 * Math.atan(w / (2 * (o.lens || 35))) * 180 / Math.PI;
}

// Цвет света по цветовой температуре (приближение Таннера Хелланда), в шестнадцатеричном виде.
export function kelvinToHex(k) {
  const t = Math.min(40000, Math.max(1000, k)) / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
  const h = v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}
// Цветовая температура прибора по умолчанию: ДИГ и солнце дневные, остальное лампы накаливания.
export const defaultKelvin = kind => (kind === 'hmi' ? 5600 : kind === 'sun' ? 5600 : kind === 'panel' || kind === 'tube' ? 4300 : 3200);

// Высота над полом в 3D, если у объекта она не задана.
export function height3d(o) {
  if (o.type === 'camera') return 1.5;
  if (o.type === 'character') return 1.75;
  const k = LIGHTS[o.kind] || {};
  if (k.shape === 'glow') return o.kind === 'china' ? 2.3 : o.kind === 'desk' ? 0.75 : 0; // у ламп это высота опоры: пол или стол
  return k.shape === 'cloth' ? 1.6 : 2.2;
}

// Радиус знака: нужен для рамки выделения и ручки поворота.
export function extent(o) {
  switch (o.type) {
    case 'character': return 0.34;
    case 'camera': return 0.44;
    case 'light': return Math.max(0.3, (o.w || 0) / 2);
    case 'door': case 'window': return o.w / 2;
    case 'text': return 0.3;
    default: return Math.hypot(o.w || 1, o.h || 1) / 2;
  }
}

// Текст рисуем в масштабе 1:100, чтобы браузер не округлял крошечный кегль.
function text(x, y, str, size, attrs = '') {
  return `<text transform="translate(${n(x)} ${n(y)}) scale(0.01)" font-family="${FONT}" font-size="${n(size * 100)}" ${attrs}>${esc(str)}</text>`;
}
const label = (x, y, str) => str ? text(x, y, str, 0.2,
  `text-anchor="middle" fill="${INK}" stroke="${PAPER}" stroke-width="5" paint-order="stroke" stroke-linejoin="round" pointer-events="none"`) : '';

// cone: false — луч камеры и света не рисуется (в редакторе он виден только у выбранного предмета)
let NOCONE = false;
function cone(id, x0, angle, len, color, opacity) {
  if (NOCONE) return '';
  const a = angle * Math.PI / 360;
  const x = n(x0 + len * Math.cos(a)), y = n(len * Math.sin(a));
  return `<defs><radialGradient id="cg-${id}" gradientUnits="userSpaceOnUse" cx="${x0}" cy="0" r="${len}">
    <stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>
    <path d="M${x0} 0 L${x} ${-y} A${len} ${len} 0 0 1 ${x} ${y} Z" fill="url(#cg-${id})" pointer-events="none"/>
    <path d="M${x} ${-y} L${x0} 0 L${x} ${y}" fill="none" stroke="${color}" stroke-opacity="${Math.min(1, opacity * 2)}" stroke-width="${S * 0.6}" pointer-events="none"/>`;
}

function furniture(o) {
  const k = FURN[o.kind] || FURN.table;
  return k.draw(o.w || k.w, o.h || k.h);
}

function light(o, icon) {
  const k = LIGHTS[o.kind] || LIGHTS.fresnel;
  const c = o.color || k.color || LIGHT, w = o.w || k.w || 0;
  const beam = x0 => icon || !k.beam || o.off ? '' : cone(o.id, x0, k.beam, k.len, c, 0.5);
  switch (k.shape) {
    case 'soft':
      return `${beam(-0.1)}<path d="M-0.28 -0.12 L0.04 ${-w / 2} L0.04 ${w / 2} L-0.28 0.12 Z" fill="${INK}" stroke="${INK}" stroke-width="${S}" stroke-linejoin="round"/>
        <path d="M0.06 ${-w / 2} V${w / 2}" stroke="${c}" stroke-width="0.07" stroke-linecap="round"/>`;
    case 'bar':
      return k.thin
        ? `${beam(-0.05)}<path d="M0 ${-w / 2} V${w / 2}" stroke="${INK}" stroke-width="0.1" stroke-linecap="round"/><path d="M0 ${-w / 2} V${w / 2}" stroke="${c}" stroke-width="0.05" stroke-linecap="round"/>`
        : `${beam(-0.1)}<rect x="-0.08" y="${-w / 2}" width="0.1" height="${w}" rx="0.02" fill="${INK}"/>
        <path d="M0.05 ${-w / 2} V${w / 2}" stroke="${c}" stroke-width="0.06" stroke-linecap="round"/><circle cx="-0.14" r="0.06" fill="${INK}"/>`;
    case 'ring':
      return `${beam(-0.05)}<ellipse rx="0.07" ry="${w / 2}" fill="none" stroke="${INK}" stroke-width="0.11"/><ellipse rx="0.07" ry="${w / 2}" fill="none" stroke="${c}" stroke-width="0.05"/>`;
    case 'glow': {
      const glow = icon || o.off ? '' : `<defs><radialGradient id="cg-${o.id}"><stop offset="0" stop-color="${c}" stop-opacity="0.55"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient></defs>
        <circle r="${k.glow}" fill="url(#cg-${o.id})" pointer-events="none"/>`;
      const r = k.r;
      // лампа сверху: абажур и патрон в середине; шар: тонкий крест
      const rays = k.lamp ? `<circle r="${n(r * 0.42)}" fill="#fff" stroke="${INK}" stroke-width="${S * 0.7}"/>` : `<path d="M${-r} 0 H${r} M0 ${-r} V${r}" stroke="${INK}" stroke-width="0.015"/>`;
      return `${glow}<circle r="${r}" fill="${c}" stroke="${INK}" stroke-width="${S}"/>${rays}`;
    }
    case 'sun': {
      let rays = '';
      const count = Math.max(3, Math.round(w / 0.4) + 1);
      for (let i = 0; i < count; i++) {
        const y = n(-w / 2 + (w * i) / (count - 1));
        rays += `<path d="M0 ${y} H1.1 M0.95 ${n(y - 0.08)} L1.1 ${y} L0.95 ${n(y + 0.08)}" fill="none" stroke="${c}" stroke-width="0.04" stroke-linecap="round" stroke-linejoin="round"/>`;
      }
      return `${rays}<circle cx="-0.2" r="0.17" fill="${c}" stroke="${INK}" stroke-width="${S}"/>`;
    }
    case 'cloth':
      return `<rect x="-0.035" y="${-w / 2}" width="0.07" height="${w}" fill="${k.fill}" stroke="${INK}" stroke-width="${S * 0.8}" ${k.dash ? 'stroke-dasharray="0.08 0.05"' : ''}/><circle cx="-0.1" r="0.05" fill="${INK}"/>`;
    default: {
      const r = k.r;
      const doors = k.open ? '' : `<path d="M${n(r * 0.8)} ${n(-r * 0.7)} L${n(r * 1.8)} ${n(-r * 1.3)} M${n(r * 0.8)} ${n(r * 0.7)} L${n(r * 1.8)} ${n(r * 1.3)}" stroke="${INK}" stroke-width="0.05" stroke-linecap="round"/>`;
      return `${beam(r * 0.5)}${doors}<circle r="${r}" fill="${INK}"/><rect x="${n(r * 0.5)}" y="${n(-r * 0.85)}" width="${n(r * 0.45)}" height="${n(r * 1.7)}" rx="0.02" fill="${c}"/>`;
    }
  }
}

function body(o, icon = false) {
  switch (o.type) {
    case 'character': {
      const letter = (o.name || '').trim().charAt(0).toUpperCase();
      return `<ellipse rx="0.17" ry="0.31" fill="${o.color || COLORS[0]}" stroke="${INK}" stroke-width="${S}"/>
        <path d="M0.13 -0.075 L0.29 0 L0.13 0.075 Z" fill="${INK}"/>
        <circle r="0.15" fill="#fff" stroke="${INK}" stroke-width="${S}"/>
        <g transform="rotate(${-(o.rot || 0)})" pointer-events="none">${text(0, 0.065, letter, 0.19, `text-anchor="middle" font-weight="700" fill="${INK}"`)}</g>`;
    }
    case 'camera': {
      const letter = (o.name || '').trim().charAt(0).toUpperCase();
      return `${icon ? '' : cone(o.id, 0.38, fov(o), 2.4, CAM, 0.22)}
        <rect x="-0.34" y="-0.18" width="0.5" height="0.36" rx="0.05" fill="${CAM}" stroke="${INK}" stroke-width="${S}"/>
        <path d="M0.16 -0.09 L0.38 -0.16 L0.38 0.16 L0.16 0.09 Z" fill="${CAM}" stroke="${INK}" stroke-width="${S}" stroke-linejoin="round"/>
        <g transform="translate(-0.09 0) rotate(${-(o.rot || 0)})" pointer-events="none">${text(0, 0.07, letter, 0.2, 'text-anchor="middle" font-weight="700" fill="#fff"')}</g>`;
    }
    // прибор света — с тёплым ореолом, чтобы на плане он сразу отличался от чёрных стен и мебели
    case 'light': return `${icon || (LIGHTS[o.kind] || {}).shape === 'sun' ? '' : `<circle r="${n(Math.max(0.3, (o.w || (LIGHTS[o.kind] || {}).w || 0) / 2 + 0.12))}" fill="#FFC83D" fill-opacity="0.28" stroke="#E8A300" stroke-width="${S * 0.8}" stroke-dasharray="0.06 0.04" pointer-events="none"/>`}${light(o, icon)}`;
    case 'furniture': return furniture(o);
    case 'door': {
      const w = o.w;
      return `<rect x="${-w / 2}" y="-0.1" width="${w}" height="0.2" fill="${PAPER}"/>
        <path d="M${-w / 2} 0 V${-w}" stroke="${INK}" stroke-width="0.05" stroke-linecap="round"/>
        <path d="M${-w / 2} ${-w} A${w} ${w} 0 0 1 ${w / 2} 0" fill="none" stroke="${INK}" stroke-width="${S * 0.6}" stroke-dasharray="0.08 0.06"/>`;
    }
    case 'window': {
      const w = o.w;
      return `<rect x="${-w / 2}" y="-0.09" width="${w}" height="0.18" fill="#CFE6F2" stroke="${INK}" stroke-width="${S}"/><path d="M${-w / 2} 0 H${w / 2}" stroke="${INK}" stroke-width="${S * 0.6}"/>`;
    }
    case 'image':
      return `<image href="${esc(srcOf(o.src))}" x="${-o.w / 2}" y="${-o.h / 2}" width="${o.w}" height="${o.h}" opacity="${o.opacity ?? 0.6}" preserveAspectRatio="none"/>`;
  }
  return '';
}

function smooth(pts) {
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  if (pts.length < 3) return d + pts.slice(1).map(p => ` L${n(p[0])} ${n(p[1])}`).join('');
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
}

function pathObj(o, scene) {
  const owner = scene && scene.objects.find(q => q.id === o.ownerId);
  const color = owner ? (owner.type === 'camera' ? CAM : owner.color || INK) : INK;
  const pts = o.points, d = smooth(pts);
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  const ghost = owner && owner.type === 'character'
    ? `<circle cx="${n(b[0])}" cy="${n(b[1])}" r="0.24" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="${S}" stroke-dasharray="0.07 0.05"/>` : '';
  return `<g data-id="${o.id}">
    <path d="${d}" fill="none" stroke="transparent" stroke-width="0.4" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="0.05" stroke-dasharray="0.16 0.1" stroke-linecap="round" pointer-events="none"/>
    ${ghost}<path transform="translate(${n(b[0])} ${n(b[1])}) rotate(${n(ang)})" d="M0.04 0 L-0.2 -0.11 L-0.2 0.11 Z" fill="${color}" pointer-events="none"/></g>`;
}

export function caption(o) {
  switch (o.type) {
    case 'character': return o.name || '';
    case 'camera': return `Кам. ${o.name || ''}, ${o.lens || 35} мм`;
    default: return o.label || '';
  }
}

// Один объект плана как SVG-разметка.
export function drawObject(o, opts = {}) {
  const was = NOCONE;
  NOCONE = opts.cone === false;
  try { return drawOne(o, opts); } finally { NOCONE = was; }
}
function drawOne(o, { scene, fresh } = {}) {
  if (o.type === 'wall') {
    const t = o.thickness || 0.15;
    return `<g data-id="${o.id}"><line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="transparent" stroke-width="${Math.max(0.4, t)}"/>
      <line x1="${o.x1}" y1="${o.y1}" x2="${o.x2}" y2="${o.y2}" stroke="${INK}" stroke-width="${t}" stroke-linecap="square" pointer-events="none"/></g>`;
  }
  if (o.type === 'path') return pathObj(o, scene);
  if (o.type === 'stroke') {
    const d = smooth(o.points.length > 1 ? o.points : [o.points[0], [o.points[0][0] + 0.001, o.points[0][1]]]);
    return `<g data-id="${o.id}"><path d="${d}" fill="none" stroke="transparent" stroke-width="${Math.max(0.3, o.width * 3)}" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${d}" fill="none" stroke="${o.color || '#E8306C'}" stroke-width="${o.width || 0.05}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/></g>`;
  }
  if (o.type === 'text') {
    const lines = String(o.text || '').split('\n');
    const size = o.size || 0.3;
    return `<g data-id="${o.id}">` + lines.map((l, i) => text(o.x, o.y + i * size * 1.25, l || ' ', size,
      `fill="${INK}" stroke="${PAPER}" stroke-width="5" paint-order="stroke" stroke-linejoin="round" font-weight="600"`)).join('') + '</g>';
  }
  const locked = o.type === 'image' && o.locked ? ' pointer-events="none"' : '';
  const g = `<g data-id="${o.id}" transform="translate(${n(o.x)} ${n(o.y)}) rotate(${n(o.rot || 0)})"${locked}${o.off ? ' opacity="0.4"' : ''}><g${fresh ? ' class="pop-in"' : ''}>${body(o)}</g></g>`;
  return g + label(o.x, o.y + extent(o) + 0.3, caption(o));
}

// Значок для палитры: тот же знак, что и на плане.
export function drawIcon(o) {
  const sun = o.type === 'light' && o.kind === 'sun';
  const r = sun ? 0.95 : o.type === 'furniture' ? Math.max(o.w, o.h) / 2 + 0.1 : Math.max(0.5, extent(o) + 0.14);
  const cx = sun ? 0.4 : 0;
  return `<svg viewBox="${n(cx - r)} ${n(-r)} ${n(r * 2)} ${n(r * 2)}" aria-hidden="true">${body({ id: 'i', rot: 0, ...o }, true)}</svg>`;
}

export function gridPattern(transform = '', id = 'grid') {
  return `<pattern id="${id}" width="1" height="1" patternUnits="userSpaceOnUse" ${transform ? `patternTransform="${transform}"` : ''}>
    <path d="M0.5 0 V1 M0 0.5 H1" fill="none" stroke="#D5DCD9" stroke-width="0.012"/>
    <path d="M1 0 H0 V1" fill="none" stroke="#BFC9C5" stroke-width="0.024"/></pattern>`;
}

const ORDER = { image: 0, furniture: 1, wall: 2, window: 3, door: 3, path: 4, light: 5, camera: 6, character: 7, text: 8, stroke: 9 };
export const sorted = objects => [...objects].sort((a, b) => ORDER[a.type] - ORDER[b.type]);

// Габариты плана по объектам (лучи света и камер не считаются).
export function bounds(plan) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, e = 0) => { x0 = Math.min(x0, x - e); y0 = Math.min(y0, y - e); x1 = Math.max(x1, x + e); y1 = Math.max(y1, y + e); };
  for (const o of plan.objects) {
    if (o.type === 'wall') { add(o.x1, o.y1); add(o.x2, o.y2); }
    else if (o.type === 'path' || o.type === 'stroke') o.points.forEach(p => add(p[0], p[1]));
    else add(o.x, o.y, extent(o));
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 6, h: 4 };
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

// Готовая картинка плана для миниатюр, режиссёрского сценария и печати.
// cameraId оставляет на плане только камеру этого кадра.
export function planSVG(plan, { cameraId = null, attrs = '', pad = 0.6 } = {}) {
  const b = bounds(plan);
  const x = n(b.x - pad), y = n(b.y - pad), w = n(b.w + pad * 2), h = n(b.h + pad * 2);
  const objs = sorted(plan.objects).filter(o => !(cameraId && o.type === 'camera' && o.id !== cameraId)
    && !(cameraId && o.type === 'path' && o.ownerId && (plan.objects.find(q => q.id === o.ownerId) || {}).type === 'camera' && o.ownerId !== cameraId));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" ${attrs}><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${PAPER}"/>
    ${objs.map(o => drawObject(o, { scene: plan })).join('')}</svg>`;
}
