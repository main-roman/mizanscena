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
