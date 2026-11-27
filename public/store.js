// Открытый проект в памяти, автосохранение и общие мелочи для всех экранов.
import { storage, blobToData, srcOf } from './storage.js';
import { cloud, isCloud, merge } from './cloud.js';
import { FURN, LIGHTS, esc } from './shapes.js';
import { atPhase } from './shapes.js';
import { normalizeBreakdown } from './breakdown.js';
import { normalizeSchedule } from './schedmodel.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const uid = () => Math.random().toString(36).slice(2, 8);
export const reduced = matchMedia('(prefers-reduced-motion: reduce)');
export { esc };

// картинки раскадровки кадра и их правка
export const framesOf = s => Array.isArray(s.frames) && s.frames.length ? s.frames : (s.frame ? [s.frame] : []);
export function setFrames(s, list) { s.frames = list.filter(Boolean); s.frame = s.frames[0] || ''; }
export async function addFrameFiles(s, files, max = 1600) {
  let n = 0;
  for (const f of files) { try { setFrames(s, [...framesOf(s), (await storeImage(f, max)).src]); n++; } catch { /* битая картинка — пропускаем */ } }
  return n;
}
export const SIZES = ['Деталь', 'Крупный', 'Первый средний', 'Второй средний', 'Третий средний', 'Общий', 'Дальний'];
// прежние названия средних планов
const OLD_SIZES = { 'Средний по пояс': 'Первый средний', 'Средний по колено': 'Второй средний' };
export const MOVES = ['Статика', 'Панорама', 'Наезд или отъезд', 'Тележка', 'Стедикам', 'С рук', 'Кран', 'Слайдер', 'Пролёт'];

export function normalizePlan(s) {
  s.id = s.id || 'plan-' + uid();
  s.name = s.name || 'Без названия';
  s.note = s.note || '';
  s.sceneId = s.sceneId || '';
  s.locationId = s.locationId || '';
  s.objects = Array.isArray(s.objects) ? s.objects : [];
  for (const o of s.objects) {
    if (!o.id) o.id = uid();
    if (o.type === 'furniture') { const d = FURN[o.kind] || FURN.table; o.w ??= d.w; o.h ??= d.h; }
    if (o.type === 'light') { const d = LIGHTS[o.kind] || LIGHTS.fresnel; if (d.w) o.w ??= d.w; }
    if (o.type === 'door' || o.type === 'window') o.w ??= 0.9;
  }
  return s;
}

export function normalizeProject(p) {
  p.name = p.name || 'Без названия';
  p.script = p.script || {};
  p.script.blocks = Array.isArray(p.script.blocks) ? p.script.blocks : [];
  for (const b of p.script.blocks) { b.type = b.type || 'action'; b.text = b.text || ''; if (!b.id) b.id = (b.type === 'scene' ? 'sc-' : 'b-') + uid(); }
  p.plans = Array.isArray(p.plans) ? p.plans : [];
  p.shots = Array.isArray(p.shots) ? p.shots : [];
  // старый формат: кадры лежали внутри плана
  for (const plan of p.plans) {
    normalizePlan(plan);
    if (Array.isArray(plan.shots)) {
      for (const s of plan.shots) p.shots.push({ ...s, planId: plan.id, content: s.content || s.desc || '' });
      delete plan.shots;
    }
  }
  for (const s of p.shots) {
    s.id = s.id || uid();
    delete s.desc;
    for (const k of ['sceneId', 'planId', 'cameraId', 'phaseId', 'content', 'note', 'mode', 'dur', 'chars', 'props', 'tech', 'frame']) s[k] = s[k] || '';
    // крупность и движение могут быть пустыми: их не подставляем наугад
    s.size = typeof s.size === 'string' ? (OLD_SIZES[s.size] || s.size) : '';
    s.move = typeof s.move === 'string' ? s.move : '';
    // несколько картинок раскадровки (панорама в несколько кадриков); frame — всегда первая
    if (!Array.isArray(s.frames)) s.frames = s.frame ? [s.frame] : [];
    s.frames = s.frames.filter(x => typeof x === 'string' && x);
    s.frame = s.frames[0] || '';
  }
  p.locations = Array.isArray(p.locations) ? p.locations : [];
  for (const l of p.locations) normalizeLocation(l);
  normalizeBreakdown(p, uid);
  normalizeSchedule(p, uid);
  return p;
}

