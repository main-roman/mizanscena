// MCP-сервер Мизансцены: через него любой ИИ-помощник (Claude, Cursor и другие клиенты MCP) читает и правит проекты.
// Работает внутри программы по адресу http://localhost:<порт>/mcp (Streamable HTTP, ответы обычным JSON).
// Для клиентов, которые умеют только stdio (Claude Desktop), есть мост mcp-stdio.js.
// Видны локальные проекты из папки projects и облачные, если в программе выполнен вход.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
let ctx = null;          // { PROJECTS, DATA, writeAtomic, version }
let lib = null;          // каталоги и объединение правок из public/ (ES-модули)
let session = null;      // пропуск в облако, его передаёт открытая программа

async function libs() {
  if (!lib) {
    const shapes = await import(pathToFileURL(path.join(__dirname, 'public', 'shapes.js')).href);
    const cloud = await import(pathToFileURL(path.join(__dirname, 'public', 'cloud.js')).href);
    const bd = await import(pathToFileURL(path.join(__dirname, 'public', 'breakdown.js')).href);
    const sm = await import(pathToFileURL(path.join(__dirname, 'public', 'schedmodel.js')).href);
    lib = { FURN: shapes.FURN, LIGHTS: shapes.LIGHTS, LOOKS: shapes.LOOKS, API: cloud.API, bd, sm };
  }
  return lib;
}

function init(c) {
  ctx = c;
  try { session = JSON.parse(fs.readFileSync(sessionFile(), 'utf8')); } catch { session = null; }
}
const sessionFile = () => path.join(ctx.DATA, '.cloud-session.json');
function setSession(s) {
  session = s && s.session ? { session: s.session, user: s.user || null } : null;
  try {
    if (session) ctx.writeAtomic(sessionFile(), JSON.stringify(session));
    else if (fs.existsSync(sessionFile())) fs.unlinkSync(sessionFile());
  } catch { /* не страшно: пропуск просто не запомнится до следующего запуска */ }
}

class UserError extends Error {}
const uid = () => crypto.randomBytes(4).toString('base64url').replace(/[-_]/g, 'x').slice(0, 6);
const isCloud = id => /^c-/.test(id);

