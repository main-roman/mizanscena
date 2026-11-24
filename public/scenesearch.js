// Умный поиск по сценам и разбору: номер сцены, место, инт/нат, режим, персонажи и актёры, локации,
// синопсис и все пункты разбора (реквизит, костюм, грим, транспорт…). Слова ищутся по началу с учётом
// окончаний: «столы» найдёт «стол», «столик», «столом». Подсказки показывают, какие именно вещи нашлись
// и в каких сценах, а при опечатке — похожие слова из самого разбора.
import { CATS, sceneItems } from './breakdown.js';
import { castList, synopsisOf, objectOf } from './schedmodel.js';

export const norm = t => String(t || '').toLowerCase().replace(/ё/g, 'е');
const words = t => norm(t).split(/[^a-zа-я0-9]+/).filter(Boolean);
// грубая основа русского слова: срезаем окончание, чтобы «столы», «стола», «столом» искались как «стол»
export function stem(w) {
  if (w.length <= 3 || /^\d/.test(w)) return w;
  const m = w.match(/^(.{3,}?)(ями|ами|ого|его|ому|ему|ыми|ими|ов|ев|ей|ом|ем|ой|ий|ый|ая|яя|ое|ее|ые|ие|ах|ях|а|я|ы|и|е|у|ю|о|ь)$/);
  return m ? m[1] : w;
}
const IE_WORDS = { 'ИНТ': 'инт интерьер павильон', 'НАТ': 'нат натура улица' };

// расстояние Левенштейна, с ранним выходом — для подсказок при опечатке
function dist(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const KIND = { ...CATS, actor: 'Актёр', place: 'Место' };
export const kindName = k => KIND[k] || k;
// слова, по которым находится вся графа: «костюм», «одежда», «реквизит», «машина»…
const KIND_WORDS = {
  cast: 'персонаж персонажи герой роль', extras: 'массовка групповка', props: 'реквизит предмет', costume: 'костюм одежда',
  makeup: 'грим', vehicles: 'транспорт машина', animals: 'животные', stunts: 'трюк трюки каскадер', sfx: 'эффекты спецэффекты пиротехника',
  sound: 'звук музыка', actor: 'актер актриса', place: 'место объект локация',
};
const kw = k => words(KIND_WORDS[k] || kindName(k));

export function buildIndex(p, info) {
  const cast = castList(p, info), vocab = new Map();
  const put = (kind, text, s) => {
    const key = kind + '|' + norm(text).trim();
    if (!norm(text).trim()) return;
    if (!vocab.has(key)) vocab.set(key, { kind, text: text.trim(), w: words(text), k: kw(kind), scenes: [] });
    const v = vocab.get(key);
    if (!v.scenes.some(x => x.id === s.id)) v.scenes.push({ id: s.id, n: s.n });
  };
  const scenes = info.map(s => {
    const it = sceneItems(p, s.id, info), items = [];
    for (const c of Object.keys(CATS)) for (const t of it[c]) {
      const text = c === 'cast' ? t.charAt(0) + t.slice(1).toLowerCase() : t;
      items.push({ cat: c, text, w: words(text), k: kw(c) }); put(c, text, s);
    }
    const actors = cast.filter(c => s.chars.includes(c.char) && c.actor).map(c => c.actor);
    for (const a of actors) put('actor', a, s);
    const obj = objectOf(p, s).name;
    put('place', obj, s);
    const ie = Object.entries(IE_WORDS).filter(([k]) => (s.ie || '').includes(k)).map(([, v]) => v).join(' ');
    const syn = synopsisOf(p, s);
    const hay = words([s.n, s.text, s.place, s.ie, ie, s.time, s.day, actors.join(' '), obj, syn, items.map(x => x.text).join(' ')].join(' ')).concat(...new Set(items.filter(x => x.cat !== 'cast').flatMap(x => x.k)));
    return { s, items, hay };
  });
  return { scenes, vocab: [...vocab.values()], all: [...new Set(scenes.flatMap(x => x.hay))] };
}

const tokens = q => words(q).map(w => ({ w, st: stem(w) }));
const hit = (list, t) => list.some(w => w.startsWith(t.st) || (t.w.length > 3 && t.w.startsWith(w) && w.length >= t.st.length));

// Подходит ли сцена. Одно число — номер сцены; иначе каждое слово запроса должно найтись.
export function matchScene(e, q) {
  const n = norm(q).trim();
  if (!n) return true;
  if (/^\d+[а-яa-z]?$/.test(n)) return norm(e.s.n) === n;
  return tokens(q).every(t => hit(e.hay, t));
}
// Какие пункты разбора сцены совпали с запросом — их подсвечиваем в строке.
export function matchedItems(e, q) {
  const ts = tokens(q).filter(t => !/^\d/.test(t.w));
  return ts.length ? e.items.filter(x => ts.some(t => hit(x.w, t) || hit(x.k, t))) : [];
}

// Подсказки: вещи, персонажи и места, подходящие под запрос, с номерами сцен. Если ничего — близкие по написанию.
export function suggest(idx, q, limit = 14) {
  const ts = tokens(q).filter(t => !/^\d/.test(t.w));
  if (!ts.length) return { list: [], fixes: [] };
  // вещь подходит, если в её названии (или в названии графы) нашлось хоть одно слово запроса;
  // выше те, где нашлось больше слов, где слово совпало в названии, а не в графе, и что встречается чаще
  const scored = idx.vocab.map(v => {
    const own = ts.filter(t => hit(v.w, t)).length, cat = ts.filter(t => !hit(v.w, t) && hit(v.k, t)).length;
    return { ...v, own, score: own + cat };
  }).filter(v => v.score);
  const best = Math.max(0, ...scored.map(v => v.score));
  const list = scored.filter(v => v.score === best)
    .sort((a, b) => b.own - a.own || b.scenes.length - a.scenes.length || a.text.length - b.text.length)
    .slice(0, limit);
  // слова запроса, которых нет нигде, — подсказать похожие по написанию
  const known = t => idx.all.some(w => w.startsWith(t.st)) || idx.vocab.some(v => hit(v.k, t));
  const bad = ts.filter(t => !known(t)), fixes = [];
  for (const t of bad) {
    const near = idx.all.filter(w => w.length > 2 && !/^\d/.test(w))
      .map(w => ({ w, d: Math.min(dist(t.w, w), w.length > t.w.length ? dist(t.w, w.slice(0, t.w.length)) : 9) }))
      .filter(x => x.d <= (t.w.length > 5 ? 2 : 1))
      .sort((a, b) => a.d - b.d || a.w.length - b.w.length).slice(0, 5);
    for (const x of near) if (!fixes.some(f => f.to === x.w)) fixes.push({ from: t.w, to: x.w });
  }
  return { list: bad.length ? [] : list, fixes: fixes.slice(0, 6) };
}
