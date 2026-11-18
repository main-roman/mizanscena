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
    lib = { FURN: shapes.FURN, LIGHTS: shapes.LIGHTS, LOOKS: shapes.LOOKS, API: cloud.API };
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

const INSTRUCTIONS = 'Мизансцена: программа режиссёра (сценарий, режиссёрский сценарий, Shot Designer — план сцены сверху с камерами, светом и персонажами, плюс 3D-вид). ' +
  'Начни с list_projects и get_project. Перед расстановкой объектов вызови get_reference. Правки сразу видны в открытой программе. ' +
  'Тексты сценария принадлежат автору: переписывай их, только если человек об этом просит.';

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
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'mizanscena', title: 'Мизансцена', version: ctx.version || '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
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
