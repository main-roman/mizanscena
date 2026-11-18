// Открытый проект в памяти, автосохранение и общие мелочи для всех экранов.
import { storage, blobToData } from './storage.js';
import { FURN, LIGHTS, esc } from './shapes.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const uid = () => Math.random().toString(36).slice(2, 8);
export const reduced = matchMedia('(prefers-reduced-motion: reduce)');
export { esc };

export const SIZES = ['Деталь', 'Крупный', 'Средний по пояс', 'Средний по колено', 'Общий', 'Дальний'];
export const MOVES = ['Статика', 'Панорама', 'Наезд или отъезд', 'Тележка', 'Стедикам', 'С рук', 'Кран', 'Слайдер', 'Пролёт'];

export function normalizePlan(s) {
  s.id = s.id || 'plan-' + uid();
  s.name = s.name || 'Без названия';
  s.note = s.note || '';
  s.sceneId = s.sceneId || '';
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
  for (const b of p.script.blocks) { b.type = b.type || 'action'; b.text = b.text || ''; if (b.type === 'scene' && !b.id) b.id = 'sc-' + uid(); }
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
    s.size = s.size || SIZES[2];
    s.move = s.move || MOVES[0];
  }
  return p;
}

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
  const camera = plan.objects.find(o => o.id === shot.cameraId) || null;
  const lights = plan.objects.filter(o => o.type === 'light' && !o.off).map(o => {
    const kind = (LIGHTS[o.kind] || {}).name || 'Свет';
    return o.label ? `${o.label} (${kind.toLowerCase()})` : kind;
  });
  const chars = plan.objects.filter(o => o.type === 'character' && o.name).map(o => o.name);
  return { plan, camera, lens: camera ? `${camera.lens} мм` : '', lights, chars };
}

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
    try { localStorage.setItem('miz:last', id); } catch { /* не страшно */ }
    if (before !== this.last) this.touch(); else this.onStatus('');
    return p;
  },

  close() { this.project = null; },

  touch() {
    this.onStatus('Сохраняю…');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 500);
  },

  async flush() {
    if (this.timer) { clearTimeout(this.timer); await this.save(); }
  },

  async save() {
    this.timer = 0;
    const p = this.project;
    if (!p) return;
    const s = JSON.stringify(p);
    // запоминаем отправленное, чтобы не принять собственное сохранение за правку файла снаружи
    this.sent.push(s);
    if (this.sent.length > 8) this.sent.shift();
    this.last = s;
    try {
      await storage.put(p);
      this.onStatus(storage.mode === 'server' ? 'Сохранено' : 'Сохранено в этом браузере');
    } catch {
      this.onStatus('Не сохранено: сервер не отвечает', true);
    }
  },

  watch() {
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
        this.project = p;
        this.last = s;
        this.onRemote(p);
        if (before !== s) this.touch();
      } catch { /* файл ещё пишется, придёт следующее событие */ }
    });
  },
};

export async function createProject(data) {
  const p = normalizeProject(data || { name: 'Новый проект' });
  p.id = 'p-' + Date.now().toString(36);
  p.created = new Date().toISOString();
  await storage.put(p);
  return p.id;
}

// ---------- файл проекта: всё в одном, вместе с картинками ----------

function eachImage(p, fn) {
  for (const plan of p.plans) for (const o of plan.objects) if (o.type === 'image') fn(o, 'src');
  for (const s of p.shots) if (s.frame) fn(s, 'frame');
}

export async function exportProjectFile(p) {
  const copy = JSON.parse(JSON.stringify(p));
  delete copy.id;
  const jobs = [];
  eachImage(copy, (o, key) => {
    if (!String(o[key]).startsWith('/assets/')) return;
    jobs.push(fetch(o[key]).then(r => r.blob()).then(blobToData).then(d => { o[key] = d; }).catch(() => {}));
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
export async function storeImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
  const src = await storage.putAsset(`img-${Date.now().toString(36)}${uid()}.jpg`, blob);
  return { src, ratio: c.height / c.width };
}

export function pickFile(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
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