// ---------- облако ----------
async function cloudCall(op, { qs = {}, body } = {}) {
  if (!session) throw new UserError('Облачные проекты недоступны: войдите в облако в программе Мизансцена (раздел «Облако» на экране проектов).');
  const { API } = await libs();
  const r = await fetch(API + '?' + new URLSearchParams({ op, ...qs }), {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Miz-Session': session.session, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new UserError('Облако: ' + (data.error || r.status));
  return data;
}

// ---------- проекты ----------
function localList() {
  const out = [];
  for (const f of fs.readdirSync(ctx.PROJECTS)) {
    if (!f.endsWith('.json')) continue;
    try {
      const file = path.join(ctx.PROJECTS, f), p = JSON.parse(fs.readFileSync(file, 'utf8'));
      out.push({ id: f.slice(0, -5), name: p.name || f.slice(0, -5), where: 'на компьютере', updated: new Date(fs.statSync(file).mtimeMs).toISOString() });
    } catch { /* битый файл пропускаем */ }
  }
  return out;
}
async function allProjects() {
  const list = localList();
  let cloudNote = '';
  if (session) {
    try {
      const r = await cloudCall('list');
      for (const p of r.projects) list.push({ id: p.id, name: p.name, where: 'в облаке', role: p.role, updated: p.updated ? new Date(p.updated).toISOString() : '' });
    } catch (e) { cloudNote = e.message; }
  } else cloudNote = 'Вход в облако не выполнен, облачные проекты не показаны.';
  return { list, cloudNote };
}

// Проект можно назвать id или названием (без учёта регистра, достаточно части названия, если она однозначна).
async function resolve(ref) {
  ref = String(ref || '').trim();
  if (!ref) throw new UserError('Укажите проект: id или название.');
  if (isCloud(ref) || fs.existsSync(path.join(ctx.PROJECTS, ref + '.json'))) return ref;
  const { list } = await allProjects();
  const low = ref.toLowerCase();
  const exact = list.filter(p => p.name.toLowerCase() === low);
  const part = exact.length ? exact : list.filter(p => p.name.toLowerCase().includes(low));
  if (part.length === 1) return part[0].id;
  if (!part.length) throw new UserError(`Проект «${ref}» не найден. Есть: ${list.map(p => `«${p.name}» (${p.id})`).join(', ') || 'проектов нет'}.`);
  throw new UserError(`Под «${ref}» подходит несколько проектов: ${part.map(p => `«${p.name}» (${p.id}, ${p.where})`).join(', ')}. Укажите id.`);
}

async function load(id) {
  if (isCloud(id)) { const r = await cloudCall('get', { qs: { id } }); return { data: r.data, version: r.version, role: r.role }; }
  const file = path.join(ctx.PROJECTS, id + '.json');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !fs.existsSync(file)) throw new UserError('Проект не найден: ' + id);
  return { data: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

// Правка проекта: читаем, меняем, сохраняем. Если облачный проект за это время изменил кто-то другой,
// правка повторяется на свежей версии, поэтому ничьи изменения не теряются. Открытая программа покажет результат сама.
async function edit(ref, fn) {
  const id = await resolve(ref);
  for (let i = 0; i < 5; i++) {
    const cur = await load(id);
    if (cur.role === 'viewer') throw new UserError('У вас доступ к этому проекту только для просмотра.');
    const p = normalize(cur.data);
    const result = await fn(p);
    if (isCloud(id)) {
      const r = await cloudCall('put', { body: { id, baseVersion: cur.version, data: p } });
      if (r.conflict) continue;
    } else {
      p.id = id;
      ctx.writeAtomic(path.join(ctx.PROJECTS, id + '.json'), JSON.stringify(p, null, 2));
    }
    return result;
  }
  throw new UserError('Проект всё время меняется другими участниками, попробуйте ещё раз.');
}

function normalize(p) {
  p.name = p.name || 'Без названия';
  p.script = p.script || {};
  p.script.blocks = Array.isArray(p.script.blocks) ? p.script.blocks : [];
  for (const b of p.script.blocks) { b.type = b.type || 'action'; b.text = b.text || ''; if (!b.id) b.id = (b.type === 'scene' ? 'sc-' : 'b-') + uid(); }
  p.plans = Array.isArray(p.plans) ? p.plans : [];
  for (const pl of p.plans) { pl.objects = Array.isArray(pl.objects) ? pl.objects : []; for (const o of pl.objects) if (!o.id) o.id = uid(); }
  p.shots = Array.isArray(p.shots) ? p.shots : [];
  for (const s of p.shots) if (!s.id) s.id = uid();
  return p;
}

const scenes = p => p.script.blocks.filter(b => b.type === 'scene');
function findPlan(p, ref) {
  const r = String(ref || '').trim().toLowerCase();
  const pl = p.plans.find(x => x.id === ref) || p.plans.find(x => x.name.toLowerCase() === r) || (r && p.plans.filter(x => x.name.toLowerCase().includes(r)).length === 1 && p.plans.find(x => x.name.toLowerCase().includes(r)));
  if (!pl) throw new UserError(`План «${ref}» не найден. Планы проекта: ${p.plans.map(x => `«${x.name}» (${x.id})`).join(', ') || 'нет'}.`);
  return pl;
}
function shotNumbers(p) {
  const sc = scenes(p), count = {}, map = new Map();
  for (const s of p.shots) { const i = sc.findIndex(x => x.id === s.sceneId) + 1; count[i] = (count[i] || 0) + 1; map.set(s.id, `${i}.${count[i]}`); }
  return map;
}

// ---------- объекты плана ----------
const TYPES = ['wall', 'door', 'window', 'furniture', 'character', 'camera', 'light', 'text', 'stroke', 'image'];
const PHASED = o => 'x' in o && !['door', 'window', 'image', 'text'].includes(o.type);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

async function cleanObject(o, plan) {
  const { FURN, LIGHTS, LOOKS } = await libs();
  if (!o || typeof o !== 'object') throw new UserError('Объект должен быть JSON-объектом.');
  if (!TYPES.includes(o.type)) throw new UserError(`Неизвестный тип «${o.type}». Типы: ${TYPES.join(', ')}.`);
  if (o.type === 'furniture') {
    if (!FURN[o.kind]) throw new UserError(`Неизвестный вид декорации «${o.kind}». Виды: ${Object.keys(FURN).join(', ')}.`);
    o.w = num(o.w) ?? FURN[o.kind].w; o.h = num(o.h) ?? FURN[o.kind].h;
  }
  if (o.type === 'light') {
    if (!LIGHTS[o.kind]) throw new UserError(`Неизвестный прибор «${o.kind}». Приборы: ${Object.keys(LIGHTS).join(', ')}.`);
    if (LIGHTS[o.kind].w && num(o.w) === undefined) o.w = LIGHTS[o.kind].w;
  }
  if (o.type === 'character' && o.look && !LOOKS[o.look]) throw new UserError(`Неизвестный типаж «${o.look}». Типажи: ${Object.keys(LOOKS).join(', ')}.`);
  if (o.type === 'camera') { o.lens = num(o.lens) ?? 35; o.sensor = o.sensor || 's35'; o.name = o.name || String.fromCharCode(65 + plan.objects.filter(x => x.type === 'camera').length); }
  if ((o.type === 'door' || o.type === 'window') && num(o.w) === undefined) o.w = 0.9;
  if (o.type === 'wall') { for (const k of ['x1', 'y1', 'x2', 'y2']) if (num(o[k]) === undefined) throw new UserError('У стены нужны числа x1, y1, x2, y2.'); o.thickness = num(o.thickness) ?? 0.15; }
  else if (o.type !== 'stroke' && (num(o.x) === undefined || num(o.y) === undefined)) throw new UserError(`У объекта ${o.type} нужны координаты x и y (метры).`);
  if (o.type !== 'wall' && o.type !== 'stroke') o.rot = num(o.rot) ?? 0;
  o.id = o.id && !plan.objects.some(x => x.id === o.id) ? String(o.id) : uid();
  return o;
}

// позиции объектов в текущей фазе дублируются в plan.phases[phase].pos, как это делает программа
function syncPhase(plan) {
  if (!Array.isArray(plan.phases) || !plan.phases.length) return;
  const i = Math.min(plan.phases.length - 1, Math.max(0, plan.phase | 0));
  const pos = {};
  for (const o of plan.objects) if (PHASED(o)) pos[o.id] = { x: o.x, y: o.y, rot: o.rot || 0 };
  plan.phases[i].pos = pos;
}

// ---------- инструменты ----------
const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const P = { type: 'string', description: 'Проект: id (например p-ptichka или c-AbC123) или название.' };
const PL = { type: 'string', description: 'План (Shot Designer): id или название.' };

const TOOLS = [
  {
    name: 'list_projects', title: 'Список проектов',
    description: 'Все проекты Мизансцены: на этом компьютере и в облаке (если в программе выполнен вход).',
    inputSchema: S({}), annotations: { readOnlyHint: true },
    run: async () => { const { list, cloudNote } = await allProjects(); return { projects: list, ...(cloudNote ? { note: cloudNote } : {}) }; },
  },
  {
    name: 'get_project', title: 'Обзор проекта',
    description: 'Обзор проекта: сцены сценария, планы Shot Designer с числом объектов и фаз, число кадров режиссёрского сценария.',
    inputSchema: S({ project: P }, ['project']), annotations: { readOnlyHint: true },
    run: async ({ project }) => {
      const id = await resolve(project), { data, role } = await load(id), p = normalize(data);
      const sc = scenes(p);
      return {
        id, name: p.name, where: isCloud(id) ? 'в облаке' : 'на компьютере', ...(role ? { role } : {}),
        scenes: sc.map((s, i) => ({ n: i + 1, id: s.id, heading: s.text })),
        plans: p.plans.map(pl => ({ id: pl.id, name: pl.name, scene: (sc.findIndex(s => s.id === pl.sceneId) + 1) || null, objects: pl.objects.length, phases: (pl.phases || []).length || 1 })),
        shots: p.shots.length, screenplayBlocks: p.script.blocks.length,
      };
    },
  },
  {
    name: 'create_project', title: 'Новый проект',
    description: 'Создаёт пустой проект. cloud: true кладёт его в облако (нужен вход в программе), иначе на этот компьютер.',
    inputSchema: S({ name: { type: 'string' }, cloud: { type: 'boolean' } }, ['name']),
    run: async ({ name, cloud }) => {
      const p = { name: String(name), script: { blocks: [] }, plans: [], shots: [], created: new Date().toISOString() };
      if (cloud) return { id: (await cloudCall('create', { body: { data: p } })).id, where: 'в облаке' };
      const id = 'p-' + Date.now().toString(36);
      p.id = id;
      ctx.writeAtomic(path.join(ctx.PROJECTS, id + '.json'), JSON.stringify(p, null, 2));
      return { id, where: 'на компьютере' };
    },
  },
  {
    name: 'get_screenplay', title: 'Сценарий',
    description: 'Сценарий проекта блоками {id, type, text}. type: scene (заголовок сцены), action, character, paren (ремарка), dialogue, transition, title, note.',
    inputSchema: S({ project: P, scene: { type: 'integer', description: 'Необязательно: номер сцены, чтобы получить только её.' } }, ['project']), annotations: { readOnlyHint: true },
    run: async ({ project, scene }) => {
      const id = await resolve(project), p = normalize((await load(id)).data);
      let blocks = p.script.blocks;
      if (scene) {
        const idx = blocks.map((b, i) => (b.type === 'scene' ? i : -1)).filter(i => i >= 0);
        const start = idx[scene - 1];
        if (start === undefined) throw new UserError(`В сценарии ${idx.length} сцен.`);
        blocks = blocks.slice(start, idx[scene] ?? blocks.length);
      }
      return { blocks: blocks.map(b => ({ id: b.id, type: b.type, text: b.text })) };
    },
  },
  {
    name: 'edit_screenplay', title: 'Править сценарий',
    description: 'Правка сценария по блокам. Операции: {op:"insert", after: id блока или null (в начало), blocks:[{type,text}]}, {op:"update", id, type?, text?}, {op:"delete", id}. ' +
      'Текст автора сценария без его просьбы не переписывай.',
    inputSchema: S({ project: P, ops: { type: 'array', items: { type: 'object' } } }, ['project', 'ops']),
    run: async ({ project, ops }) => edit(project, p => {
      const B = p.script.blocks, done = [];
      const KIND = ['scene', 'action', 'character', 'paren', 'dialogue', 'transition', 'title', 'note'];
      const at = id => { const i = B.findIndex(b => b.id === id); if (i < 0) throw new UserError('Нет блока ' + id); return i; };
      for (const o of ops || []) {
        if (o.op === 'insert') {
          let i = o.after == null ? 0 : at(o.after) + 1;
          for (const b of o.blocks || []) {
            const type = KIND.includes(b.type) ? b.type : 'action';
            const nb = { type, text: String(b.text || ''), id: (type === 'scene' ? 'sc-' : 'b-') + uid() };
            B.splice(i++, 0, nb); done.push(nb.id);
          }
        } else if (o.op === 'update') {
          const b = B[at(o.id)];
          if (o.type) { if (!KIND.includes(o.type)) throw new UserError('Неизвестный тип блока ' + o.type); b.type = o.type; }
          if (typeof o.text === 'string') b.text = o.text;
          done.push(b.id);
        } else if (o.op === 'delete') { B.splice(at(o.id), 1); done.push(o.id); }
        else throw new UserError('Неизвестная операция ' + o.op);
      }
      return { ok: true, blocks: done };
    }),
  },
  {
    name: 'get_plan', title: 'План Shot Designer',
    description: 'План сцены сверху целиком: объекты (стены, мебель, персонажи, камеры, свет), фазы движения и цвета. Координаты в метрах, X вправо, Y вниз, rot в градусах по часовой, 0 = смотрит вправо.',
    inputSchema: S({ project: P, plan: PL }, ['project', 'plan']), annotations: { readOnlyHint: true },
    run: async ({ project, plan }) => {
      const id = await resolve(project), p = normalize((await load(id)).data);
      return findPlan(p, plan);
    },
  },
  {
    name: 'create_plan', title: 'Новый план',
    description: 'Создаёт план Shot Designer, при желании сразу с объектами (формат как в add_objects) и привязкой к сцене (номер сцены).',
    inputSchema: S({ project: P, name: { type: 'string' }, scene: { type: 'integer' }, objects: { type: 'array', items: { type: 'object' } } }, ['project', 'name']),
    run: async ({ project, name, scene, objects }) => edit(project, async p => {
      const plan = { id: 'plan-' + uid(), name: String(name), note: '', sceneId: scene ? (scenes(p)[scene - 1] || {}).id || '' : '', objects: [] };
      for (const o of objects || []) plan.objects.push(await cleanObject({ ...o }, plan));
      p.plans.push(plan);
      return { id: plan.id, objects: plan.objects.map(o => o.id) };
    }),
  },
  {
    name: 'add_objects', title: 'Добавить объекты на план',
    description: 'Добавляет объекты на план. Вызови get_reference, чтобы узнать поля и допустимые виды мебели, света и типажи. Возвращает id новых объектов.',
    inputSchema: S({ project: P, plan: PL, objects: { type: 'array', items: { type: 'object' } } }, ['project', 'plan', 'objects']),
    run: async ({ project, plan, objects }) => edit(project, async p => {
      const pl = findPlan(p, plan), ids = [];
      for (const o of objects || []) { const c = await cleanObject({ ...o }, pl); pl.objects.push(c); ids.push(c.id); }
      syncPhase(pl);
      return { ids };
    }),
  },
  {
    name: 'update_objects', title: 'Изменить объекты плана',
    description: 'Меняет поля объектов: [{id, ...поля}]. Значение null убирает поле. Координаты меняются в текущей фазе; phase (номер с 1) задаёт расстановку в другой фазе.',
    inputSchema: S({ project: P, plan: PL, changes: { type: 'array', items: { type: 'object' } }, phase: { type: 'integer' } }, ['project', 'plan', 'changes']),
    run: async ({ project, plan, changes, phase }) => edit(project, p => {
      const pl = findPlan(p, plan);
      const cur = Math.max(0, pl.phase | 0);
      const target = phase ? phase - 1 : cur;
      if (phase && (!pl.phases || !pl.phases[target])) throw new UserError(`На плане ${(pl.phases || []).length || 1} фаз.`);
      for (const ch of changes || []) {
        const o = pl.objects.find(x => x.id === ch.id);
        if (!o) throw new UserError('Нет объекта ' + ch.id);
        if (target !== cur && PHASED(o)) {
          const pos = pl.phases[target].pos[o.id] || { x: o.x, y: o.y, rot: o.rot || 0 };
          for (const k of ['x', 'y', 'rot']) if (num(ch[k]) !== undefined) pos[k] = ch[k];
          pl.phases[target].pos[o.id] = pos;
          const rest = { ...ch }; delete rest.x; delete rest.y; delete rest.rot; delete rest.id;
          for (const [k, v] of Object.entries(rest)) if (v === null) delete o[k]; else o[k] = v;
          continue;
        }
        for (const [k, v] of Object.entries(ch)) { if (k === 'id' || k === 'type') continue; if (v === null) delete o[k]; else o[k] = v; }
      }
      syncPhase(pl);
      return { ok: true };
    }),
  },
  {
    name: 'delete_objects', title: 'Убрать объекты с плана',
    description: 'Убирает объекты с плана по id.',
    inputSchema: S({ project: P, plan: PL, ids: { type: 'array', items: { type: 'string' } } }, ['project', 'plan', 'ids']),
    annotations: { destructiveHint: true },
    run: async ({ project, plan, ids }) => edit(project, p => {
      const pl = findPlan(p, plan), set = new Set(ids || []);
      const before = pl.objects.length;
      pl.objects = pl.objects.filter(o => !set.has(o.id));
      for (const ph of pl.phases || []) for (const id of set) delete ph.pos[id];
      return { removed: before - pl.objects.length };
    }),
  },
  {
    name: 'add_phase', title: 'Новая фаза движения',
    description: 'Добавляет фазу движения в конец плана: все стоят как в последней фазе, а перечисленные в moves [{id, x, y, rot?}] переходят на новые места. Так задаётся проход персонажа или движение камеры.',
    inputSchema: S({ project: P, plan: PL, name: { type: 'string' }, moves: { type: 'array', items: { type: 'object' } } }, ['project', 'plan', 'moves']),
    run: async ({ project, plan, name, moves }) => edit(project, p => {
      const pl = findPlan(p, plan);
      if (!Array.isArray(pl.phases) || !pl.phases.length) { pl.phases = [{ id: 'ph-' + uid(), name: 'Фаза 1', pos: {} }]; pl.phase = 0; }
      syncPhase(pl);
      const last = pl.phases[pl.phases.length - 1];
      const pos = JSON.parse(JSON.stringify(last.pos));
      for (const o of pl.objects) if (PHASED(o) && !pos[o.id]) pos[o.id] = { x: o.x, y: o.y, rot: o.rot || 0 };
      for (const m of moves || []) {
        if (!pos[m.id]) throw new UserError('Нет подвижного объекта ' + m.id);
        for (const k of ['x', 'y', 'rot']) if (num(m[k]) !== undefined) pos[m.id][k] = m[k];
      }
      pl.phases.push({ id: 'ph-' + uid(), name: name || `Фаза ${pl.phases.length + 1}`, pos });
      return { phase: pl.phases.length, of: pl.phases.length };
    }),
  },
  {
    name: 'get_shots', title: 'Режиссёрский сценарий',
    description: 'Кадры режиссёрского сценария с номерами «сцена.кадр»: крупность, движение, содержание, хронометраж, план и камера.',
    inputSchema: S({ project: P }, ['project']), annotations: { readOnlyHint: true },
    run: async ({ project }) => {
      const id = await resolve(project), p = normalize((await load(id)).data), nums = shotNumbers(p);
      return { shots: p.shots.map(s => ({ n: nums.get(s.id), ...s })) };
    },
  },
  {
    name: 'edit_shots', title: 'Править режиссёрский сценарий',
    description: 'Операции с кадрами: {op:"add", after: id кадра или null (в конец), shot:{scene (номер сцены), size, move, content, dur, note, mode, chars, props, tech, planId, cameraId}}, {op:"update", id, ...поля}, {op:"delete", id}. ' +
      'size: Деталь, Крупный, Средний по пояс, Средний по колено, Общий, Дальний. move: Статика, Панорама, Наезд или отъезд, Тележка, Стедикам, С рук, Кран, Слайдер, Пролёт.',
    inputSchema: S({ project: P, ops: { type: 'array', items: { type: 'object' } } }, ['project', 'ops']),
    run: async ({ project, ops }) => edit(project, p => {
      const sc = scenes(p), done = [];
      const fix = s => { if (s.scene) { s.sceneId = (sc[s.scene - 1] || {}).id || ''; delete s.scene; } delete s.n; return s; };
      for (const o of ops || []) {
        if (o.op === 'add') {
          const s = fix({ id: uid(), size: 'Средний по пояс', move: 'Статика', content: '', ...(o.shot || {}) });
          const i = o.after == null ? p.shots.length : p.shots.findIndex(x => x.id === o.after) + 1;
          if (o.after != null && i === 0) throw new UserError('Нет кадра ' + o.after);
          p.shots.splice(i, 0, s); done.push(s.id);
        } else if (o.op === 'update') {
          const s = p.shots.find(x => x.id === o.id);
          if (!s) throw new UserError('Нет кадра ' + o.id);
          const ch = fix({ ...o }); delete ch.op; delete ch.id;
          for (const [k, v] of Object.entries(ch)) { if (v === null) delete s[k]; else s[k] = v; }
          done.push(s.id);
        } else if (o.op === 'delete') { const before = p.shots.length; p.shots = p.shots.filter(x => x.id !== o.id); if (before === p.shots.length) throw new UserError('Нет кадра ' + o.id); done.push(o.id); }
        else throw new UserError('Неизвестная операция ' + o.op);
      }
      return { ok: true, shots: done };
    }),
  },
  {
    name: 'get_breakdown', title: 'Разбор сцен',
    description: 'Разбор сценария по сценам: шапка (ИНТ/НАТ, место, время, день истории), длина в восьмых страницы, персонажи из текста и графы разбора, уже записанные в проект ' +
      '(cast — персонажи сверх найденных в тексте, extras — массовка, props — реквизит, costume — костюм, makeup — грим, vehicles — транспорт, animals — животные, stunts — трюки, sfx — спецэффекты, sound — звук и музыка). ' +
      'auto: true — запись не проверена человеком (найдена словарём программы или ИИ). Чтобы разобрать сцену по правилам, возьми задание «Разбор сцены по графам» или следуй правилам из инструкций сервера.',
    inputSchema: S({ project: P, scene: { type: 'integer', description: 'Номер сцены; без него все сцены' } }, ['project']), annotations: { readOnlyHint: true },
    run: async ({ project, scene }) => {
      const { bd } = await libs();
      const id = await resolve(project), p = normalize((await load(id)).data), list = Array.isArray(p.breakdown) ? p.breakdown : [];
      const info = bd.sceneInfo(p).filter(x => !scene || x.n === scene);
      if (scene && !info.length) throw new UserError(`Нет сцены ${scene}. Сцен в сценарии: ${bd.sceneInfo(p).length}.`);
      return { scenes: info.map(x => ({ n: x.n, heading: x.text, ie: x.ie, place: x.place, time: x.time, day: x.day, length: bd.eighthsText(x.eighths), chars: x.chars,
        items: list.filter(i => i.sceneId === x.id && !i.off).map(i => ({ id: i.id, cat: i.cat, text: i.text, auto: !!i.auto })) })) };
    },
  },
  {
    name: 'edit_breakdown', title: 'Править разбор сцен',
    description: 'Записывает разбор сцены по графам. Перед работой прочитай правила разбора в инструкциях сервера или возьми готовое задание «Разбор сцены» (prompts). ' +
      'ops: {op:"add", scene: номер, cat, text} — cat: cast, extras, props, costume, makeup, vehicles, animals, stunts, sfx, sound; ' +
      '{op:"update", id, text?, cat?} — поправить свою непроверенную запись; {op:"remove", id} — убрать непроверенную запись; ' +
      '{op:"clear_auto", scene: номер} — спрятать все непроверенные записи сцены (найденные словарём программы или раньше тобой), чтобы записать разбор заново. ' +
      'Всё, что ты добавляешь, человек увидит в пунктирной рамке «проверьте». Записи, которые человек проверил или вписал сам, ты менять и убирать не можешь; убранное человеком не возвращай.',
    inputSchema: S({ project: P, ops: { type: 'array', items: { type: 'object' } } }, ['project', 'ops']),
    run: async ({ project, ops }) => {
      const { bd } = await libs();
      return edit(project, p => {
        p.breakdown = Array.isArray(p.breakdown) ? p.breakdown : [];
        const sc = scenes(p), added = [], changed = [], skipped = [];
        const sceneOf = n => { const s = sc[(n || 0) - 1]; if (!s) throw new UserError(`Нет сцены ${n}. Сцен: ${sc.length}.`); return s; };
        const catOk = c => { if (!bd.CATS[c]) throw new UserError(`Неизвестная графа ${c}. Графы: ${Object.keys(bd.CATS).join(', ')}.`); };
        const mine = id => {
          const it = p.breakdown.find(x => x.id === id);
          if (!it) throw new UserError('Нет записи разбора ' + id);
          if (!it.auto) { skipped.push({ id, why: 'проверено человеком' }); return null; }
          return it;
        };
        for (const o of ops || []) {
          if (o.op === 'add') {
            const s = sceneOf(o.scene); catOk(o.cat);
            const text = String(o.text || '').trim();
            if (!text) throw new UserError('Пустой text');
            const old = p.breakdown.find(x => x.sceneId === s.id && x.text.toLowerCase() === text.toLowerCase());
            if (old && old.off && old.offBy !== 'ai') { skipped.push({ text, why: 'человек убрал эту запись' }); continue; }
            if (old && !old.off) { skipped.push({ text, why: 'уже есть' }); continue; }
            if (old) { Object.assign(old, { cat: o.cat, text, auto: true, off: false }); delete old.offBy; added.push(old.id); continue; }
            const it = { id: uid(), sceneId: s.id, cat: o.cat, text, auto: true, off: false };
            p.breakdown.push(it); added.push(it.id);
          } else if (o.op === 'update') {
            const it = mine(o.id); if (!it) continue;
            if (o.cat) { catOk(o.cat); it.cat = o.cat; }
            if (o.text) it.text = String(o.text).trim();
            changed.push(it.id);
          } else if (o.op === 'remove') {
            const it = mine(o.id); if (!it) continue;
            it.off = true; it.offBy = 'ai'; changed.push(it.id);
          } else if (o.op === 'clear_auto') {
            const s = sceneOf(o.scene);
            for (const it of p.breakdown) if (it.sceneId === s.id && it.auto && !it.off) { it.off = true; it.offBy = 'ai'; changed.push(it.id); }
          } else throw new UserError('Неизвестная операция ' + o.op);
        }
        return { ok: true, added, changed, skipped };
      });
    },
  },
  {
    name: 'get_crew', title: 'Группа',
    description: 'Актёры (персонаж, актёр, телефон, число сцен) и съёмочная группа по цехам: должность, имя, этап (В поисках, Найден, Требуется решение, Утверждён, Ещё не связались, Связались, Отказался), город, телефон или @telegram, почта, заметка, lead — показывать в «Руководителях группы» вызывного.',
    inputSchema: S({ project: P }, ['project']), annotations: { readOnlyHint: true },
    run: async ({ project }) => {
      const { sm } = await libs();
      const id = await resolve(project), p = normalize((await load(id)).data);
      sm.normalizeSchedule(p, uid);
      return {
        cast: sm.castList(p).map(c => ({ n: c.n, character: c.char, actor: c.actor, phone: c.phone, scenes: c.scenes.length })),
        departments: sm.DEPARTMENTS,
        crew: p.schedule.info.crew.map(({ id: rid, dept, role, name, status, city, phone, email, note, lead }) => ({ id: rid, dept, role, name, status, city, phone, email, note, lead })),
      };
    },
  },
  {
    name: 'edit_crew', title: 'Править группу',
    description: 'ops: {op:"add", role, name, dept?, status?, city?, phone?, email?, note?, lead?} — цех по должности определяется сам; ' +
      '{op:"update", id, ...поля}; {op:"remove", id}; {op:"actor", character, actor?, phone?, makeupMin?, costumeMin?, carMin?, busy?: [{date, kind:"busy"|"part", note}]} — кто играет персонажа, сколько минут на грим и костюм, за сколько до готовности машина, когда актёр занят. ' +
      'Телефон пиши как есть, ник в Telegram — с @. Должности пиши полностью: «Художник по костюму», а не «Худ. по кост».',
    inputSchema: S({ project: P, ops: { type: 'array', items: { type: 'object' } } }, ['project', 'ops']),
    run: async ({ project, ops }) => {
      const { sm } = await libs();
      return edit(project, p => {
        sm.normalizeSchedule(p, uid);
        const crew = p.schedule.info.crew, done = [];
        const F = ['role', 'name', 'status', 'city', 'phone', 'email', 'note'];
        for (const o of ops || []) {
          if (o.op === 'add') {
            const dept = sm.DEPARTMENTS.includes(o.dept) ? o.dept : sm.guessDept(o.role);
            const r = { id: uid(), dept, lead: o.lead !== undefined ? !!o.lead : (sm.ROLES[dept] || []).some(([x, l]) => l && x.toLowerCase() === String(o.role || '').toLowerCase()) };
            for (const k of F) r[k] = String(o[k] || '').trim();
            crew.push(r); done.push(r.id);
          } else if (o.op === 'update') {
            const r = crew.find(x => x.id === o.id);
            if (!r) throw new UserError('Нет человека ' + o.id);
            for (const k of F) if (o[k] !== undefined) r[k] = String(o[k]).trim();
            if (o.dept && sm.DEPARTMENTS.includes(o.dept)) r.dept = o.dept;
            if (o.lead !== undefined) r.lead = !!o.lead;
            done.push(r.id);
          } else if (o.op === 'remove') {
            const before = crew.length;
            p.schedule.info.crew = crew.filter(x => x.id !== o.id);
            if (before === p.schedule.info.crew.length) throw new UserError('Нет человека ' + o.id);
            done.push(o.id);
          } else if (o.op === 'actor') {
            const char = String(o.character || '').trim().toUpperCase();
            if (!char) throw new UserError('Нужен character');
            let r = p.schedule.cast.find(c => c.char.toUpperCase() === char);
            if (!r) { r = { id: uid(), char, actor: '', phone: '' }; p.schedule.cast.push(r); }
            if (o.actor !== undefined) r.actor = String(o.actor).trim();
            if (o.phone !== undefined) r.phone = String(o.phone).trim();
            for (const k of ['makeupMin', 'costumeMin', 'carMin']) if (o[k] !== undefined) r[k] = Math.max(0, Math.round(+o[k] || 0));
            if (Array.isArray(o.busy)) r.busy = o.busy.filter(b => b && /^\d{4}-\d{2}-\d{2}$/.test(b.date)).map(b => ({ date: b.date, kind: b.kind === 'part' ? 'part' : 'busy', note: String(b.note || '') }));
            done.push(char);
          } else throw new UserError('Неизвестная операция ' + o.op);
        }
        return { ok: true, done };
      });
    },
  },
  {
    name: 'get_schedule', title: 'КПП',
    description: 'КПП (календарно-постановочный план) открытого варианта раскладки: дни (id, номер смены, дата, тип дня, ночная, зафиксирован, сбор, сцены и плашки по порядку, страницы в восьмых, хронометраж, восход и закат по адресу локации), неразложенные сцены, ' +
      'все сцены с тем, что важно для раскладки (инт/нат, режим, сценарный день, объект и подобъект, локация, длина в восьмых, хронометраж, персонажи, массовка, транспорт, животные, трюки, спецэффекты, грим), актёры и их занятость по датам, другие варианты раскладки.',
    inputSchema: S({ project: P }, ['project']), annotations: { readOnlyHint: true },
    run: async ({ project }) => {
      const { sm, bd } = await libs();
      const id = await resolve(project), p = prepSchedule((await load(id)).data, sm, bd);
      const info = bd.sceneInfo(p), cast = sm.castList(p, info), done = sm.scheduledIds(p);
      const wd = d => d ? new Date(d + 'T12:00').toLocaleDateString('ru-RU', { weekday: 'short' }) : '';
      return {
        variant: sm.variantTitle(p.schedule), other_variants: p.schedule.variants.map(v => ({ id: v.id, name: v.name || 'Основной', shifts: v.days.filter(d => d.kind === 'work').length })),
        start: p.schedule.info.start,
        days: p.schedule.days.map(d => {
          const di = sm.dayInfo(p, d, info, cast);
          return {
            id: d.id, shift: sm.shiftNo(p, d) || null, date: d.date, weekday: wd(d.date), kind: d.kind, night: d.night, locked: d.locked, call: d.call, note: d.kppNote,
            items: d.items.map(x => x.type === 'banner' ? { banner: x.text } : info.find(q => q.id === x.sceneId)?.n).filter(x => x !== undefined),
            eighths: di.eighths, screen_time: sm.clockText(di.dur), sun: di.sun ? { sunrise: di.sun.sunrise, sunset: di.sun.sunset } : null,
          };
        }),
        unscheduled: info.filter(x => !done.has(x.id)).map(x => x.n),
        scenes: info.map(x => {
          const it = bd.sceneItems(p, x.id, info), l = p.locations.filter(q => q.sceneIds.includes(x.id));
          const o = {
            n: x.n, ie: x.ie, time: x.time, story_day: x.day, place: x.place || x.text, object: sm.objectOf(p, x).name, sub_object: sm.objectOf(p, x).sub,
            locations: l.map(q => q.name + (q.geo ? '' : ' (без адреса)')), eighths: x.eighths, screen_time: x.dur, characters: x.chars,
          };
          for (const k of ['extras', 'vehicles', 'animals', 'stunts', 'sfx', 'makeup']) if (it[k].length) o[k] = it[k];
          return o;
        }),
        cast: cast.map(c => ({ n: c.n, character: c.char, actor: c.actor, scenes: c.scenes.length, busy: (p.schedule.cast.find(r => r.char.toUpperCase() === c.char) || {}).busy || [] })),
      };
    },
  },
  {
    name: 'edit_schedule', title: 'Править КПП',
    description: 'Правка КПП открытого варианта. Дни указываются по id из get_schedule (или датой YYYY-MM-DD), сцены — номерами. ops: ' +
      '{op:"start", date} — первый день: все дни получают даты подряд от него; {op:"new_variant", name, copy?:false} — сохранить текущую раскладку как вариант и начать новую (copy:true — с копии текущей); ' +
      '{op:"add_day", date?, kind?:"work"|"off"|"rest"|"prep", night?, call?, note?, items?:[номер сцены | {banner:"Обед"}]} — день в конец (дата по умолчанию следующая), вернёт id; ' +
      '{op:"set_day", day, date?, kind?, night?, call?, note?} — поля дня; ' +
      '{op:"set_items", day, items:[номер | {banner}]} — весь порядок дня: эти сцены уходят из других дней, прежние сцены дня возвращаются в неразложенные; ' +
      '{op:"move_scene", scene, day|null, index?} — переставить сцену в день (null — убрать в неразложенные); ' +
      '{op:"remove_day", day} — удалить день, его сцены вернутся в неразложенные. ' +
      'Зафиксированные дни (locked) не меняются: правка в них вернёт ошибку.',
    inputSchema: S({ project: P, ops: { type: 'array', items: { type: 'object' } } }, ['project', 'ops']),
    run: async ({ project, ops }) => {
      const { sm, bd } = await libs();
      return edit(project, p => {
        prepSchedule(p, sm, bd);
        const sch = () => p.schedule, info = bd.sceneInfo(p), done = [];
        const sceneId = n => { const x = info.find(q => String(q.n) === String(n)); if (!x) throw new UserError(`Нет сцены ${n}`); return x.id; };
        const dayOf = ref => { const d = sch().days.find(x => x.id === ref) || sch().days.find(x => x.date && x.date === ref); if (!d) throw new UserError(`Нет дня ${ref}. Дни: ${sch().days.map(x => `${x.id} (${x.date || 'без даты'})`).join(', ')}`); return d; };
        const open = d => { if (d.locked) throw new UserError(`День ${d.date || d.id} зафиксирован, его менять нельзя. Попросите человека снять фиксацию.`); return d; };
        const pull = sid => { for (const d of sch().days) { const i = d.items.findIndex(x => x.sceneId === sid); if (i >= 0) { open(d); d.items.splice(i, 1); } } };
        const items = list => (list || []).map(x => {
          if (x && typeof x === 'object' && 'banner' in x) return { id: uid(), type: 'banner', text: String(x.banner) };
          const sid = sceneId(x); pull(sid); return { id: uid(), type: 'scene', sceneId: sid };
        });
        const fields = (d, o) => {
          if (o.date !== undefined) { if (o.date && !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new UserError('Дата в виде YYYY-MM-DD'); d.date = o.date; }
          if (o.kind !== undefined) { if (!sm.DAY_KINDS[o.kind]) throw new UserError('kind: work, off, rest или prep'); d.kind = o.kind; }
          if (o.night !== undefined) d.night = !!o.night;
          if (o.call !== undefined) d.call = String(o.call);
          if (o.note !== undefined) d.kppNote = String(o.note);
        };
        for (const o of ops || []) {
          if (o.op === 'start') { if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date || '')) throw new UserError('start: дата YYYY-MM-DD'); sm.datesFrom(p, o.date); done.push('start ' + o.date); }
          else if (o.op === 'new_variant') { sm.newVariant(p, uid, String(o.name || `Вариант ${sch().variants.length + 2}`), !!o.copy); done.push('variant: ' + o.name); }
          else if (o.op === 'add_day') {
            const d = { id: 'day-' + uid(), date: sm.nextDate(p), call: '08:00', wrap: '', lunch: '', weather: '', note: '', items: [], times: {}, kind: 'work', night: false, locked: false };
            fields(d, o);
            sch().days.push(d);
            d.items = items(o.items);
            done.push(d.id);
          } else if (o.op === 'set_day') { const d = open(dayOf(o.day)); fields(d, o); done.push(d.id); }
          else if (o.op === 'set_items') { const d = open(dayOf(o.day)); d.items = []; d.items = items(o.items); done.push(d.id); }
          else if (o.op === 'move_scene') {
            const sid = sceneId(o.scene); pull(sid);
            if (o.day !== null && o.day !== undefined) { const d = open(dayOf(o.day)); const i = Number.isInteger(o.index) ? Math.max(0, Math.min(o.index, d.items.length)) : d.items.length; d.items.splice(i, 0, { id: uid(), type: 'scene', sceneId: sid }); }
            done.push(String(o.scene));
          } else if (o.op === 'remove_day') { const d = open(dayOf(o.day)); p.schedule.days = sch().days.filter(x => x !== d); done.push(d.id); }
          else throw new UserError('Неизвестная операция ' + o.op);
        }
        sm.sortDays(p);
        sm.normalizeSchedule(p, uid);
        return { ok: true, done, variant: sm.variantTitle(p.schedule), days: p.schedule.days.map(d => ({ id: d.id, shift: sm.shiftNo(p, d) || null, date: d.date, kind: d.kind, scenes: d.items.filter(x => x.type === 'scene').map(x => info.find(q => q.id === x.sceneId)?.n) })) };
      });
    },
  },
  {
    name: 'get_callsheet', title: 'Вызывной лист',
    description: 'Вызывной лист съёмочного дня (day — id дня или дата YYYY-MM-DD из get_schedule): поля смены (сбор группы, начало смены, мотор, стоп-мотор, обед с концом, погода, примечания), ' +
      'план дня по времени (обед уже вставлен по ячейке «Обед»), объекты дня с подобъектами, адресом, базой группы и примечанием, время актёров (посчитанное по плану и минутам на грим и костюм, и вписанное руками), цеха и спецтранспорт, включённые блоки.',
    inputSchema: S({ project: P, day: { type: 'string' } }, ['project', 'day']), annotations: { readOnlyHint: true },
    run: async ({ project, day }) => {
      const { sm, bd } = await libs();
      const id = await resolve(project), p = prepSchedule((await load(id)).data, sm, bd);
      const d = findDay(p, day), info = bd.sceneInfo(p), cast = sm.castList(p, info), di = sm.dayInfo(p, d, info, cast);
      const auto = sm.autoTimes(p, d, info);
      const objs = [];
      for (const s of di.scenes) {
        const o = sm.objectOf(p, s);
        let g = objs.find(x => x.object === o.name);
        if (!g) {
          const k = t => String(t || '').toUpperCase().replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim(), all = p.locations.filter(l => k(l.object) === k(o.name));
          const val = f => (all.find(l => (l[f] || '').trim()) || {})[f] || ''; // адрес, база, примечание — со всего объекта
          objs.push(g = { object: o.name, address: val('geo'), base: val('base'), note: val('hint'), has_location: !!o.loc, subs: [] });
        }
        const sub = o.sub || '';
        let x = g.subs.find(q => q.sub === sub); if (!x) g.subs.push(x = { sub, scenes: [] }); x.scenes.push(s.n);
      }
      const F = ['call', 'motor', 'stop', 'lunch', 'meetTime', 'meet', 'meetNote', 'weather', 'tDay', 'tNight', 'sun', 'note', 'limits', 'kppNote'];
      return {
        day: { id: d.id, shift: sm.shiftNo(p, d) || null, date: d.date, kind: d.kind, night: d.night, locked: d.locked },
        fields: { ...Object.fromEntries(F.map(k => [k, d[k] || ''])), lunchEnd: sm.lunchEndOf(d), meetTime: d.meetTime || d.call },
        sun: di.sun ? { sunrise: di.sun.sunrise, sunset: di.sun.sunset, dawn: di.sun.dawn, dusk: di.sun.dusk } : null,
        plan: sm.timeline(p, d, info).map(r => r.scene ? { time: `${r.start}–${r.end}`, scene: r.scene.n, object: sm.objectOf(p, r.scene).name, sub: sm.objectOf(p, r.scene).sub, ie: r.scene.ie, mode: r.scene.time, characters: r.scene.chars } : { time: `${r.start}–${r.end}`, banner: r.item.text, ...(r.auto ? { from_lunch_cell: true } : {}) }),
        objects: objs,
        cast: di.cast.map(c => ({ character: c.char, actor: c.actor, auto: auto.cast[c.char] || {}, own: d.times[c.char] || {} })),
        depts: (d.depts || sm.DEFAULT_DEPTS.map(name => ({ name, time: '', off: false }))).map(r => ({ name: r.name, time: r.time || d.call, needed: !r.off })),
        transport: (d.transport || sm.DEFAULT_TRANSPORT.map(name => ({ name, time: '', off: false }))).map(r => ({ name: r.name, time: r.time || d.call, needed: !r.off })),
        blocks: Object.fromEntries(p.schedule.info.blocks.map(b => [b.id, b.on])),
      };
    },
  },
  {
    name: 'edit_callsheet', title: 'Заполнить вызывной лист',
    description: 'Заполнить вызывной лист дня. set: {call, motor, stop, lunch, lunchEnd, meetTime, meet, meetNote, weather, tDay, tNight, note, limits} — время «ЧЧ:ММ», пустая строка возвращает значение по умолчанию; ' +
      'copy_from: id или дата другого дня — перенести время смены, сбор группы, цеха и транспорт, примечания (план и время актёров не переносятся); ' +
      'depts / transport: [{name, time?, needed?}] — весь список целиком; times: {ПЕРСОНАЖ: {car?, arrive?, costume?, makeup?, ready?, end?}} — время актёров руками (пустая строка — снова по плану); ' +
      'blocks: {id: true|false} — показать или убрать блок (meet, shift, crew, depts, transport, locs, limits, note, kpp, cast, extras, next, plan).',
    inputSchema: S({ project: P, day: { type: 'string' }, set: { type: 'object' }, copy_from: { type: 'string' }, depts: { type: 'array', items: { type: 'object' } }, transport: { type: 'array', items: { type: 'object' } }, times: { type: 'object' }, blocks: { type: 'object' } }, ['project', 'day']),
    run: async a => {
      const { sm, bd } = await libs();
      return edit(a.project, p => {
        prepSchedule(p, sm, bd);
        const d = findDay(p, a.day), done = [];
        if (d.locked) throw new UserError(`День ${d.date || d.id} зафиксирован. Попросите человека снять фиксацию.`);
        const T = /^(\d{1,2}):(\d{2})$/, TIME = ['call', 'motor', 'stop', 'lunch', 'lunchEnd', 'meetTime'];
        if (a.copy_from) {
          const from = findDay(p, a.copy_from);
          for (const k of ['call', 'motor', 'stop', 'lunch', 'lunchEnd', 'meetTime', 'meet', 'meetNote', 'note', 'limits', 'depts', 'transport', 'cells']) {
            const v = from[k] === undefined ? undefined : JSON.parse(JSON.stringify(from[k]));
            if (Array.isArray(v)) for (const r of v) if (r && r.id) r.id = uid();
            if (v !== undefined) d[k] = v;
          }
          done.push('copy_from ' + (from.date || from.id));
        }
        for (const [k, v] of Object.entries(a.set || {})) {
          if (!['call', 'motor', 'stop', 'lunch', 'lunchEnd', 'meetTime', 'meet', 'meetNote', 'weather', 'tDay', 'tNight', 'note', 'limits', 'kppNote', 'sun'].includes(k)) throw new UserError('Нельзя менять поле ' + k);
          const val = String(v ?? '').trim();
          if (TIME.includes(k) && val && !T.test(val)) throw new UserError(`${k}: время в виде ЧЧ:ММ`);
          d[k] = TIME.includes(k) && val ? val.padStart(5, '0') : val; done.push(k);
        }
        for (const key of ['depts', 'transport']) if (Array.isArray(a[key])) {
          d[key] = a[key].map(r => ({ id: uid(), name: String(r.name || '').trim(), time: String(r.time || '').trim(), off: r.needed === false }));
          done.push(key);
        }
        for (const [char, t] of Object.entries(a.times || {})) {
          const c = char.toUpperCase(), row = (d.times[c] = d.times[c] || {});
          for (const [f, v] of Object.entries(t || {})) {
            if (!['car', 'arrive', 'costume', 'makeup', 'ready', 'end'].includes(f)) throw new UserError('Поле времени актёра: car, arrive, costume, makeup, ready, end');
            if (v) row[f] = String(v); else delete row[f];
          }
          done.push('times ' + c);
        }
        for (const [id, on] of Object.entries(a.blocks || {})) {
          const b = p.schedule.info.blocks.find(x => x.id === id);
          if (!b) throw new UserError('Нет блока ' + id);
          b.on = !!on; done.push('block ' + id);
        }
        sm.normalizeSchedule(p, uid);
        return { ok: true, done, lunch: d.lunch ? `${d.lunch}–${sm.lunchEndOf(d)}` : '' };
      });
    },
  },
  {
    name: 'edit_objects', title: 'Объекты и адреса',
    description: 'Адрес, база группы и примечание для группы — общие для объекта (дом, стадион): правка одного подобъекта меняет все. ' +
      'ops: [{object?: "Дом Батыра" | scene?: номер сцены, address?, base?, note?}] — по названию объекта или по сцене. ' +
      'Если у места сцены ещё нет локации, она заводится сама (объект и подобъект из шапки «ДОМ. КОМНАТА»).',
    inputSchema: S({ project: P, ops: { type: 'array', items: { type: 'object' } } }, ['project', 'ops']),
    run: async ({ project, ops }) => {
      const { sm, bd } = await libs();
      return edit(project, p => {
        prepSchedule(p, sm, bd);
        const info = bd.sceneInfo(p), key = t => String(t || '').toUpperCase().replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim(), done = [];
        for (const o of ops || []) {
          let l = null;
          if (o.scene !== undefined) {
            const s = info.find(x => String(x.n) === String(o.scene));
            if (!s) throw new UserError('Нет сцены ' + o.scene);
            l = p.locations.find(x => x.sceneIds.includes(s.id)) || bd.locationFromScene(p, s.id, uid);
          } else {
            l = p.locations.find(x => key(x.object) === key(o.object));
            if (!l) throw new UserError(`Нет объекта «${o.object}». Объекты: ${[...new Set(p.locations.map(x => x.object))].join(', ') || 'нет'}. Новый объект заводится по сцене: {scene: N}.`);
          }
          for (const [f, k] of [['address', 'geo'], ['base', 'base'], ['note', 'hint']]) if (o[f] !== undefined) for (const x of p.locations) if (key(x.object) === key(l.object)) x[k] = String(o[f]).trim();
          done.push(l.object);
        }
        prepSchedule(p, sm, bd);
        return { ok: true, done, objects: [...new Set(p.locations.map(x => x.object))].map(name => { const l = p.locations.find(x => x.object === name); return { object: name, address: l.geo, base: l.base, note: l.hint, subs: p.locations.filter(x => x.object === name).map(x => x.sub).filter(Boolean) }; }) };
      });
    },
  },
  {
    name: 'get_reference', title: 'Справочник',
    description: 'Как устроены объекты плана: поля, виды мебели и декорации, световые приборы, типажи людей, матрицы камер. Вызови перед тем, как расставлять объекты.',
    inputSchema: S({}), annotations: { readOnlyHint: true },
    run: async () => {
      const { FURN, LIGHTS, LOOKS } = await libs();
      return {
        units: 'метры; X вправо, Y вниз; rot в градусах по часовой стрелке, 0 = смотрит вправо (+X), 90 = вниз (+Y)',
        objects: {
          wall: '{type:"wall", x1, y1, x2, y2, thickness:0.15, color?}',
          door: '{type:"door", x, y, rot, w:0.9} ставится на линию стены',
          window: '{type:"window", x, y, rot, w:1.4} на линии стены',
          furniture: '{type:"furniture", kind, x, y, rot, w?, h? (размеры по плану, м), label?}',
          character: '{type:"character", name, x, y, rot, color?, look?, pose?:"stand"|"sit", height?:1.75}',
          camera: '{type:"camera", name:"A", x, y, rot (куда смотрит), lens:35 (мм), sensor:"s35"|"ff"|"mft"|"s16", height?:1.5, tilt?}',
          light: '{type:"light", kind, x, y, rot, label?, kelvin?, power? (%), off?, height?, tilt?, beam? (градусы, у приборов с линзой), elev? (у солнца)}',
          text: '{type:"text", x, y, text, size:0.3}',
          stroke: '{type:"stroke", points:[[x,y],...], color, width} рисунок от руки',
        },
        plan: 'поля плана: wallColor, floorColor, wallHeight (2.7), phases [{id,name,pos:{idОбъекта:{x,y,rot}}}], phase (номер текущей с 0)',
        furniture: Object.fromEntries(Object.entries(FURN).map(([k, v]) => [k, `${v.name}, ${v.w}×${v.h} м`])),
        lights: Object.fromEntries(Object.entries(LIGHTS).map(([k, v]) => [k, v.name])),
        looks: Object.fromEntries(Object.entries(LOOKS).map(([k, v]) => [k, v.name])),
        colors: ['#D8492F', '#2F8F6B', '#7B55C7', '#1D7FA6', '#B7791F', '#44505A'],
      };
    },
  },
];

function findDay(p, ref) {
  const d = p.schedule.days.find(x => x.id === ref) || p.schedule.days.find(x => x.date && x.date === ref);
  if (!d) throw new UserError(`Нет дня ${ref}. Дни: ${p.schedule.days.map(x => `${x.id} (${x.date || 'без даты'})`).join(', ') || 'нет'}`);
  return d;
}

function prepSchedule(p, sm, bd) {
  p.locations = Array.isArray(p.locations) ? p.locations : [];
  for (const l of p.locations) {
    l.sceneIds = Array.isArray(l.sceneIds) ? l.sceneIds : []; l.props = Array.isArray(l.props) ? l.props : []; l.geo = l.geo || ''; l.name = l.name || '';
    // объект и подобъект — как в программе: старые локации делятся по первой точке
    if (typeof l.object !== 'string') { const t = l.name.trim(), i = t.indexOf('.'); l.object = i < 0 ? t : t.slice(0, i).trim(); l.sub = i < 0 ? '' : t.slice(i + 1).replace(/^[\s.]+/, '').trim(); }
    l.sub = typeof l.sub === 'string' ? l.sub : ''; l.base = l.base || ''; l.hint = l.hint || '';
  }
  bd.normalizeBreakdown(p, uid);
  sm.normalizeSchedule(p, uid);
  return p;
}

// Правила раскладки КПП: что учитывать, когда ИИ раскладывает сцены по дням.
const SCHEDULE_RULES = `Правила раскладки КПП (календарно-постановочного плана):
1. Сначала get_schedule: сцены, локации, актёры и их занятость, уже разложенное. Зафиксированные дни (locked) не трогай. Если человек не просил переделать текущую раскладку, начни новый вариант: edit_schedule {op:"new_variant", name:"…", copy:false} — прежний останется, человек сравнит. Дни не удаляй без просьбы.
2. Спроси, если не знаешь: дату первой смены (start), рабочая неделя (5/2 или 6/1), длина смены (обычно 12 часов), ограничения площадок и актёров, которых нет в занятости. Если человек сказал «реши сам» — 5/2, 12 часов, и напиши это в отчёте.
3. Главное — меньше переездов: сцены одного объекта (локации) снимаются подряд, в один день — одна площадка, самое большее две рядом. Порядок сюжета не важен.
4. Нагрузка на смену: ориентир 4–5 страниц (32–40 восьмых) или 3–4 минуты экранного времени. Тяжелее считай сцены с трюками, спецэффектами, животными, детьми, большой массовкой, транспортом в кадре, сложным гримом — таких меньше в день.
5. Режим и солнце: дневная натура — между восходом и закатом дня (sun в get_schedule); режимные сцены — на рассвет или закат, отдельной короткой точкой; ночные — в ночные смены (night:true). После ночной смены — отсыпной день (kind:"rest") или смена не раньше чем через 12 часов.
6. Актёры: сцену с актёром нельзя ставить на дату, где он занят (busy kind "busy"); "part" — только с учётом заметки (например, после 12:00). Собирай сцены каждого актёра плотнее: меньше съёмочных дней и дней ожидания между ними.
7. Внутри объекта: сначала натура (погода, свет), потом интерьер; внутри интерьера — по сценарным дням и костюмам, чтобы реже менять грим и костюм; сцены с разрушающим гримом (кровь, грязь, слёзы, мокрые волосы) — в конце дня.
8. Массовку, игровой транспорт и животных собирай в как можно меньше дней.
9. Добавляй плашки там, где нужно: «Обед», «Переезд на …», «Установка света», «Грим, костюм, техническое освоение».
10. Выходные и праздники — нерабочие дни (kind:"off"), если человек не сказал иначе. Номер смены считается только по рабочим дням; даты — подряд от первого дня (start), выходные тоже занимают свою дату.
11. Объект и подобъект: шапка «ИНТ. ДОМ БАТЫРА. ГОСТИНАЯ» — объект «Дом Батыра», подобъект «Гостиная». Переезд — это смена объекта, а не комнаты: комнаты одного дома в один день — нормально.
12. Обед ставится ячейкой вызывного (edit_callsheet set.lunch), длина по умолчанию час — в план он встанет сам; плашку «Обед» в items добавлять не нужно.
13. Запиши раскладку через edit_schedule (по дням, set_items или add_day с items) и отчитайся по-русски: дни с объектами и сценами, страницы и хронометраж, почему так, какие конфликты не удалось решить (занятость, солнце, перегруз).`;

// Правила вызывного листа: как Мизансцена его заполняет и что ИИ стоит вписать сам.
const CALLSHEET_RULES = `Правила вызывного листа:
1. Сначала get_callsheet для дня: что уже вписано, что посчитано само. Зафиксированный день (locked) не меняй.
2. Само считается, вписывать не нужно: план по времени (от начала смены, длина сцен по хронометражу), обед в плане по ячейке «Обед», готовность и конец смены актёров по плану, грим, костюм и машина — назад от готовности по минутам актёра (edit_crew op "actor": makeupMin, costumeMin, carMin), восход и закат по адресу объекта, погода по прогнозу (на ~16 дней вперёд), место сбора — адрес объекта первой сцены, время сбора — начало смены, цеха и транспорт — к началу смены.
3. Вписывай то, чего программа не знает: сбор группы (meetTime обычно на 30–60 минут раньше начала смены, если нужны грим и костюм; meet — место, meetNote — как добраться), мотор (обычно через 1–1,5 часа после начала смены), стоп-мотор (не позже 12 часов от начала смены), обед (lunch — через 5–6 часов после начала смены, lunchEnd — только если не час).
4. Объекты: адрес, база группы и парковка, примечание для группы — общие для объекта (edit_objects). Если у места нет адреса, спроси человека; не выдумывай адреса.
5. Цеха и спецтранспорт: всем к началу смены, если человек не сказал иначе. Убирай ненужное в этой смене через needed:false (например, без генератора в интерьере с электричеством) — только если это очевидно из сцен или человек сказал.
6. Похожие смены: сначала copy_from из предыдущей рабочей смены, потом поправь отличия.
7. Ночная смена: начало вечером, стоп-мотор утром; после неё в КПП — отсыпной день.
8. Блоки листа стоят на постоянных местах; убирать блок (blocks) — только по просьбе человека.
9. В конце коротко отчитайся по-русски: что вписал, что посчитано само, что нужно уточнить у человека (адреса, базы, занятость актёров).`;

// Правила разбора сцены по графам — так, как его делает Мизансцена. Их получает любой подключённый ИИ-помощник.
const BREAKDOWN_RULES = `Правила разбора сцены по графам (как для КПП):
1. Сначала прочитай текст сцены целиком (get_screenplay с номером сцены) и то, что уже записано (get_breakdown). Разбирай по тексту, ничего не придумывай. Если вывод не прямой, а догадка, допиши в конце «(?)».
2. Графы: cast — персонажи, которых программа не нашла сама (дети, двойники, «только рука отца»); extras — массовка с числом («Труппа, 10–15 человек»); props — реквизит; costume — костюм с указанием на ком («Чёрный платок на маме»); makeup — грим; vehicles — транспорт; animals — животные; stunts — трюки и опасные действия; sfx — спецэффекты и то, что нужно решить на площадке или графикой; sound — звук и музыка в кадре и за кадром.
3. Пиши конкретно, по одной вещи на запись, с тем признаком, который важен для подготовки: не «Кастрюля», а «Кастрюля с горячим маслом на плите»; не «Часы», а «Песочные часы: песка осталось мало». Если предмет меняется по ходу фильма, укажи состояние в этой сцене.
4. Не путай упоминание с предметом в кадре: то, о чём только говорят, в разбор не идёт. Метафоры («красная слеза») переводи в то, что реально готовить («Капля варенья на щеке мамы»).
5. Где решение неочевидно, подскажи способ: «(VFX или механика)», «(безопасная имитация)», «(дубль предмета)».
6. Записи с пометкой auto: true — непроверенные (словарь программы или ты раньше). Если они неточные, спрячь их через clear_auto для этой сцены и запиши разбор заново. Записи, проверенные человеком, не трогай.
7. Текст сценария не правь. Если заметил ошибку разметки (например, строка «АКТ 2» размечена как персонаж), скажи об этом человеку, а не исправляй сам.
8. В конце коротко отчитайся человеку по-русски: сколько записей по каким сценам, что пометил как требующее решения, где сомневался.`;

const INSTRUCTIONS = 'Мизансцена: программа режиссёра (сценарий, разбор сцен по графам, режиссёрский сценарий, локации, Shot Designer — план сцены сверху с камерами, светом и персонажами, плюс 3D-вид). ' +
  'Начни с list_projects и get_project. Перед расстановкой объектов вызови get_reference. Правки сразу видны в открытой программе. ' +
  'Тексты сценария принадлежат автору: переписывай их, только если человек об этом просит. ' +
  'Отвечай по-русски, сцены называй номерами.\n\n' + BREAKDOWN_RULES + '\n\n' + SCHEDULE_RULES + '\n\n' + CALLSHEET_RULES;

// Готовые задания: в Claude Desktop они в меню «+», в Claude Code — команды /mcp__mizanscena__…
const PROMPTS = [
  {
    name: 'breakdown_scene', title: 'Разбор сцены по графам',
    description: 'Подробный разбор одной сцены: реквизит, костюм, грим, массовка, транспорт, трюки, эффекты, звук.',
    arguments: [{ name: 'project', description: 'Название или id проекта', required: true }, { name: 'scene', description: 'Номер сцены', required: true }],
    text: a => `Сделай подробный разбор сцены ${a.scene} проекта «${a.project}» в Мизансцене и запиши его в программу через edit_breakdown.\n\n${BREAKDOWN_RULES}`,
  },
  {
    name: 'breakdown_all', title: 'Разбор всего сценария по графам',
    description: 'Подробный разбор каждой сцены сценария по графам, как для КПП.',
    arguments: [{ name: 'project', description: 'Название или id проекта', required: true }],
    text: a => `Сделай подробный разбор всех сцен проекта «${a.project}» в Мизансцене и запиши его в программу через edit_breakdown. Иди по сценам по порядку, записывай каждую сцену отдельным вызовом. Следи, чтобы одни и те же предметы и костюмы назывались одинаково во всех сценах.\n\n${BREAKDOWN_RULES}`,
  },
  {
    name: 'schedule_plan', title: 'Разложить КПП',
    description: 'Разложить сцены по съёмочным дням с учётом локаций, актёров и их занятости, режима и солнца, нагрузки на смену. Записывается новым вариантом, текущий остаётся.',
    arguments: [{ name: 'project', description: 'Название или id проекта', required: true }, { name: 'wishes', description: 'Пожелания: дата начала, неделя 5/2 или 6/1, что снять первым, ограничения', required: false }],
    text: a => `Разложи КПП проекта «${a.project}» в Мизансцене по дням и запиши в программу новым вариантом раскладки.${a.wishes ? `\nПожелания: ${a.wishes}` : ''}\n\n${SCHEDULE_RULES}`,
  },
  {
    name: 'schedule_check', title: 'Проверить КПП',
    description: 'Проверить текущую раскладку: занятость актёров, переезды, перегруз смен, ночные смены без отсыпного, солнце.',
    arguments: [{ name: 'project', description: 'Название или id проекта', required: true }],
    text: a => `Проверь текущую раскладку КПП проекта «${a.project}» в Мизансцене (get_schedule): найди конфликты занятости актёров, лишние переезды, перегруженные и полупустые смены, ночные смены без отсыпного, натуру после заката, разбросанные дни актёров. Ничего не меняй — перечисли проблемы по дням и предложи исправления; правь, только если человек попросит.\n\n${SCHEDULE_RULES}`,
  },
  {
    name: 'callsheet_fill', title: 'Заполнить вызывные',
    description: 'Заполнить вызывные листы смен: сбор группы, мотор, стоп-мотор, обед, адреса и базы объектов, минуты на грим и костюм актёров.',
    arguments: [{ name: 'project', description: 'Название или id проекта', required: true }, { name: 'days', description: 'Какие смены: «все», «1–3» или даты', required: false }, { name: 'wishes', description: 'Что известно: начало смены, где сбор, адреса, кто сколько гримируется', required: false }],
    text: a => `Заполни вызывные листы проекта «${a.project}» в Мизансцене${a.days ? ` (смены: ${a.days})` : ''}: get_schedule, потом по каждой рабочей смене get_callsheet и edit_callsheet, адреса и базы — edit_objects, минуты на грим и костюм — edit_crew.${a.wishes ? `\nЧто известно: ${a.wishes}` : ''}\n\n${CALLSHEET_RULES}`,
  },
  {
    name: 'breakdown_check', title: 'Проверить разбор',
    description: 'Сверить уже записанный разбор с текстом сценария: что пропущено, что лишнее, что названо по-разному.',
    arguments: [{ name: 'project', description: 'Название или id проекта', required: true }],
    text: a => `Проверь разбор проекта «${a.project}» в Мизансцене: сверь записи (get_breakdown) с текстом сценария (get_screenplay). Найди пропущенное, лишнее (упомянуто, но не в кадре) и одно и то же, названное по-разному в разных сценах. Непроверенные записи исправь сам; про записи, проверенные человеком, только напиши, что предлагаешь поменять.\n\n${BREAKDOWN_RULES}`,
  },
];

// ---------- JSON-RPC ----------
async function handle(msg) {
  const { id, method, params = {} } = msg || {};
  const reply = result => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'Invalid Request');
  if (id === undefined) return null; // уведомление, отвечать не нужно
  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: 'mizanscena', title: 'Мизансцена', version: ctx.version || '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    case 'prompts/list': return reply({ prompts: PROMPTS.map(({ text, ...pr }) => pr) });
    case 'prompts/get': {
      const pr = PROMPTS.find(x => x.name === params.name);
      if (!pr) return fail(-32602, 'Нет задания ' + params.name);
      const args = params.arguments || {};
      const miss = pr.arguments.filter(x => x.required && !String(args[x.name] || '').trim()).map(x => x.name);
      if (miss.length) return fail(-32602, 'Не хватает: ' + miss.join(', '));
      return reply({ description: pr.description, messages: [{ role: 'user', content: { type: 'text', text: pr.text(args) } }] });
    }
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === params.name);
      if (!tool) return fail(-32602, 'Нет инструмента ' + params.name);
      try {
        const out = await tool.run(params.arguments || {});
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: Array.isArray(out) ? { items: out } : out });
      } catch (e) {
        if (!(e instanceof UserError)) console.error('MCP', params.name, e);
        return reply({ content: [{ type: 'text', text: e instanceof UserError ? e.message : 'Ошибка: ' + (e.message || e) }], isError: true });
      }
    }
    default: return fail(-32601, 'Метод не поддерживается: ' + method);
  }
}