// Локация: фото, адрес или ссылка на карту, сцены сценария и постановочный реквизит (общий и по сценам).
// Локация = объект (дом, стадион; у объекта один адрес) и подобъект (гостиная, кухня).
// Полное название «Объект. Подобъект» хранится и в name — им пользуются остальные разделы.
// Старые локации делятся по первой точке: «Дом Батыра. Гостиная» -> «Дом Батыра» + «Гостиная».
export function splitPlace(text) {
  const t = String(text || '').trim(), i = t.indexOf('.');
  if (i < 0) return { object: t, sub: '' };
  return { object: t.slice(0, i).trim(), sub: t.slice(i + 1).replace(/^[\s.]+/, '').trim() };
}
export const locName = l => [l.object, l.sub].filter(Boolean).join('. ') || 'Новая локация';
export const objKey = name => String(name || '').toUpperCase().replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim();
// адрес у всех подобъектов одного объекта общий
export function setObjectGeo(p, l, geo) {
  for (const x of p.locations) if (objKey(x.object) === objKey(l.object)) x.geo = geo;
}
// база группы, парковка и примечание для группы — тоже одни на объект
export function setObjectField(p, l, key, value) {
  for (const x of p.locations) if (objKey(x.object) === objKey(l.object)) x[key] = value;
}
export const setObjectBase = (p, l, base) => setObjectField(p, l, 'base', base);
// объекты проекта: [{ key, name, geo, base, locs }] в порядке первого появления
export function objectsOf(p) {
  const map = new Map();
  for (const l of p.locations) {
    const k = objKey(l.object);
    if (!map.has(k)) map.set(k, { key: k, name: l.object || 'Без объекта', geo: '', locs: [] });
    const o = map.get(k);
    o.locs.push(l);
    if (!o.geo && l.geo) o.geo = l.geo;
    if (!o.base && l.base) o.base = l.base;
  }
  return [...map.values()];
}

export function normalizeLocation(l) {
  l.id = l.id || 'loc-' + uid();
  if (typeof l.object !== 'string') { const s = splitPlace(l.name || 'Новая локация'); l.object = s.object; l.sub = s.sub; }
  l.sub = typeof l.sub === 'string' ? l.sub : '';
  l.name = locName(l);
  l.geo = l.geo || '';
  l.base = l.base || ''; // база группы, парковка — общая для объекта
  l.hint = l.hint || ''; // примечание для группы в вызывном: вход, ключи, тишина — общее для объекта
  l.note = l.note || '';
  l.photos = Array.isArray(l.photos) ? l.photos.filter(x => x && x.src) : [];
  for (const ph of l.photos) { ph.id = ph.id || uid(); ph.name = ph.name || ''; }
  l.sceneIds = Array.isArray(l.sceneIds) ? l.sceneIds : [];
  l.props = Array.isArray(l.props) ? l.props : [];
  for (const x of l.props) { x.id = x.id || uid(); x.text = x.text || ''; x.sceneId = x.sceneId || ''; x.ready = !!x.ready; }
  return l;
}

// Обложка облачного проекта для главного экрана: облако отдаёт только название, поэтому первый план
// запоминаем на этом устройстве, когда проект открывали.
export function rememberCover(p) {
  if (!isCloud(p.id)) return;
  try {
    const pl = p.plans[0];
    if (pl) localStorage.setItem('miz:cover:' + p.id, JSON.stringify({ ...pl, objects: pl.objects.filter(o => o.type !== 'image') }));
    else localStorage.removeItem('miz:cover:' + p.id);
  } catch { /* место в браузере кончилось — обойдёмся облаком */ }
}
export function coverOf(id) { try { return JSON.parse(localStorage.getItem('miz:cover:' + id) || 'null'); } catch { return null; } }

export const scenesOf = p => p.script.blocks.filter(b => b.type === 'scene');

// Номера кадров вида «сцена.кадр» в порядке режиссёрского сценария; кадры без сцены получают сцену 0.
export function numbering(p) {
  const scenes = scenesOf(p), count = {}, map = new Map();
  for (const s of p.shots) {
    const i = scenes.findIndex(x => x.id === s.sceneId) + 1;
    count[i] = (count[i] || 0) + 1;
    map.set(s.id, `${i}.${count[i]}`);
  }
  return map;
}

// Что подтягивается в кадр из плана: объектив камеры, свет и персонажи.
export function shotAuto(p, shot) {
  const plan = p.plans.find(x => x.id === shot.planId);
  if (!plan) return { plan: null, camera: null, lens: '', lights: [], chars: [] };
  // объектив — тот, что у камеры в фазе этого кадра
  const camera = atPhase(plan, shot.phaseId || '').objects.find(o => o.id === shot.cameraId) || plan.objects.find(o => o.id === shot.cameraId) || null;
  const lights = plan.objects.filter(o => o.type === 'light' && !o.off).map(o => {
    const kind = (LIGHTS[o.kind] || {}).name || 'Свет';
    return o.label ? `${o.label} (${kind.toLowerCase()})` : kind;
  });
  const chars = plan.objects.filter(o => o.type === 'character' && o.name).map(o => o.name);
  return { plan, camera, lens: shot.lens || (camera ? `${camera.lens} мм` : ''), lights, chars };
}

