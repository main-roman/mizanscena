// Рассвет, закат и сумерки без интернета: астрономический расчёт по дате и координатам (формулы NOAA).
// Время возвращается по часам этого компьютера.

const rad = Math.PI / 180;

// Координаты из того, что вписано в адрес локации: ссылка Яндекс.Карт (ll=долгота,широта или pt=…),
// Google Maps (@широта,долгота), или просто «43.48, 43.61».
const found = new Map();
const store = () => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };
export function rememberCoords(text, c) {
  const k = String(text || '').trim().toLowerCase();
  if (!k || !c) return;
  found.set(k, c);
  try { const ls = store(); if (ls) { const all = JSON.parse(ls.getItem('miz:coords') || '{}'); all[k] = c; ls.setItem('miz:coords', JSON.stringify(all)); } } catch { /* без кэша */ }
}
function known(text) {
  const k = String(text || '').trim().toLowerCase();
  if (!k) return null;
  if (found.has(k)) return found.get(k);
  try { const ls = store(); const c = ls && JSON.parse(ls.getItem('miz:coords') || '{}')[k]; if (c) { found.set(k, c); return c; } } catch { /* без кэша */ }
  return null;
}

export function coordsOf(text) {
  let t;
  try { t = decodeURIComponent(String(text || '')).replace(/%2C/gi, ','); } catch { t = String(text || ''); }
  let m = t.match(/[?&](?:ll|pt|whatshere%5Bpoint%5D|whatshere\[point\])=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: +m[2], lng: +m[1] };
  m = t.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: +m[1], lng: +m[2] };
  m = t.match(/(?:^|[^\d.])(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
  if (m) return { lat: +m[1], lng: +m[2] };
  return known(text); // обычный адрес: координаты, найденные раньше по городу
}

// Момент, когда солнце на высоте h градусов (утром и вечером) в этот день. null — не восходит или не заходит.
function times(date, lat, lng, h) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12));
  const n = Math.round((d - Date.UTC(2000, 0, 1, 12)) / 864e5);
  const J = n - lng / 360;
  const M = (357.5291 + 0.98560028 * J) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const transit = 2451545 + J + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const dec = Math.asin(Math.sin(L * rad) * Math.sin(23.4397 * rad));
  const cosH = (Math.sin(h * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
  if (cosH < -1 || cosH > 1) return null;
  const w = Math.acos(cosH) / rad / 360;
  const toDate = jd => new Date((jd - 2440587.5) * 864e5);
  return { rise: toDate(transit - w), set: toDate(transit + w) };
}

const hm = d => d ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';

// { dawn, sunrise, sunset, dusk, golden: [утро до, вечер с] } строками «чч:мм»
export function sunDay(dateStr, c) {
  if (!dateStr || !c) return null;
  const [y, mo, da] = dateStr.split('-').map(Number);
  const date = new Date(y, mo - 1, da);
  const sun = times(date, c.lat, c.lng, -0.833), civil = times(date, c.lat, c.lng, -6), gold = times(date, c.lat, c.lng, 6);
  return {
    dawn: hm(civil && civil.rise), sunrise: hm(sun && sun.rise), sunset: hm(sun && sun.set), dusk: hm(civil && civil.set),
    goldMorning: hm(gold && gold.rise), goldEvening: hm(gold && gold.set),
  };
}

// Где солнце в момент «дата + время» по часам этого компьютера: азимут (0 — север, 90 — восток, по часовой)
// и высота над горизонтом в градусах. Формулы NOAA, точность — доли градуса, для плана света хватает.
export function sunAt(dateStr, timeStr, c) {
  if (!dateStr || !c) return null;
  const [y, mo, da] = dateStr.split('-').map(Number), m = String(timeStr || '12:00').match(/(\d{1,2}):(\d{2})/);
  const t = new Date(y, mo - 1, da, m ? +m[1] : 12, m ? +m[2] : 0);
  const jd = t.getTime() / 864e5 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * T) * rad);
  const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos((125.04 - 1934.136 * T) * rad);
  const dec = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const yv = Math.tan(eps / 2 * rad) ** 2;
  const eqt = 4 / rad * (yv * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * yv * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * yv * yv * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
  const utcMin = t.getUTCHours() * 60 + t.getUTCMinutes();
  let ha = (utcMin + eqt + 4 * c.lng) / 4 - 180; // часовой угол, градусы
  if (ha < -180) ha += 360;
  const lat = c.lat * rad;
  const cosZ = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha * rad);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(lat) * Math.cos(zen) - Math.sin(dec)) / (Math.cos(lat) * Math.sin(zen))))) / rad;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { az: Math.round(az), alt: Math.round(90 - zen / rad) };
}
const SIDES = ['север', 'северо-восток', 'восток', 'юго-восток', 'юг', 'юго-запад', 'запад', 'северо-запад'];
export const sideOf = az => SIDES[Math.round(az / 45) % 8];