// HTTP-часть: только с этого компьютера (сервер программы виден и телефонам в Wi-Fi, им MCP не нужен),
// и не из чужих сайтов в браузере (защита от подмены адреса).
const LOOPBACK = a => /^(127\.|::1$|::ffff:127\.)/.test(a || '');
async function http(req, res, readBody) {
  const send = (code, body, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  if (!LOOPBACK(req.socket.remoteAddress)) return send(403, { error: 'MCP доступен только с этого компьютера' });
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) return send(403, { error: 'forbidden origin' });
  if (req.method === 'GET' || req.method === 'DELETE') return send(405, { error: 'Нужен POST' }, { Allow: 'POST' });
  if (req.method !== 'POST') return send(405, { error: 'Нужен POST' }, { Allow: 'POST' });
  let msg;
  try { msg = JSON.parse((await readBody(req, 5 * 1024 * 1024)).toString('utf8')); }
  catch { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  const sid = req.headers['mcp-session-id'] || crypto.randomUUID();
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map(handle))).filter(Boolean);
    return out.length ? send(200, out, { 'Mcp-Session-Id': sid }) : send(202, undefined);
  }
  const out = await handle(msg);
  return out ? send(200, out, { 'Mcp-Session-Id': sid }) : send(202, undefined);
}

module.exports = { init, setSession, http, handle, LOOPBACK };