// снимок для отмены: порядок полей не важен, важна суть
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x);

export const store = {
  project: null,
  last: '',
  sent: [],
  timer: 0,
  onStatus: () => {},
  onRemote: () => {},
  onList: () => {},

  async open(id) {
    await this.flush();
    const raw = await storage.get(id);
    const before = JSON.stringify(raw);
    const p = normalizeProject(raw);
    p.id = id;
    this.project = p;
    this.last = JSON.stringify(p);
    this.resetHistory();
    try { localStorage.setItem('miz:last', id); } catch { /* не страшно */ }
    rememberCover(p);
    if (before !== this.last) this.touch(); else this.onStatus('');
    return p;
  },

  close() { this.project = null; },

  // ---------- отмена и возврат (Ctrl+Z, Ctrl+Y) ----------
  // Шаг отмены — пара снимков «до» и «после» моей правки; правки подряд без паузы (набор текста, перетаскивание) —
  // один шаг. Отмена откатывает только эту разницу, трёхсторонним объединением с тем, что в проекте сейчас:
  // правки соавторов, пришедшие после моей, остаются на месте.
  resetHistory() { this.undos = []; this.redos = []; this.base = this.project ? canon(this.project) : ''; this.pending = false; clearTimeout(this.histTimer); },
  settle() {
    clearTimeout(this.histTimer);
    if (!this.pending || !this.project) return;
    this.pending = false;
    const now = canon(this.project);
    if (now === this.base) return; // то же содержимое (пусть и в другом порядке полей) — не шаг
    this.undos.push({ before: this.base, after: now });
    if (this.undos.length > 60) this.undos.shift();
    this.redos = [];
    this.base = now;
  },
  restore(json) {
    const id = this.project.id, p = normalizeProject(JSON.parse(json));
    p.id = id;
    this.project = p;
    this.base = canon(p);
    this.onStatus('Сохраняю…');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 300);
  },
  // правку соавтора (облако) принимаем как новое исходное состояние: она не входит в мои шаги отмены
  rebase(json) {
    if (!this.undos) return;
    this.settle();
    this.base = json;
  },
  // локальный проект изменили снаружи (ИИ-помощник, другое окно): это тоже можно отменить
  remember(json) {
    if (!this.undos) return;
    this.settle();
    if (this.base && this.base !== json) { this.undos.push({ before: this.base, after: json }); if (this.undos.length > 60) this.undos.shift(); this.redos = []; }
    this.base = json;
  },
  // применить разницу между двумя снимками к тому, что в проекте сейчас
  apply(from, to) {
    const cur = JSON.parse(canon(this.project));
    this.restore(canon(merge(JSON.parse(from), JSON.parse(to), cur)));
  },
  undo() {
    if (!this.project) return false;
    this.settle();
    if (!this.undos || !this.undos.length) return false;
    const e = this.undos.pop();
    this.redos.push(e);
    this.apply(e.after, e.before);
    return true;
  },
  redo() {
    if (!this.project) return false;
    this.settle();
    if (!this.redos || !this.redos.length) return false;
    const e = this.redos.pop();
    this.undos.push(e);
    this.apply(e.before, e.after);
    return true;
  },

  touch() {
    if (this.project && this.undos) { this.pending = true; clearTimeout(this.histTimer); this.histTimer = setTimeout(() => this.settle(), 700); }
    this.onStatus('Сохраняю…');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 500);
  },

  async flush() {
    if (this.timer) { clearTimeout(this.timer); await this.save(); }
  },

  // сохранения идут строго по очереди, иначе облако приняло бы второе за конфликт с первым
  save() {
    this.timer = 0;
    this.saving = (this.saving || Promise.resolve()).then(() => this.saveNow()).catch(() => {});
    return this.saving;
  },

  async saveNow() {
    const p = this.project;
    if (!p) return;
    const s = JSON.stringify(p);
    if (isCloud(p.id) && cloud.role(p.id) === 'viewer') { this.last = s; this.onStatus('Только просмотр: правки не сохраняются'); return; }
    // запоминаем отправленное, чтобы не принять собственное сохранение за правку файла снаружи
    this.sent.push(s);
    if (this.sent.length > 8) this.sent.shift();
    this.last = s;
    try {
      const merged = await storage.put(p);
      // объединение бывает только у облачных проектов; всё, что не похоже на проект, игнорируем
      if (isCloud(p.id) && merged && typeof merged === 'object' && merged.script && Array.isArray(merged.plans) && this.project === p) {
        // пока сохраняли, проект правил кто-то ещё: берём объединённую версию, не теряя того, что я успел сделать за это время
        const mineNow = JSON.parse(JSON.stringify(p));
        const next = normalizeProject(same(mineNow, JSON.parse(s)) ? merged : merge(JSON.parse(s), mineNow, merged));
        next.id = p.id;
        this.project = next;
        this.last = JSON.stringify(next);
        this.base = canon(next); // отмена дальше идёт от объединённой версии
        this.onRemote(next, 'merge');
        if (this.last !== JSON.stringify(merged)) this.touch();
      }
      rememberCover(p);
      this.onStatus(isCloud(p.id) ? 'Сохранено в облаке' : storage.mode === 'server' ? 'Сохранено' : 'Сохранено в этом браузере');
    } catch (e) {
      if (isCloud(p.id)) {
        this.onStatus(e.code === 403 ? 'Нет доступа к проекту' : 'Не сохранено: нет связи с облаком, пробую снова', true);
        if (e.code !== 403 && !this.timer && this.project === p) this.timer = setTimeout(() => this.save(), 5000);
      } else this.onStatus('Не сохранено: сервер не отвечает', true);
    }
  },

  // Облачный проект: раз в несколько секунд спрашиваем, не изменил ли его кто-то, и показываем свежую версию.
  // Если у меня есть несохранённые правки, ничего не трогаем: при сохранении правки объединятся.
  async pollCloud() {
    const p = this.project;
    if (!p || !isCloud(p.id) || document.hidden || this.polling) return;
    this.polling = true;
    try {
      const v = await cloud.ver(p.id);
      if (v <= cloud.version(p.id) || this.timer || this.project !== p) return;
      await this.saving;
      const r = await cloud.peek(p.id);
      if (this.timer || this.project !== p || JSON.stringify(p) !== this.last || r.version <= cloud.version(p.id)) return;
      cloud.accept(p.id, r.data, r.version);
      const next = normalizeProject(r.data);
      next.id = p.id;
      this.rebase(canon(next));
      this.project = next;
      this.last = JSON.stringify(next);
      this.onRemote(next, 'cloud');
    } catch { /* нет связи: попробуем в следующий раз */ }
    finally { this.polling = false; }
  },

  watch() {
    setInterval(() => this.pollCloud(), 4000);
    storage.watch(async ({ id }) => {
      if (!this.project || id !== this.project.id) { this.onList(); return; }
      if (this.timer) return;
      try {
        const raw = await storage.get(id);
        const before = JSON.stringify(raw);
        const p = normalizeProject(raw);
        p.id = id;
        const s = JSON.stringify(p);
        if (s === this.last || this.sent.includes(s) || JSON.stringify(this.project) !== this.last) return;
        // в файле то же, что открыто (это наше же сохранение, поля просто в другом порядке) — не правка снаружи
        // (и с полями по умолчанию, которые дописывает сохранение)
        const mine = normalizeProject(JSON.parse(JSON.stringify(this.project)));
        mine.id = id;
        if (canon(p) === canon(this.project) || canon(p) === canon(mine)) return;
        this.remember(canon(p)); // правку снаружи (ИИ-помощник, другое окно) тоже можно отменить Ctrl+Z
        this.project = p;
        this.last = s;
        this.onRemote(p);
        if (before !== s) this.touch();
      } catch { /* файл ещё пишется, придёт следующее событие */ }
    });
  },
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function createProject(data, inCloud = false) {
  const p = normalizeProject(data || { name: 'Новый проект' });
  p.created = p.created || new Date().toISOString();
  if (inCloud) return cloud.create(p);
  p.id = 'p-' + Date.now().toString(36);
  await storage.put(p);
  return p.id;
}

