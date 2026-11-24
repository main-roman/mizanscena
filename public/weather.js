// Погода на день съёмки и координаты по адресу — из Open-Meteo (бесплатно, без ключа и регистрации).
// Прогноз есть примерно на 16 дней вперёд и на 3 месяца назад; для более далёких дат его просто нет.
// Координаты: из ссылки на карту, а если вписан обычный адрес — по названию города (первое слово до запятой).
import { coordsOf, rememberCoords } from './sun.js';

const mem = new Map();
const read = k => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v && v.until > Date.now() ? v.data : undefined; } catch { return undefined; } };
const keep = (k, data, hours) => { try { localStorage.setItem(k, JSON.stringify({ data, until: Date.now() + hours * 36e5 })); } catch { /* места нет — обойдёмся без кэша */ } };

// город из адреса: «Нальчик, ул. Ленина, 1» -> «Нальчик»; «г. Москва, …» -> «Москва»
const cityOf = text => String(text || '').split(',')[0].replace(/^\s*(г\.|город)\s*/i, '').trim();

// координаты адреса; null — не нашлось
export async function locate(text) {
  const direct = coordsOf(text);
  if (direct) return direct;
  const city = cityOf(text);
  if (!city || /^https?:/i.test(city)) return null;
  const k = 'miz:geo:' + city.toLowerCase();
  const cached = read(k);
  if (cached !== undefined) { if (cached) rememberCoords(text, cached); return cached; }
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=ru&name=${encodeURIComponent(city)}`);
    const j = await r.json(), x = j.results && j.results[0];
    const c = x ? { lat: x.latitude, lng: x.longitude } : null;
    keep(k, c, 24 * 30);
    if (c) rememberCoords(text, c);
    return c;
  } catch { return null; }
}

// Коды погоды WMO -> по-русски
const WMO = {
  0: 'Ясно', 1: 'Преимущественно ясно', 2: 'Переменная облачность', 3: 'Пасмурно', 45: 'Туман', 48: 'Изморозь, туман',
  51: 'Слабая морось', 53: 'Морось', 55: 'Сильная морось', 56: 'Ледяная морось', 57: 'Ледяная морось',
  61: 'Небольшой дождь', 63: 'Дождь', 65: 'Сильный дождь', 66: 'Ледяной дождь', 67: 'Ледяной дождь',
  71: 'Небольшой снег', 73: 'Снег', 75: 'Сильный снег', 77: 'Снежная крупа', 80: 'Ливень', 81: 'Ливни', 82: 'Сильные ливни',
  85: 'Снегопад', 86: 'Сильный снегопад', 95: 'Гроза', 96: 'Гроза с градом', 99: 'Гроза с градом',
};
const deg = t => { const r = Math.round(t); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r) + '°'; };

// { text, day, night, wind } на дату; null — прогноза на эту дату нет
export async function weatherFor(c, date) {
  if (!c || !date) return null;
  const days = (new Date(date + 'T12:00') - Date.now()) / 864e5;
  if (days > 15.5 || days < -90) return null;
  const k = `miz:wx:${c.lat.toFixed(2)},${c.lng.toFixed(2)}:${date}`;
  if (mem.has(k)) return mem.get(k);
  const cached = read(k);
  if (cached !== undefined) { mem.set(k, cached); return cached; }
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&wind_speed_unit=ms&timezone=auto&start_date=${date}&end_date=${date}`);
    const j = await r.json(), d = j.daily;
    if (!d || !d.time || !d.time.length) return null;
    const rain = d.precipitation_probability_max && d.precipitation_probability_max[0];
    const wind = d.wind_speed_10m_max && d.wind_speed_10m_max[0];
    const w = {
      text: [WMO[d.weather_code[0]] || '', rain >= 30 ? `осадки ${rain}%` : '', wind >= 8 ? `ветер до ${Math.round(wind)} м/с` : ''].filter(Boolean).join(', '),
      day: deg(d.temperature_2m_max[0]), night: deg(d.temperature_2m_min[0]),
    };
    mem.set(k, w);
    keep(k, w, days < 0 ? 24 * 30 : 3); // прошлое не меняется, прогноз — обновляем каждые три часа
    return w;
  } catch { return null; }
}
