// Разбор сценария: шапка сцены (ИНТ/НАТ, место, время), длина в восьмых страницы,
// персонажи и находки по графам (реквизит, костюм, транспорт и т. д.).
// Без браузера: этим же модулем пользуется ИИ-помощник через MCP.

export const CATS = {
  cast: 'Персонажи', extras: 'Массовка', props: 'Реквизит', costume: 'Костюм', makeup: 'Грим',
  vehicles: 'Транспорт', animals: 'Животные', stunts: 'Трюки', sfx: 'Спецэффекты', sound: 'Звук и музыка',
};

const TIME = /^(ДЕНЬ|НОЧЬ|УТРО|ВЕЧЕР|РЕЖИМ|СУМЕРКИ|РАССВЕТ|ЗАКАТ|ПОЛДЕНЬ|DAY|NIGHT|MORNING|EVENING|DUSK|DAWN|CONTINUOUS)(?![А-ЯЁA-Z])/iu;
const IE = /^(ИНТ\.?\s*\/\s*НАТ|НАТ\.?\s*\/\s*ИНТ|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|ИНТ|НАТ|ЭКСТ|INT|EXT|I\/E)\.?\s*/i;

// «ИНТ. ДОМ БАТЫРА.ГОСТИНАЯ. ДЕНЬ. ДЕНЬ 1 (00:15)» -> { ie: 'ИНТ', place: 'ДОМ БАТЫРА. ГОСТИНАЯ', time: 'ДЕНЬ', day: 'ДЕНЬ 1', dur: '00:15' }
export function parseHeading(text) {
  let t = String(text || '').trim();
  const out = { ie: '', place: '', time: '', day: '', dur: '' };
  const d = t.match(/\(\s*(\d{1,2}:\d{2})\s*\)\s*$/);
  if (d) { out.dur = d[1]; t = t.slice(0, d.index).trim(); }
  const ie = t.match(IE);
  if (ie) {
    const raw = ie[1].toUpperCase().replace(/\s|\./g, '');
    out.ie = { EXT: 'НАТ', ЭКСТ: 'НАТ', INT: 'ИНТ' }[raw] || raw;
    t = t.slice(ie[0].length);
  }
  const parts = t.split(/\s*[.–—]\s*|\s+-\s+/).map(s => s.trim()).filter(Boolean);
  const ti = parts.findIndex(s => TIME.test(s));
  if (ti >= 0) {
    out.time = parts[ti].match(TIME)[1].toUpperCase();
    out.place = parts.slice(0, ti).join('. ');
    out.day = parts.slice(ti + 1).join('. ') || parts[ti].replace(TIME, '').trim();
  } else out.place = parts.join('. ');
  return out;
}

// строк на страницу и ширина блока в знаках, как в оценке объёма сценария
const WIDTH = { action: 58, scene: 58, dialogue: 29, paren: 19, character: 31, transition: 58, title: 58, note: 58 };
const linesOf = b => b.type === 'note' ? 0 : Math.max(1, Math.ceil((b.text || '').length / (WIDTH[b.type] || 58))) + (b.type === 'scene' ? 2 : b.type === 'dialogue' || b.type === 'paren' ? 0 : 1);

// длина в восьмых: 11 -> «1 3/8»
export const eighthsText = n => { const w = Math.floor(n / 8), r = n % 8; return [w ? String(w) : '', r ? `${r}/8` : ''].filter(Boolean).join(' ') || '0'; };