// Копия локального проекта в облаке: картинки загружаются туда же. Локальный проект остаётся как был.
export async function copyToCloud(p) {
  const copy = normalizeProject(JSON.parse(JSON.stringify(p)));
  delete copy.id;
  const imgs = [];
  eachImage(copy, (o, key) => { if (o[key] && !String(o[key]).startsWith('cloud:')) imgs.push([o, key]); });
  // id проекта нужен для загрузки картинок, поэтому сначала создаём проект, потом кладём картинки и сохраняем ещё раз.
  // Создаём сразу со всем текстом (сценарий, кадры, планы, локации): если загрузка картинок или последнее
  // сохранение оборвётся, в облаке останется полный проект, а не одна группа.
  const id = await cloud.create(copy);
  if (!imgs.length) return id;
  for (const [o, key] of imgs) {
    try { o[key] = await cloud.upload(id, await (await fetch(o[key])).blob()); } catch { /* картинку пропустим, проект важнее */ }
  }
  await cloud.get(id);
  copy.id = id;
  for (const s of copy.shots) if (Array.isArray(s.frames)) s.frame = s.frames[0] || '';
  await cloud.put(copy);
  return id;
}

// ---------- файл проекта: всё в одном, вместе с картинками ----------

function eachImage(p, fn) {
  for (const plan of p.plans) for (const o of plan.objects) if (o.type === 'image') fn(o, 'src');
  for (const s of p.shots) {
    // все картинки раскадровки кадра; первая — она же frame
    if (Array.isArray(s.frames) && s.frames.length) { s.frames.forEach((x, k) => fn(s.frames, k)); s.frame = s.frames[0]; }
    else if (s.frame) fn(s, 'frame');
  }
  for (const l of p.locations || []) for (const ph of l.photos || []) fn(ph, 'src');
}

export async function exportProjectFile(p) {
  const copy = JSON.parse(JSON.stringify(p));
  delete copy.id;
  const jobs = [];
  eachImage(copy, (o, key) => {
    if (!/^(\/assets\/|cloud:)/.test(String(o[key]))) return;
    jobs.push(fetch(srcOf(o[key])).then(r => r.blob()).then(blobToData).then(d => { o[key] = d; }).catch(() => {}));
  });
  await Promise.all(jobs);
  download(new Blob([JSON.stringify({ format: 'mizanscena-project', version: 1, project: copy })], { type: 'application/json' }), safeName(p.name) + '.mizproj');
}

export async function importProjectFile(file) {
  const data = JSON.parse(await file.text());
  const p = data.format === 'mizanscena-project' ? data.project : data;
  if (!p || typeof p !== 'object' || (!p.plans && !p.script && !p.objects)) throw new Error('bad file');
  // файл одной сцены из первой версии приложения тоже открываем: он становится проектом с одним планом
  const project = p.objects ? { name: p.name, plans: [p] } : p;
  normalizeProject(project);
  if (storage.mode === 'server') {
    const jobs = [];
    eachImage(project, (o, key) => {
      if (!String(o[key]).startsWith('data:image')) return;
      jobs.push(fetch(o[key]).then(r => r.blob()).then(b => storage.putAsset(`img-${Date.now().toString(36)}${uid()}.jpg`, b)).then(src => { o[key] = src; }));
    });
    await Promise.all(jobs);
  }
  return createProject(project);
}

// ---------- мелочи ----------

// Переход без следа в истории: после удаления страница удалённого не должна попадаться по «Назад».
export function replaceHash(h) { store.replacing = true; location.replace(h); }

export const safeName = name => String(name).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'proekt';

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

let toastTimer = 0;
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

// Уменьшает выбранную картинку и кладёт её в хранилище; возвращает адрес и пропорции.
export async function storeImage(file, max = 1800) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    // некоторые сборки не умеют createImageBitmap для части форматов — открываем через <img>
    const url = URL.createObjectURL(file);
    try { bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; }); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
  const src = await storage.putAsset(`img-${Date.now().toString(36)}${uid()}.jpg`, blob, store.project && store.project.id);
  return { src, ratio: c.height / c.width };
}

export function pickFile(accept, many = false) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = many;
    input.onchange = () => resolve(many ? [...input.files] : input.files[0] || null);
    input.click();
  });
}

// Печать: содержимое кладётся в отдельный блок, остальная страница на бумагу не попадает.
export async function printHTML(html, pageCss = '', name = 'Мизансцена') {
  $('#print').innerHTML = `<style>@media print { @page { ${pageCss} } }</style>${html}`;
  await new Promise(r => setTimeout(r, 150)); // картинки внутри успевают загрузиться
  // в программе PDF сохраняется сразу файлом, без окна печати; в браузере остаётся печать
  if (window.mizDesktop && window.mizDesktop.savePDF) {
    try {
      const saved = await window.mizDesktop.savePDF(name);
      if (saved) toast('PDF сохранён: ' + saved);
    } catch { toast('Не получилось сохранить PDF'); }
    return;
  }
  print();
}