// персонаж из блока «Персонаж»: без пометок вроде (З.К.), (ПРОД.), V.O.
export const cleanName = t => String(t || '').replace(/\(.*?\)/g, '')
  .replace(/(^|\s)(V\.?O\.?|O\.?S\.?|CONT'?D|Г\.?\s?З\.?\s?К\.?|З\.?\s?К\.?|ПРОД\.?)(?=\s|$)/giu, ' ')
  .replace(/[.:]+$/, '').replace(/\s+/g, ' ').trim().toUpperCase();

// Все сцены с разбором шапки, длиной и персонажами.
export function sceneInfo(p) {
  const blocks = p.script.blocks, out = [];
  const known = new Set(blocks.filter(b => b.type === 'character').map(b => cleanName(b.text)).filter(n => n.length > 1));
  let cur = null;
  for (const b of blocks) {
    if (b.type === 'scene') { cur = { id: b.id, n: out.length + 1, text: b.text, ...parseHeading(b.text), lines: 0, blocks: [], speaking: new Set(), seen: new Set() }; out.push(cur); }
    if (!cur) continue;
    cur.lines += linesOf(b);
    if (b.type !== 'scene') cur.blocks.push(b);
    if (b.type === 'character') { const n = cleanName(b.text); if (n) cur.speaking.add(n); }
  }
  for (const s of out) {
    // молчащие персонажи: имя из списка говорящих встречается в действии
    const text = s.blocks.filter(b => b.type === 'action' || b.type === 'paren').map(b => b.text.toUpperCase()).join('\n');
    for (const n of known) if (!s.speaking.has(n) && new RegExp(`(^|[^А-ЯЁA-Z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(text)) s.seen.add(n);
    s.eighths = Math.max(1, Math.round(s.lines / 58 * 8));
    s.chars = [...s.speaking, ...s.seen];
  }
  return out;
}

// ---------- находки по словарю ----------
// [начало слова, как назвать, графа, сколько букв можно дописать к началу]
const DICT = [
  // транспорт
  ['машин', 'Машина', 'vehicles'], ['автомобил', 'Автомобиль', 'vehicles'], ['такси', 'Такси', 'vehicles', 0], ['автобус', 'Автобус', 'vehicles'],
  ['грузовик', 'Грузовик', 'vehicles'], ['мотоцикл', 'Мотоцикл', 'vehicles'], ['велосипед', 'Велосипед', 'vehicles'], ['трактор', 'Трактор', 'vehicles'],
  ['поезд', 'Поезд', 'vehicles'], ['электричк', 'Электричка', 'vehicles'], ['лодк', 'Лодка', 'vehicles'], ['катер', 'Катер', 'vehicles'],
  ['самолёт', 'Самолёт', 'vehicles'], ['самолет', 'Самолёт', 'vehicles'], ['вертолёт', 'Вертолёт', 'vehicles'], ['вертолет', 'Вертолёт', 'vehicles'],
  ['маршрутк', 'Маршрутка', 'vehicles'], ['телег', 'Телега', 'vehicles'], ['скорая', 'Скорая помощь', 'vehicles', 1], ['нив', 'Нива', 'vehicles', 1], ['уаз', 'УАЗ', 'vehicles', 1],
  // животные
  ['собак', 'Собака', 'animals'], ['пёс', 'Пёс', 'animals', 0], ['пса', 'Пёс', 'animals', 2], ['щен', 'Щенок', 'animals', 4], ['кошк', 'Кошка', 'animals'],
  ['кот', 'Кот', 'animals', 2], ['котён', 'Котёнок', 'animals'], ['лошад', 'Лошадь', 'animals'], ['конь', 'Конь', 'animals', 0], ['коня', 'Конь', 'animals', 0],
  ['коров', 'Корова', 'animals'], ['овц', 'Овцы', 'animals'], ['овец', 'Овцы', 'animals', 0], ['баран', 'Баран', 'animals'], ['коз', 'Коза', 'animals', 2],
  ['кур', 'Куры', 'animals', 2], ['петух', 'Петух', 'animals'], ['птиц', 'Птица', 'animals'], ['ворон', 'Ворона', 'animals'], ['голуб', 'Голубь', 'animals'],
  ['ишак', 'Ишак', 'animals'], ['осл', 'Осёл', 'animals', 2], ['волк', 'Волк', 'animals'], ['медвед', 'Медведь', 'animals'],
  // спецэффекты
  ['дожд', 'Дождь', 'sfx'], ['ливень', 'Дождь', 'sfx', 0], ['снег', 'Снег', 'sfx'], ['туман', 'Туман', 'sfx'], ['огон', 'Огонь', 'sfx'], ['огн', 'Огонь', 'sfx', 3],
  ['костёр', 'Костёр', 'sfx'], ['костер', 'Костёр', 'sfx'], ['костр', 'Костёр', 'sfx'], ['пожар', 'Пожар', 'sfx'], ['дым', 'Дым', 'sfx'], ['взрыв', 'Взрыв', 'sfx'],
  ['выстрел', 'Выстрел', 'sfx'], ['молни', 'Молния', 'sfx'], ['гроз', 'Гроза', 'sfx', 2], ['пар', 'Пар', 'sfx', 1], ['ветер', 'Ветер', 'sfx'], ['ветр', 'Ветер', 'sfx', 3],
  // грим
  ['кров', 'Кровь', 'makeup'], ['синяк', 'Синяк', 'makeup'], ['шрам', 'Шрам', 'makeup'], ['ран', 'Рана', 'makeup', 2], ['ссадин', 'Ссадина', 'makeup'],
  ['слёз', 'Слёзы', 'makeup'], ['слез', 'Слёзы', 'makeup'], ['пот', 'Пот', 'makeup', 1], ['татуир', 'Татуировка', 'makeup'], ['седин', 'Седина', 'makeup'],
  ['бород', 'Борода', 'makeup'], ['усы', 'Усы', 'makeup', 0], ['морщин', 'Морщины', 'makeup'], ['грязн', 'Грязь на лице или одежде', 'makeup'],
  // костюм
  ['плать', 'Платье', 'costume'], ['рубашк', 'Рубашка', 'costume'], ['куртк', 'Куртка', 'costume'], ['пальто', 'Пальто', 'costume', 0], ['шуб', 'Шуба', 'costume', 2],
  ['шапк', 'Шапка', 'costume'], ['платок', 'Платок', 'costume'], ['платк', 'Платок', 'costume'], ['косынк', 'Косынка', 'costume'], ['пиджак', 'Пиджак', 'costume'],
  ['джинс', 'Джинсы', 'costume'], ['футболк', 'Футболка', 'costume'], ['свитер', 'Свитер', 'costume'], ['халат', 'Халат', 'costume'], ['сапог', 'Сапоги', 'costume'],
  ['ботинк', 'Ботинки', 'costume'], ['туфл', 'Туфли', 'costume'], ['кроссовк', 'Кроссовки', 'costume'], ['шарф', 'Шарф', 'costume'], ['папах', 'Папаха', 'costume'],
  ['черкеск', 'Черкеска', 'costume'], ['фартук', 'Фартук', 'costume'], ['пижам', 'Пижама', 'costume'], ['галстук', 'Галстук', 'costume'], ['спортивн', 'Спортивная форма', 'costume'],
  ['траур', 'Траурная одежда', 'costume'], ['хиджаб', 'Хиджаб', 'costume'], ['фуражк', 'Фуражка', 'costume'], ['кепк', 'Кепка', 'costume'],
  // массовка
  ['толп', 'Толпа', 'extras'], ['люди', 'Люди', 'extras', 0], ['людей', 'Люди', 'extras', 0], ['гост', 'Гости', 'extras', 2], ['сосед', 'Соседи', 'extras'],
  ['прохож', 'Прохожие', 'extras'], ['зрител', 'Зрители', 'extras'], ['родственник', 'Родственники', 'extras'], ['массовк', 'Массовка', 'extras'],
  ['болельщик', 'Болельщики', 'extras'], ['игрок', 'Игроки', 'extras'], ['ученик', 'Ученики', 'extras'], ['покупател', 'Покупатели', 'extras'],
  ['пассажир', 'Пассажиры', 'extras'], ['мужчин', 'Мужчины', 'extras'], ['женщин', 'Женщины', 'extras'], ['старик', 'Старики', 'extras'], ['старух', 'Старухи', 'extras'],
  // трюки
  ['драк', 'Драка', 'stunts'], ['дерут', 'Драка', 'stunts'], ['падает', 'Падение', 'stunts', 0], ['упал', 'Падение', 'stunts', 2], ['прыга', 'Прыжок', 'stunts', 3],
  ['прыгн', 'Прыжок', 'stunts', 4], ['погон', 'Погоня', 'stunts'], ['борьб', 'Борьба', 'stunts'], ['борет', 'Борьба', 'stunts', 2], ['бросается', 'Бросок', 'stunts', 0],
  ['скач', 'Скачка верхом', 'stunts', 3], ['верхом', 'Верховая езда', 'stunts', 0],
  // звук
  ['музык', 'Музыка', 'sound'], ['песн', 'Песня', 'sound'], ['поёт', 'Пение в кадре', 'sound', 0], ['поет', 'Пение в кадре', 'sound', 0], ['пою', 'Пение в кадре', 'sound', 1],
  ['звонок', 'Звонок', 'sound'], ['звонит', 'Звонок', 'sound', 0], ['радио', 'Радио', 'sound', 0], ['гром', 'Гром', 'sound', 0], ['лай', 'Лай собаки', 'sound', 1],
  ['крик', 'Крик', 'sound'], ['кричит', 'Крик', 'sound', 0], ['плач', 'Плач', 'sound', 3], ['свист', 'Свист', 'sound'], ['телевизор', 'Телевизор', 'props'],
  // реквизит
  ['телефон', 'Телефон', 'props'], ['мобильн', 'Мобильный телефон', 'props'], ['смартфон', 'Смартфон', 'props'], ['чашк', 'Чашка', 'props'], ['кружк', 'Кружка', 'props'],
  ['стакан', 'Стакан', 'props'], ['бутылк', 'Бутылка', 'props'], ['бокал', 'Бокал', 'props'], ['рюмк', 'Рюмка', 'props'], ['тарелк', 'Тарелка', 'props'],
  ['ложк', 'Ложка', 'props'], ['вилк', 'Вилка', 'props'], ['нож', 'Нож', 'props', 3], ['чайник', 'Чайник', 'props'], ['кастрюл', 'Кастрюля', 'props'],
  ['сковород', 'Сковорода', 'props'], ['поднос', 'Поднос', 'props'], ['кувшин', 'Кувшин', 'props'], ['таз', 'Таз', 'props', 2], ['ведр', 'Ведро', 'props'],
  ['хлеб', 'Хлеб', 'props'], ['лепёшк', 'Лепёшки', 'props'], ['лепешк', 'Лепёшки', 'props'], ['чай', 'Чай', 'props', 1], ['кофе', 'Кофе', 'props', 0],
  ['торт', 'Торт', 'props'], ['конфет', 'Конфеты', 'props'], ['яблок', 'Яблоки', 'props'], ['лук', 'Лук', 'props', 2], ['мяс', 'Мясо', 'props', 2],
  ['суп', 'Суп', 'props', 2], ['сыр', 'Сыр', 'props', 2], ['хинкал', 'Хинкал', 'props'], ['пирог', 'Пирог', 'props'], ['фрукт', 'Фрукты', 'props'],
  ['вино', 'Вино', 'props', 0], ['вина', 'Вино', 'props', 0], ['водк', 'Водка', 'props'], ['пиво', 'Пиво', 'props', 0], ['сигарет', 'Сигарета', 'props'],
  ['зажигалк', 'Зажигалка', 'props'], ['спичк', 'Спички', 'props'], ['трубк', 'Трубка', 'props'], ['книг', 'Книга', 'props'], ['тетрад', 'Тетрадь', 'props'],
  ['блокнот', 'Блокнот', 'props'], ['ручк', 'Ручка', 'props'], ['карандаш', 'Карандаш', 'props'], ['письм', 'Письмо', 'props'], ['конверт', 'Конверт', 'props'],
  ['газет', 'Газета', 'props'], ['журнал', 'Журнал', 'props'], ['фотографи', 'Фотография', 'props'], ['фото', 'Фотография', 'props', 0], ['рамк', 'Рамка', 'props'],
  ['сумк', 'Сумка', 'props'], ['рюкзак', 'Рюкзак', 'props'], ['чемодан', 'Чемодан', 'props'], ['пакет', 'Пакет', 'props'], ['коробк', 'Коробка', 'props'],
  ['ключ', 'Ключи', 'props', 2], ['деньг', 'Деньги', 'props'], ['денег', 'Деньги', 'props', 0], ['кошел', 'Кошелёк', 'props'], ['часы', 'Часы', 'props', 0],
  ['очки', 'Очки', 'props', 0], ['очков', 'Очки', 'props', 0], ['зонт', 'Зонт', 'props'], ['мяч', 'Мяч', 'props', 2], ['игрушк', 'Игрушка', 'props'], ['кукл', 'Кукла', 'props'],
  ['подушк', 'Подушка', 'props'], ['одеял', 'Одеяло', 'props'], ['полотенц', 'Полотенце', 'props'], ['тряпк', 'Тряпка', 'props'], ['веник', 'Веник', 'props'],
  ['метл', 'Метла', 'props'], ['лопат', 'Лопата', 'props'], ['топор', 'Топор', 'props'], ['молот', 'Молоток', 'props'], ['пистолет', 'Пистолет', 'props'],
  ['ружь', 'Ружьё', 'props'], ['ружьё', 'Ружьё', 'props'], ['кинжал', 'Кинжал', 'props'], ['сабл', 'Сабля', 'props'], ['шашк', 'Шашка', 'props'],
  ['кольц', 'Кольцо', 'props'], ['серьг', 'Серьги', 'props'], ['бус', 'Бусы', 'props', 1], ['цвет', 'Цветы', 'props', 2], ['букет', 'Букет', 'props'],
  ['свеч', 'Свеча', 'props'], ['фонар', 'Фонарь', 'props'], ['пульт', 'Пульт', 'props'], ['ноутбук', 'Ноутбук', 'props'], ['компьютер', 'Компьютер', 'props'],
  ['планшет', 'Планшет', 'props'], ['наушник', 'Наушники', 'props'], ['зеркал', 'Зеркало', 'props'], ['расчёск', 'Расчёска', 'props'], ['расческ', 'Расчёска', 'props'],
  ['документ', 'Документы', 'props'], ['паспорт', 'Паспорт', 'props'], ['флаг', 'Флаг', 'props'], ['венок', 'Венок', 'props'], ['гроб', 'Гроб', 'props'],
  ['носилк', 'Носилки', 'props'], ['коляск', 'Коляска', 'props'], ['скатерт', 'Скатерть', 'props'], ['салфетк', 'Салфетки', 'props'], ['тапочк', 'Тапочки', 'costume'],
  ['палк', 'Палка', 'props'], ['трость', 'Трость', 'props'], ['посох', 'Посох', 'props'], ['верёвк', 'Верёвка', 'props'], ['веревк', 'Верёвка', 'props'],
  ['мешок', 'Мешок', 'props'], ['мешк', 'Мешок', 'props'], ['корзин', 'Корзина', 'props'], ['банк', 'Банка', 'props', 2], ['сигнал', 'Сигнал', 'sound'],
  ['свисток', 'Свисток', 'props'], ['секундомер', 'Секундомер', 'props'], ['кубок', 'Кубок', 'props'], ['медал', 'Медаль', 'props'], ['гантел', 'Гантели', 'props'],
  ['тесто', 'Тесто', 'props', 1], ['мук', 'Мука', 'props', 2], ['соль', 'Соль', 'props', 0], ['сахар', 'Сахар', 'props'], ['таблетк', 'Таблетки', 'props'], ['лекарств', 'Лекарство', 'props'],
];

// Что слово «нож» не находится в «ножницы»: после начала слова можно дописать не больше указанного числа букв.
function findings(text) {
  const words = String(text).toLowerCase().match(/[а-яёa-z]+/g) || [], found = new Map();
  for (const w of words) {
    for (const [stem, name, cat, tail = 4] of DICT) {
      if (w.startsWith(stem) && w.length - stem.length <= tail) { found.set(cat + ':' + name, { cat, text: name }); break; }
    }
  }
  return [...found.values()];
}

// Разбор одной сцены по словарю. Персонажи берутся из сценария сами и сюда не входят.
export function analyzeScene(p, sceneId, info = sceneInfo(p)) {
  const s = info.find(x => x.id === sceneId);
  if (!s) return [];
  const text = s.blocks.filter(b => b.type === 'action' || b.type === 'paren' || b.type === 'title').map(b => b.text).join('\n');
  return findings(text);
}

// Разбор, лежащий в проекте: [{ id, sceneId, cat, text, auto, off }]. off: найдено автоматически, но человек убрал.
export function normalizeBreakdown(p, uid) {
  p.breakdown = Array.isArray(p.breakdown) ? p.breakdown.filter(x => x && x.text && CATS[x.cat]) : [];
  for (const x of p.breakdown) { x.id = x.id || uid(); x.sceneId = x.sceneId || ''; x.auto = !!x.auto; x.off = !!x.off; if (!x.off || x.offBy !== 'ai') delete x.offBy; }
}

// Добавляет найденное в проект, не повторяя уже записанное и убранное человеком. Возвращает число новых.
export function applyAnalysis(p, sceneIds, uid) {
  const info = sceneInfo(p);
  let added = 0;
  for (const sid of sceneIds) {
    const have = new Set(p.breakdown.filter(x => x.sceneId === sid).map(x => x.cat + ':' + x.text.toLowerCase()));
    for (const f of analyzeScene(p, sid, info)) {
      if (have.has(f.cat + ':' + f.text.toLowerCase())) continue;
      p.breakdown.push({ id: uid(), sceneId: sid, cat: f.cat, text: f.text, auto: true, off: false });
      added++;
    }
  }
  return added;
}

// Что есть в сцене по разбору, по графам: персонажи из текста плюс дописанные, остальное из записей (без убранных).
// withLoc: добавить в реквизит то, что художник вписал в локации (общее для локации и для этой сцены).
export function sceneItems(p, sceneId, info = sceneInfo(p), withLoc = true) {
  const s = info.find(x => x.id === sceneId), out = {};
  for (const c of Object.keys(CATS)) out[c] = [];
  if (!s) return out;
  out.cast = [...s.chars];
  const add = (c, t) => { if (!Object.values(out).some(v => v.some(q => q.toLowerCase() === t.toLowerCase()))) out[c].push(t); };
  for (const x of (p.breakdown || []).filter(i => i.sceneId === sceneId && !i.off)) add(x.cat, x.text);
  if (withLoc) for (const x of locProps(p, sceneId)) add('props', x.text);
  return out;
}

// Постановочный реквизит локаций, вписанный именно для этой сцены. Общий реквизит локации (стол, стулья
// и прочая база) сюда не входит: в разборе сцены и в подсказках кадров он только мешает.
export function locProps(p, sceneId) {
  return (p.locations || []).filter(l => l.sceneIds.includes(sceneId))
    .flatMap(l => l.props.filter(x => x.sceneId === sceneId && x.text.trim()).map(x => ({ text: x.text.trim(), loc: l, prop: x })));
}

// Графа по словам: «чёрный платок» — костюм, «синяк» — грим, остальное — реквизит.
export function guessCat(text) {
  const f = findings(text).map(x => x.cat);
  for (const c of ['costume', 'makeup', 'animals', 'vehicles', 'sfx']) if (f.includes(c)) return c;
  return 'props';
}

// Пункты из текста ячейки кадра: «Чашка, нож; синяк» -> ['Чашка', 'нож', 'синяк']
export const splitItems = text => String(text || '').split(/[,;\n]+/).map(t => t.trim().replace(/\.$/, '')).filter(t => t && t.length <= 80);

const findItem = (p, sceneId, t) => (p.breakdown || []).find(x => x.sceneId === sceneId && x.text.toLowerCase() === t.toLowerCase());

// Вписанное в кадр уходит в разбор сцены (с догадкой о графе), а реквизит ещё и в локации этой сцены.
export function syncShotProps(p, sceneId, text, uid) {
  if (!sceneId) return 0;
  const info = sceneInfo(p), s = info.find(x => x.id === sceneId);
  if (!s) return 0;
  let n = 0;
  for (const t of splitItems(text)) {
    if (s.chars.some(c => c.toLowerCase() === t.toLowerCase())) continue;
    let it = findItem(p, sceneId, t);
    if (it) { if (it.off) { it.off = false; it.auto = false; n++; } }
    else { it = { id: uid(), sceneId, cat: guessCat(t), text: t, auto: false, off: false }; p.breakdown.push(it); n++; }
    if (it.cat === 'props') addToLocations(p, sceneId, t, uid);
  }
  return n;
}

export function addToLocations(p, sceneId, t, uid) {
  for (const l of (p.locations || []).filter(q => q.sceneIds.includes(sceneId))) {
    if (!l.props.some(x => (x.sceneId === '' || x.sceneId === sceneId) && x.text.trim().toLowerCase() === t.toLowerCase())) l.props.push({ id: uid(), text: t, sceneId, ready: false });
  }
}

// Графа пункта в разборе сцены (для подписи в кадре); реквизит локации считается реквизитом.
export function catOf(p, sceneId, t) {
  const it = findItem(p, sceneId, t);
  if (it && !it.off) return it.cat;
  return locProps(p, sceneId).some(x => x.text.toLowerCase() === t.toLowerCase()) ? 'props' : '';
}

// Сменить графу пункта по кругу: реквизит -> костюм -> грим -> реквизит. Реквизит держим и в локации.
export function cycleCat(p, sceneId, t, uid) {
  let it = findItem(p, sceneId, t);
  if (!it) { it = { id: uid(), sceneId, cat: 'props', text: t, auto: false, off: false }; p.breakdown.push(it); }
  const order = ['props', 'costume', 'makeup'], i = order.indexOf(it.cat);
  it.cat = order[(i + 1) % order.length];
  it.off = false; it.auto = false;
  if (it.cat === 'props') addToLocations(p, sceneId, t, uid);
  else for (const l of (p.locations || []).filter(q => q.sceneIds.includes(sceneId))) {
    // из локации убираем только то, что пришло для этой сцены и ещё не отмечено готовым
    l.props = l.props.filter(x => !(x.sceneId === sceneId && !x.ready && x.text.trim().toLowerCase() === t.toLowerCase()));
  }
  return it.cat;
}

// Одна строка для печати: «Персонажи: … · Реквизит: …»
export const summaryLine = items => Object.entries(items).filter(([, v]) => v.length).map(([c, v]) => `${CATS[c]}: ${v.join(', ')}`).join(' · ');

// Название из шапки: «ДОМ БАТЫРА. КУХНЯ» -> «Дом Батыра. Кухня». С большой буквы начало части и имена героев.
export function placeName(p, place) {
  const names = [...new Set(p.script.blocks.filter(b => b.type === 'character').map(b => cleanName(b.text)))].filter(n => n.length > 2 && !/\s/.test(n));
  return String(place || '').toLowerCase().split(/(\s+|\.\s*|\/)/).map((w, i, a) => {
    const prev = a.slice(0, i).join('').trim();
    const name = names.some(n => w.toUpperCase().startsWith(n.slice(0, Math.max(3, n.length - 1))));
    return (!prev || /[./]$/.test(prev) || name) && w ? w[0].toUpperCase() + w.slice(1) : w;
  }).join('').trim() || 'Новая локация';
}

// Новая локация по разбору сцены: к ней привязываются все сцены с тем же местом в шапке,
// а реквизит (и спецэффекты с животными, которые готовит площадка) из их разбора становится реквизитом этих сцен.
export function locationFromScene(p, sceneId, uid) {
  const info = sceneInfo(p), s = info.find(x => x.id === sceneId);
  if (!s) return null;
  const key = t => String(t || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const same = info.filter(x => x.id === sceneId || (s.place && key(x.place) === key(s.place) && !(p.locations || []).some(l => l.sceneIds.includes(x.id))));
  const l = { id: 'loc-' + uid(), name: placeName(p, s.place || s.text), geo: '', note: '', photos: [], sceneIds: same.map(x => x.id), props: [] };
  for (const x of same) {
    for (const it of (p.breakdown || []).filter(i => i.sceneId === x.id && !i.off && ['props', 'sfx', 'animals'].includes(i.cat))) {
      if (!l.props.some(q => q.sceneId === x.id && q.text.toLowerCase() === it.text.toLowerCase())) l.props.push({ id: uid(), text: it.text, sceneId: x.id, ready: false });
    }
  }
  // планы этих сцен, ещё не привязанные к локации, переходят к ней
  for (const pl of p.plans) if (!pl.locationId && l.sceneIds.includes(pl.sceneId)) pl.locationId = l.id;
  p.locations.push(l);
  return l;
}
