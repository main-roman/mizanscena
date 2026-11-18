// Shot Designer: план сцены сверху и его 3D-вид. Работает с одним планом открытого проекта.
import { store, $, $$, uid, esc, reduced, toast, download, safeName, storeImage, pickFile, printHTML, numbering, scenesOf, normalizePlan, SIZES, MOVES } from './store.js';
import { storage, srcOf } from './storage.js';
import { scrubField } from './ui.js';
import { height3d, kelvinToHex, defaultKelvin, drawObject, drawIcon, gridPattern, extent, fov, caption, bounds, sorted, planSVG, emits, COLORS, SENSORS, FURN, FURN_CATS, LIGHTS, LIGHT, PAPER, LOOKS, POSES } from './shapes.js';

const svg = $('#plan'), world = $('#world'), handles = $('#handles'), defs = $('#defs'), ink = $('#ink'), ctx = $('#ctx');
const r2 = v => Math.round(v * 100) / 100;
const snap = v => r2(Math.round(v * 20) / 20);
const rad = d => d * Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isPhone = () => matchMedia('(max-width: 820px)').matches;

const LENSES = [18, 24, 35, 50, 85, 135];
const TITLES = { stroke: 'Рисунок', character: 'Персонаж', camera: 'Камера', light: 'Свет', furniture: 'Декорация', door: 'Дверь', window: 'Окно', wall: 'Стена', path: 'Движение', text: 'Заметка', image: 'Фото-подложка' };
const HINTS = {
  wall: 'Проведите по плану, чтобы начертить стену',
  pen: 'Рисуйте от руки: линия станет стеной, кружок человеком, прямоугольник на стене окном, чёрточка от стены дверью',
  path: 'Проведите от персонажа или камеры туда, куда они идут',
  brush: 'Рисуйте на доске. Цвет и толщина кисти на панели сверху',
  eraser: 'Проведите по рисунку, чтобы стереть его',
  text: 'Нажмите на план там, где нужна заметка',
};
const LAYERS = { set: 'Обстановка', people: 'Люди', cameras: 'Камеры', light: 'Свет', moves: 'Движение между фазами', notes: 'Заметки', draw: 'Рисунки' };
const layerOf = o => ({ character: 'people', camera: 'cameras', light: 'light', path: 'moves', text: 'notes', stroke: 'draw' }[o.type] || 'set');
// у кого своя расстановка в каждой фазе: всё, что стоит на плане точкой (люди, камеры, свет, предметы)
const PHASED = o => 'x' in o && !['door', 'window', 'image', 'text'].includes(o.type);

let active = false, scene = null, selId = null, tool = 'select', fresh = null, cat = 'main';
let view = { x: 200, y: 120, k: 70 };
let undoStack = [], redoStack = [], lastSnap = '', viewAnim = 0;
let mode3d = false, v3 = null, v3frame = 0, snapShot = '';
let placing = null, placeAt = null; // движение к фазе: какой объект и где сейчас курсор
const brush = { color: '#E8306C', width: 0.05 };
const layers = Object.fromEntries(Object.keys(LAYERS).map(k => [k, true]));

const project = () => store.project;
const sel = () => (scene && scene.objects.find(o => o.id === selId)) || null;
const goto = id => { location.hash = `#/p/${project().id}/plan/${id}`; };

// ---------- подключение к проекту ----------

export function mountPlan(planId, focusId) {
  const p = project();
  const next = p.plans.find(x => x.id === planId);
  if (!next) return false;
  const same = active && scene && scene.id === planId;
  scene = next;
  active = true;
  ensurePhases();
  lastSnap = JSON.stringify(scene);
  if (!same) { undoStack = []; redoStack = []; selId = null; setTool('select'); if (v3) v3.setCamera(null); closeCtx(); }
  if (focusId && scene.objects.some(o => o.id === focusId)) selId = focusId;
  if (!sel()) selId = null;
  $('#scene-select').innerHTML = p.plans.map(s => `<option value="${s.id}"${s.id === scene.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  renderAll();
  if (!same) requestAnimationFrame(() => fitView(false));
  return true;
}

export function unmountPlan() { active = false; closeCtx(); }

export function createPlan(data) {
  const plan = normalizePlan(data || { name: `План ${project().plans.length + 1}`, objects: [] });
  plan.id = 'plan-' + uid();
  project().plans.push(plan);
  store.touch();
  return plan.id;
}

// ---------- фазы движения ----------
// Объекты плана всегда стоят так, как в текущей фазе; расстановка остальных фаз хранится в scene.phases[i].pos.

function ensurePhases() {
  if (!Array.isArray(scene.phases) || !scene.phases.length) scene.phases = [{ id: 'ph-' + uid(), name: 'Фаза 1', pos: {} }];
  scene.phase = clamp(scene.phase | 0, 0, scene.phases.length - 1);
  storePhase();
}
function storePhase() {
  const ph = scene.phases[scene.phase];
  ph.pos = {};
  for (const o of scene.objects) if (PHASED(o)) ph.pos[o.id] = { x: o.x, y: o.y, rot: o.rot || 0 };
}
function loadPhase(i) {
  storePhase();
  scene.phase = i;
  const pos = scene.phases[i].pos;
  for (const o of scene.objects) if (PHASED(o) && pos[o.id]) Object.assign(o, pos[o.id]);
}

function renderPhases() {
  const btn = $('#phases-btn');
  btn.textContent = scene.phases.length > 1 ? `Фазы: ${scene.phase + 1} из ${scene.phases.length}` : 'Фазы';
  btn.classList.toggle('warn', scene.phases.length > 1);
  if (ctx.classList.contains('on') && ctx.dataset.kind === 'phases') ctx.innerHTML = phasesHTML();
}
function phasesHTML() {
  return `<h2>Фазы</h2><ol class="phase-list">${scene.phases.map((ph, i) => `<li class="${i === scene.phase ? 'on' : ''}">
      <button class="phase-go" data-phase="${i}" aria-pressed="${i === scene.phase}" title="Показать эту фазу">${i + 1}</button>
      <input type="text" data-phase-name="${i}" value="${esc(ph.name)}" aria-label="Название фазы ${i + 1}">
      ${scene.phases.length > 1 ? `<button class="phase-del" data-phase-del="${i}" title="Удалить фазу" aria-label="Удалить фазу">×</button>` : ''}</li>`).join('')}</ol>
    <div class="actions"><button class="act" data-phase-add>Новая фаза после текущей</button></div>
    <p class="empty">Как перевести героя, камеру, свет или предмет в другую фазу: правая кнопка по нему → «Движение к следующей фазе».</p>`;
}
function openPhases(x, y) {
  ctx.dataset.kind = 'phases';
  ctx.innerHTML = phasesHTML();
  placeCtx(x, y);
}
function addPhaseAt(index, fromPos) {
  storePhase();
  scene.phases.splice(index, 0, { id: 'ph-' + uid(), name: 'Фаза', pos: JSON.parse(JSON.stringify(fromPos)) });
  scene.phases.forEach((ph, i) => { if (/^Фаза( \d+)?$/.test(ph.name)) ph.name = `Фаза ${i + 1}`; });
}
function goPhase(i) {
  if (i === scene.phase) return;
  loadPhase(i);
  commit(); renderAll();
}
ctx.addEventListener('click', e => {
  if (ctx.dataset.kind !== 'phases') return;
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.phase !== undefined) goPhase(+b.dataset.phase);
  else if ('phaseAdd' in b.dataset) {
    addPhaseAt(scene.phase + 1, scene.phases[scene.phase].pos);
    scene.phase++;
    commit(); renderAll();
    toast('Новая фаза. Передвиньте всех, кто сменил место');
  } else if (b.dataset.phaseDel !== undefined) {
    const i = +b.dataset.phaseDel, ph = scene.phases[i];
    if (!confirm(`Удалить «${ph.name}»? Расстановка этой фазы пропадёт.`)) return;
    project().shots.forEach(s => { if (s.phaseId === ph.id) s.phaseId = ''; });
    storePhase();
    scene.phases.splice(i, 1);
    scene.phase = clamp(scene.phase > i ? scene.phase - 1 : scene.phase, 0, scene.phases.length - 1);
    const pos = scene.phases[scene.phase].pos;
    for (const o of scene.objects) if (PHASED(o) && pos[o.id]) Object.assign(o, pos[o.id]);
    commit(); renderAll();
  }
});
$('#phases-btn').addEventListener('click', e => {
  if (ctx.classList.contains('on') && ctx.dataset.kind === 'phases') return closeCtx();
  const r = e.currentTarget.getBoundingClientRect();
  openPhases(r.left - 6, r.bottom);
});

// ---------- движение к соседней фазе ----------
// Правая кнопка по объекту → «Движение к следующей (предыдущей) фазе» → щелчок по доске, где объект будет в той фазе.

function startPlacing(id, dir) {
  const o = scene.objects.find(q => q.id === id);
  if (!o) return;
  closeCtx();
  if (mode3d) setMode(false);
  let target;
  if (dir > 0) {
    if (scene.phase === scene.phases.length - 1) addPhaseAt(scene.phase + 1, scene.phases[scene.phase].pos);
    target = scene.phase + 1;
  } else {
    if (scene.phase === 0) { addPhaseAt(0, scene.phases[0].pos); scene.phase = 1; }
    target = scene.phase - 1;
  }
  placing = { id, dir, target };
  placeAt = null;
  svg.classList.add('placing');
  const hint = $('#hint');
  hint.textContent = `Нажмите на доске, где ${caption(o) || TITLES[o.type].toLowerCase()} будет в фазе «${scene.phases[target].name}». Esc — отмена`;
  hint.classList.add('on');
  renderAll();
}
function finishPlacing(p) {
  const o = scene.objects.find(q => q.id === placing.id), ph = scene.phases[placing.target];
  const x = snap(p.x), y = snap(p.y);
  // повернуть по направлению движения: героя и камеру лицом туда, куда они идут
  const from = placing.dir > 0 ? [o.x, o.y] : [x, y], to = placing.dir > 0 ? [x, y] : [o.x, o.y];
  const turn = o.type === 'character' || o.type === 'camera';
  const rot = turn && Math.hypot(to[0] - from[0], to[1] - from[1]) > 0.2 ? Math.round(Math.atan2(to[1] - from[1], to[0] - from[0]) * 180 / Math.PI / 5) * 5 : (o.rot || 0);
  ph.pos[o.id] = { x, y, rot: ((rot % 360) + 360) % 360 };
  if (placing.dir < 0 && turn) o.rot = ph.pos[o.id].rot; // пришёл оттуда: в текущей фазе смотрит по ходу движения
  const name = ph.name;
  cancelPlacing();
  commit(); renderAll();
  toast(`Готово: в фазе «${name}» он будет здесь. Пунктир показывает путь`);
}
function cancelPlacing() {
  placing = null; placeAt = null;
  svg.classList.remove('placing');
  setTool(tool);
  renderWorld();
}
function placingPreview() {
  if (!placing || !placeAt) return '';
  const o = scene.objects.find(q => q.id === placing.id);
  if (!o) return '';
  const ghost = drawObject({ ...o, id: 'place-ghost', x: snap(placeAt.x), y: snap(placeAt.y) }, { scene });
  const pts = placing.dir > 0 ? [[o.x, o.y], [snap(placeAt.x), snap(placeAt.y)]] : [[snap(placeAt.x), snap(placeAt.y)], [o.x, o.y]];
  return `<g pointer-events="none" opacity="0.55">${ghost}${drawObject({ id: 'place-path', type: 'path', ownerId: o.id, points: pts }, { scene })}</g>`;
}

// ---------- история ----------

function commit() {
  storePhase();
  const cur = JSON.stringify(scene);
  if (cur === lastSnap) return;
  undoStack.push(lastSnap);
  if (undoStack.length > 120) undoStack.shift();
  redoStack = [];
  lastSnap = cur;
  store.touch();
  syncButtons();
}

function restore(snapStr) {
  const plans = project().plans, i = plans.findIndex(x => x.id === scene.id);
  scene = plans[i] = JSON.parse(snapStr);
  lastSnap = snapStr;
  if (!sel()) selId = null;
  closeCtx();
  renderAll();
  store.touch();
}
function undo() { if (!undoStack.length) return; redoStack.push(lastSnap); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(lastSnap); restore(redoStack.pop()); }
function syncButtons() {
  $('#undo').disabled = !undoStack.length;
  $('#redo').disabled = !redoStack.length;
}

// ---------- вид: масштаб и сдвиг ----------

const stageRect = () => svg.getBoundingClientRect();
function toWorld(e) {
  const r = stageRect();
  return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
}

function fitView(animated = true) {
  const r = stageRect(), b = bounds(scene);
  if (!r.width || !r.height) return;
  const k = clamp(Math.min(r.width / (b.w + 1.6), r.height / (b.h + 1.6)), 12, 160);
  setView({ k, x: r.width / 2 - (b.x + b.w / 2) * k, y: r.height / 2 - (b.y + b.h / 2) * k }, animated);
}

function zoomBy(f, cx, cy, animated = false) {
  const r = stageRect();
  cx ??= r.width / 2; cy ??= r.height / 2;
  const k = clamp(view.k * f, 8, 500);
  const wx = (cx - view.x) / view.k, wy = (cy - view.y) / view.k;
  setView({ k, x: cx - wx * k, y: cy - wy * k }, animated);
}

function setView(target, animated) {
  cancelAnimationFrame(viewAnim);
  if (!animated || reduced.matches) { view = target; renderView(); return; }
  const from = { ...view }, t0 = performance.now(), dur = 280;
  const step = now => {
    const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
    view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e };
    renderView();
    if (t < 1) viewAnim = requestAnimationFrame(step);
  };
  viewAnim = requestAnimationFrame(step);
}

// ---------- отрисовка ----------

function renderView() {
  const t = `translate(${view.x} ${view.y}) scale(${view.k})`;
  world.setAttribute('transform', t);
  defs.innerHTML = gridPattern(t);
  $('#scale i').style.width = view.k + 'px';
  renderHandles();
}

// Пунктир до места, где персонаж или камера окажутся в следующей фазе.
function ghosts() {
  if (!layers.moves) return '';
  const arrows = (ph, toNext) => !ph ? '' : scene.objects
    .filter(o => PHASED(o) && layers[layerOf(o)] && ph.pos[o.id] && Math.hypot(ph.pos[o.id].x - o.x, ph.pos[o.id].y - o.y) > 0.15)
    .map(o => {
      const there = [ph.pos[o.id].x, ph.pos[o.id].y], here = [o.x, o.y];
      return drawObject({ id: 'ghost-' + o.id, type: 'path', ownerId: o.id, points: toNext ? [here, there] : [there, here] }, { scene });
    }).join('');
  // пунктир только показывает путь и не перехватывает щелчки (раньше из-за него нельзя было выбрать героя)
  return `<g pointer-events="none" opacity="0.35">${arrows(scene.phases[scene.phase - 1], false)}</g><g pointer-events="none">${arrows(scene.phases[scene.phase + 1], true)}</g>`;
}

function renderWorld() {
  const visible = sorted(scene.objects).filter(o => layers[layerOf(o)]);
  world.innerHTML = visible.map(o => drawObject(o, { scene, fresh: o.id === fresh })).join('') + ghosts() + placingPreview();
  renderHandles();
  sync3d();
}

const toLocal = (o, p) => {
  const a = rad(-(o.rot || 0)), dx = p.x - o.x, dy = p.y - o.y;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
};
const fromLocal = (o, lx, ly) => {
  const a = rad(o.rot || 0);
  return [o.x + lx * Math.cos(a) - ly * Math.sin(a), o.y + lx * Math.sin(a) + ly * Math.cos(a)];
};
const hasH = o => o.type === 'furniture' || o.type === 'image';
const hasW = o => hasH(o) || o.type === 'door' || o.type === 'window' || (o.type === 'light' && !!(LIGHTS[o.kind] || {}).w);
const alongX = o => o.type === 'door' || o.type === 'window'; // дверь и окно тянутся вдоль стены, приборы света поперёк луча
const canRotate = o => !['wall', 'path', 'text', 'stroke'].includes(o.type) && !(o.type === 'light' && (LIGHTS[o.kind] || {}).shape === 'glow');

function renderHandles() {
  const o = active && sel();
  if (!o || !layers[layerOf(o)]) { handles.innerHTML = ''; return; }
  const S = p => [p[0] * view.k + view.x, p[1] * view.k + view.y];
  const dot = (p, name, cls = '') => {
    const [x, y] = S(p);
    return `<g data-h="${name}"><circle cx="${x}" cy="${y}" r="18" fill="transparent"/><circle class="h ${cls}" cx="${x}" cy="${y}" r="7"/></g>`;
  };
  let h = '';
  if (o.type === 'wall') {
    h = dot([o.x1, o.y1], 'p1') + dot([o.x2, o.y2], 'p2');
  } else if (o.type === 'text' || o.type === 'stroke') {
    const el = world.querySelector(`[data-id="${o.id}"]`);
    if (el) {
      const b = el.getBBox(), [x0, y0] = S([b.x, b.y]), pad = 6;
      h = `<rect class="ring" x="${x0 - pad}" y="${y0 - pad}" width="${b.width * view.k + pad * 2}" height="${b.height * view.k + pad * 2}" rx="6"/>`;
    }
  } else if (o.type === 'path') {
    for (let i = 0; i < o.points.length - 1; i++) {
      const a = o.points[i], b = o.points[i + 1];
      h += dot([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 'mid:' + i, 'ghost');
    }
    o.points.forEach((p, i) => { h += dot(p, 'pt:' + i); });
  } else {
    const [cx, cy] = S([o.x, o.y]);
    let reach;
    if (hasH(o)) {
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => S(fromLocal(o, sx * o.w / 2, sy * o.h / 2)).join(','));
      h += `<polygon class="ring" points="${c.join(' ')}"/>`;
      reach = (o.w / 2) * view.k;
    } else {
      reach = extent(o) * view.k + 9;
      h += `<circle class="ring" cx="${cx}" cy="${cy}" r="${reach}"/>`;
    }
    if (canRotate(o)) {
      const a = rad(o.rot || 0), r1 = reach + 26;
      const x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1;
      h += `<line class="stem" x1="${cx + Math.cos(a) * reach}" y1="${cy + Math.sin(a) * reach}" x2="${x1}" y2="${y1}"/>`;
      h += `<g data-h="rot"><circle cx="${x1}" cy="${y1}" r="18" fill="transparent"/><circle class="h rot" cx="${x1}" cy="${y1}" r="7"/></g>`;
    }
    if (hasW(o)) h += dot(hasH(o) ? fromLocal(o, o.w / 2, o.h / 2) : alongX(o) ? fromLocal(o, o.w / 2, 0) : fromLocal(o, 0, o.w / 2), 'size');
  }
  handles.innerHTML = h;
}

function renderAll() {
  renderView();
  renderWorld();
  renderObjectPane();
  renderShots();
  renderPlanPane();
  renderPhases();
  syncButtons();
}

// ---------- палитра ----------

const GLYPHS = {
  select: '<path class="glyph" d="M7 4l12 9-6 1 3 6-3 1-3-6-4 4z" fill="#fff"/>',
  wall: '<path d="M4 18L20 6" stroke="#1C2A30" stroke-width="5" stroke-linecap="square"/>',
  pen: '<path class="glyph" d="M4 20l1-4L16 5l3 3L8 19z" fill="#fff"/><path class="glyph" d="M14 7l3 3"/>',
  path: '<path class="glyph" d="M4 18c4-10 9-2 14-11" stroke-dasharray="4 3.5"/><path d="M20 5l-5.6.8 3.6 3.6z" fill="#1C2A30"/>',
  brush: '<path class="glyph" d="M14 4l6 6-8 8H6v-6z" fill="#fff"/><path d="M3 21c2-1 3-3 3-5" stroke="#E8306C" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
  eraser: '<path class="glyph" d="M4 15l8-8 6 6-6 6H8z" fill="#fff"/><path class="glyph" d="M9 10l6 6M12 19h8"/>',
  text: '<path class="glyph" d="M6 6h12M12 6v13"/>',
  image: '<rect class="glyph" x="4" y="5" width="16" height="14" rx="2"/><path class="glyph" d="M4 16l5-5 4 4 2-2 5 5"/><circle cx="15" cy="9.5" r="1.5" fill="#1C2A30"/>',
};
const glyph = g => `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[g]}</svg>`;
const furnItem = kind => ({ add: { type: 'furniture', kind, w: FURN[kind].w, h: FURN[kind].h }, name: FURN[kind].name });
const CATS = {
  main: ['Основное', () => [
    { add: { type: 'character', color: COLORS[3], name: 'А', look: 'm1' }, name: 'Мужчина' },
    { add: { type: 'character', color: COLORS[0], name: 'А', look: 'f1' }, name: 'Девушка' },
    furnItem('crowd'),
    { add: { type: 'camera', name: 'A', lens: 35, sensor: 's35' }, name: 'Камера' },
    { add: { type: 'door', w: 0.9 }, name: 'Дверь' },
    { add: { type: 'window', w: 1.2 }, name: 'Окно' },
    { image: true, name: 'Фото-подложка', icon: glyph('image') },
  ]],
  light: ['Свет', () => Object.entries(LIGHTS).map(([kind, d]) => ({ add: { type: 'light', kind, ...(d.w ? { w: d.w } : {}) }, name: d.name }))],
  ...Object.fromEntries(Object.entries(FURN_CATS).map(([c, title]) => [c, [title, () => Object.keys(FURN).filter(k => FURN[k].cat === c).map(furnItem)]])),
};

function buildPalette() {
  const tools = [['select', 'Выбор'], ['pen', 'Стены от руки'], ['wall', 'Стена'], ['brush', 'Рисовать'], ['eraser', 'Ластик'], ['text', 'Заметка']];
  $('#palette').innerHTML = `
    <div class="cats" role="tablist" aria-label="Разделы объектов">${Object.entries(CATS).map(([k, [title]]) =>
      `<button role="tab" data-cat="${k}" aria-selected="${k === cat}">${title}</button>`).join('')}</div>
    <div class="strip">
      <div class="tools">${tools.map(([t, name]) => `<button class="tool" data-tool="${t}" aria-pressed="${t === tool}" title="${name}">${glyph(t)}<span>${name}</span></button>`).join('')}</div>
      <div class="items" id="palette-items"></div>
    </div>`;
  renderItems();
}

function renderItems() {
  const el = $('#palette-items');
  el.innerHTML = CATS[cat][1]().map(it =>
    `<button class="tool" ${it.image ? 'data-image' : `data-add='${JSON.stringify(it.add)}'`}>${it.icon || drawIcon(it.add)}<span>${it.name}</span></button>`).join('');
  el.classList.remove('swap');
  void el.offsetWidth; // перезапуск анимации появления
  el.classList.add('swap');
}

$('#palette').addEventListener('click', async e => {
  const c = e.target.closest('[data-cat]');
  if (c) {
    cat = c.dataset.cat;
    $$('#palette [data-cat]').forEach(b => b.setAttribute('aria-selected', b.dataset.cat === cat));
    renderItems();
    return;
  }
  const b = e.target.closest('.tool');
  if (!b) return;
  if (b.dataset.tool) setTool(b.dataset.tool);
  else if ('image' in b.dataset) addUnderlay();
  else addFromPalette(JSON.parse(b.dataset.add));
});

function setTool(t) {
  tool = t;
  $$('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t));
  svg.classList.toggle('draw', t !== 'select');
  const hint = $('#hint');
  if (HINTS[t]) hint.textContent = HINTS[t];
  hint.classList.toggle('on', !!HINTS[t]);
  if (t !== 'select' && mode3d) setMode(false);
  renderBrushbar();
}

function nextName(type, letters) {
  const used = new Set(scene.objects.filter(o => o.type === type).map(o => o.name));
  return [...letters].find(l => !used.has(l)) || String(used.size + 1);
}

function addObject(o, at) {
  const r = stageRect();
  let x = at ? at.x : snap((r.width / 2 - view.x) / view.k), y = at ? at.y : snap((r.height / 2 - view.y) / view.k);
  while (!at && scene.objects.some(q => q.x === x && q.y === y)) { x = snap(x + 0.4); y = snap(y + 0.4); }
  const obj = { id: uid(), rot: 0, ...o, x, y };
  scene.objects.push(obj);
  if (PHASED(obj)) for (const ph of scene.phases) ph.pos[obj.id] = { x, y, rot: obj.rot || 0 };
  layers[layerOf(obj)] = true;
  fresh = obj.id;
  setTimeout(() => { if (fresh === obj.id) fresh = null; }, 400);
  select(obj.id);
  commit();
  return obj;
}

function addFromPalette(o) {
  setTool('select');
  if (o.type === 'character') {
    const count = scene.objects.filter(q => q.type === 'character').length;
    o = { ...o, name: nextName('character', 'АБВГДЕЖЗИК'), color: COLORS[count % COLORS.length] };
  }
  if (o.type === 'camera') o = { ...o, name: nextName('camera', 'ABCDEFGH') };
  if (o.type === 'light' && emits(o.kind)) o = { ...o, color: LIGHTS[o.kind].color || LIGHT };
  addObject(o);
}

async function addUnderlay() {
  const file = await pickFile('image/*');
  if (!file) return;
  try {
    const { src, ratio } = await storeImage(file);
    setTool('select');
    addObject({ type: 'image', src, w: 6, h: r2(6 * ratio), ratio, opacity: 0.6, locked: false });
    toast('Подложка добавлена. Подгоните размер по масштабной линейке');
  } catch {
    toast('Не получилось открыть картинку');
  }
}

function select(id) {
  if (selId === id) return;
  selId = id;
  renderWorld();
  renderObjectPane();
  renderShots();
  if (id && !isPhone()) showTab('object');
}

function removeSelected() {
  const o = sel();
  if (!o) return;
  scene.objects = scene.objects.filter(q => q.id !== o.id && !(q.type === 'path' && q.ownerId === o.id));
  if (o.type === 'camera') project().shots.forEach(s => { if (s.cameraId === o.id) s.cameraId = ''; });
  selId = null;
  closeCtx();
  commit();
  renderAll();
}

function duplicateSelected() {
  const o = sel();
  if (!o) return;
  const c = JSON.parse(JSON.stringify(o));
  delete c.id;
  if (o.type === 'wall') { c.x1 += 0.4; c.y1 += 0.4; c.x2 += 0.4; c.y2 += 0.4; }
  if (o.type === 'path' || o.type === 'stroke') c.points = c.points.map(p => [r2(p[0] + 0.4), r2(p[1] + 0.4)]);
  if (o.type === 'character') c.name = nextName('character', 'АБВГДЕЖЗИК');
  if (o.type === 'camera') c.name = nextName('camera', 'ABCDEFGH');
  closeCtx();
  if (o.type === 'wall' || o.type === 'path' || o.type === 'stroke') {
    c.id = uid();
    scene.objects.push(c);
    select(c.id);
    commit();
  } else addObject(c, { x: snap(o.x + 0.5), y: snap(o.y + 0.5) });
}

// Сдвиг объекта вместе со стрелками движения, которые из него выходят.
function moveTo(o, x, y) {
  const dx = x - o.x, dy = y - o.y;
  o.x = x; o.y = y;
  for (const q of scene.objects) if (q.type === 'path' && q.ownerId === o.id) q.points[0] = [r2(q.points[0][0] + dx), r2(q.points[0][1] + dy)];
}

// ---------- рисование от руки ----------

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
// Упрощение ломаной: остаются только настоящие углы.
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  let dmax = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) { const d = segDist(pts[i], a, b); if (d > dmax) { dmax = d; idx = i; } }
  if (dmax <= eps) return [a, b];
  return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
}
function nearestWall(p) {
  let best = null;
  for (const w of scene.objects) {
    if (w.type !== 'wall') continue;
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = Math.hypot(dx, dy);
    if (L < 0.05) continue;
    const s = clamp(((p[0] - w.x1) * dx + (p[1] - w.y1) * dy) / L, 0, L);
    const px = w.x1 + dx / L * s, py = w.y1 + dy / L * s, d = Math.hypot(p[0] - px, p[1] - py);
    if (!best || d < best.d) best = { w, d, s, L, px, py, ux: dx / L, uy: dy / L, ang: Math.atan2(dy, dx) * 180 / Math.PI };
  }
  return best;
}

function recognize(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  if (len < 0.25) return '';
  const a = pts[0], b = pts[pts.length - 1];
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const c = [(x0 + x1) / 2, (y0 + y1) / 2], bw = x1 - x0, bh = y1 - y0;
  const push = o => { const obj = { id: uid(), ...o }; scene.objects.push(obj); if (PHASED(obj)) for (const ph of scene.phases) ph.pos[obj.id] = { x: obj.x, y: obj.y, rot: obj.rot || 0 }; selId = obj.id; return obj; };

  if (dist(a, b) < Math.max(0.3, len * 0.2) && len > 0.8) { // замкнутая фигура
    const nw = nearestWall(c);
    if (nw && nw.d < 0.35) {
      const ss = pts.map(p => (p[0] - nw.w.x1) * nw.ux + (p[1] - nw.w.y1) * nw.uy);
      const s0 = clamp(Math.min(...ss), 0, nw.L), s1 = clamp(Math.max(...ss), 0, nw.L), mid = (s0 + s1) / 2;
      push({ type: 'window', x: r2(nw.w.x1 + nw.ux * mid), y: r2(nw.w.y1 + nw.uy * mid), rot: Math.round(nw.ang), w: Math.max(0.4, snap(s1 - s0)) });
      return 'Окно';
    }
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
    const round = 4 * Math.PI * Math.abs(area / 2) / (len * len) > 0.84; // круг около 1, квадрат около 0,78
    if (round && Math.max(bw, bh) < 1.3) {
      const count = scene.objects.filter(q => q.type === 'character').length;
      push({ type: 'character', x: snap(c[0]), y: snap(c[1]), rot: 0, name: nextName('character', 'АБВГДЕЖЗИК'), color: COLORS[count % COLORS.length], look: count % 2 ? 'f1' : 'm1' });
      return 'Персонаж';
    }
    push({ type: 'furniture', kind: round ? 'round' : 'table', x: snap(c[0]), y: snap(c[1]), rot: 0, w: Math.max(0.2, snap(bw)), h: Math.max(0.2, snap(bh)), label: '' });
    return round ? 'Круглый стол' : 'Стол';
  }

  const straight = simplify(pts, 0.15).length === 2;
  const sw = nearestWall(a), ew = nearestWall(b);
  for (const [nw, far] of [[sw, ew], [ew, sw]]) { // чёрточка от стены: дверь
    if (straight && len < 1.6 && nw && nw.d < 0.25 && !(far && far.d < 0.25)) {
      push({ type: 'door', x: r2(nw.px), y: r2(nw.py), rot: Math.round(nw.ang), w: clamp(snap(len), 0.6, 1.4) });
      return 'Дверь';
    }
  }

  // всё остальное: стены, по одной на каждый прямой участок
  const corners = simplify(pts, 0.18);
  let prev = snapWallPoint({ x: corners[0][0], y: corners[0][1] }), made = 0;
  const first = prev;
  for (let i = 1; i < corners.length; i++) {
    let p = { x: corners[i][0], y: corners[i][1] };
    const ang = Math.abs(Math.atan2(p.y - prev.y, p.x - prev.x) * 180 / Math.PI);
    const s = snapWallPoint(p);
    if (ang < 10 || ang > 170) s.y = prev.y; else if (Math.abs(ang - 90) < 10) s.x = prev.x;
    if (i === corners.length - 1 && Math.hypot(s.x - first.x, s.y - first.y) < 0.35 && corners.length > 3) { s.x = first.x; s.y = first.y; }
    if (Math.hypot(s.x - prev.x, s.y - prev.y) < 0.3) continue;
    push({ type: 'wall', x1: prev.x, y1: prev.y, x2: s.x, y2: s.y, thickness: 0.15 });
    prev = s; made++;
  }
  return made ? (made > 1 ? `Стены: ${made}` : 'Стена') : '';
}

// ---------- работа указателем на плане ----------

const pts = new Map();
let drag = null, pinch = null;

function snapWallPoint(p, skip) {
  for (const o of scene.objects) {
    if (o.type !== 'wall' || o === skip) continue;
    for (const [x, y] of [[o.x1, o.y1], [o.x2, o.y2]]) if (Math.hypot(p.x - x, p.y - y) < 0.2) return { x, y };
  }
  return { x: r2(Math.round(p.x * 10) / 10), y: r2(Math.round(p.y * 10) / 10) };
}

function abortDrag() {
  if (drag && drag.moved) { restoreQuiet(); renderWorld(); }
  drag = null;
  ink.setAttribute('points', '');
  svg.classList.remove('dragging');
}
function restoreQuiet() {
  const plans = project().plans, i = plans.findIndex(x => x.id === scene.id);
  scene = plans[i] = JSON.parse(lastSnap);
}

svg.addEventListener('pointerdown', e => {
  if (!active || (e.pointerType === 'mouse' && e.button > 2)) return;
  try { svg.setPointerCapture(e.pointerId); } catch { /* синтетическое событие без указателя */ }
  pts.set(e.pointerId, [e.clientX, e.clientY]);
  cancelAnimationFrame(viewAnim);
  if (pts.size === 2) {
    abortDrag();
    const [a, b] = [...pts.values()];
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, v: { ...view } };
    return;
  }
  if (pts.size > 2) return;

  const p = toWorld(e);
  const hEl = e.target.closest('[data-h]'), oEl = e.target.closest('#world [data-id]');
  const base = { sx: e.clientX, sy: e.clientY, p0: p, moved: false };
  const hit = oEl ? scene.objects.find(o => o.id === oEl.dataset.id) : null;

  // правая и средняя кнопки двигают доску; правая без движения открывает меню объекта
  if (e.button === 1 || e.button === 2) { drag = { ...base, kind: 'pan', vx: view.x, vy: view.y, right: e.button === 2, hit: hit && hit.id }; return; }
  if (placing) { finishPlacing(p); return; }
  if (tool === 'brush') { drag = { ...base, kind: 'brush' }; return; }
  if (tool === 'eraser') { drag = { ...base, kind: 'erase', erased: 0 }; eraseAt(p); return; }
  if (tool === 'wall') { drag = { ...base, kind: 'wall' }; return; }
  if (tool === 'pen') { drag = { ...base, kind: 'pen', pts: [[p.x, p.y]], screen: [] }; return; }
  if (tool === 'path') {
    const owner = hit && (hit.type === 'character' || hit.type === 'camera') ? hit : null;
    drag = { ...base, kind: 'path', owner };
    return;
  }
  if (tool === 'text') {
    addObject({ type: 'text', text: 'Заметка', size: 0.3 }, { x: snap(p.x), y: snap(p.y) });
    setTool('select');
    showTab('object', true);
    return;
  }
  if (hEl) {
    let h = hEl.dataset.h;
    const o = sel(), wasMid = h.startsWith('mid:');
    if (wasMid) {
      const i = +h.slice(4);
      o.points.splice(i + 1, 0, [snap(p.x), snap(p.y)]);
      h = 'pt:' + (i + 1);
      renderWorld();
    }
    drag = { ...base, kind: 'handle', h, moved: wasMid };
    return;
  }
  if (hit) {
    select(hit.id);
    drag = {
      ...base, kind: 'move', orig: JSON.parse(JSON.stringify(hit)),
      owned: scene.objects.filter(q => q.type === 'path' && q.ownerId === hit.id).map(q => ({ q, p: [...q.points[0]] })),
    };
    return;
  }
  drag = { ...base, kind: 'pan', vx: view.x, vy: view.y };
});

svg.addEventListener('pointermove', e => {
  if (placing && !pts.size) { placeAt = toWorld(e); renderWorld(); return; }
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, [e.clientX, e.clientY]);

  if (pinch && pts.size >= 2) {
    const [a, b] = [...pts.values()], r = stageRect();
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    const k = clamp(pinch.v.k * d / pinch.d, 8, 500);
    const wx = (pinch.cx - r.left - pinch.v.x) / pinch.v.k, wy = (pinch.cy - r.top - pinch.v.y) / pinch.v.k;
    view = { k, x: cx - r.left - wx * k, y: cy - r.top - wy * k };
    renderView();
    return;
  }
  if (!drag) return;
  const dxs = e.clientX - drag.sx, dys = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dxs, dys) < 4) return;
  drag.moved = true;
  svg.classList.add('dragging');
  const p = toWorld(e), o = sel();

  switch (drag.kind) {
    case 'pan':
      view = { ...view, x: drag.vx + dxs, y: drag.vy + dys };
      renderView();
      return;

    case 'brush': {
      if (!drag.obj) {
        drag.obj = { id: uid(), type: 'stroke', points: [[r2(drag.p0.x), r2(drag.p0.y)]], color: brush.color, width: brush.width };
        scene.objects.push(drag.obj);
      }
      const last = drag.obj.points[drag.obj.points.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) > 0.02) drag.obj.points.push([Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]);
      break;
    }

    case 'erase':
      eraseAt(p);
      return;

    case 'pen': {
      const r = stageRect();
      drag.pts.push([p.x, p.y]);
      drag.screen.push(`${e.clientX - r.left},${e.clientY - r.top}`);
      ink.setAttribute('points', drag.screen.join(' '));
      return;
    }

    case 'move': {
      const g = drag.orig;
      let dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
      if (o.type === 'wall') {
        dx = snap(g.x1 + dx) - g.x1; dy = snap(g.y1 + dy) - g.y1;
        Object.assign(o, { x1: r2(g.x1 + dx), y1: r2(g.y1 + dy), x2: r2(g.x2 + dx), y2: r2(g.y2 + dy) });
      } else if (o.type === 'path' || o.type === 'stroke') {
        o.points = g.points.map(q => [r2(q[0] + dx), r2(q[1] + dy)]);
      } else {
        o.x = snap(g.x + dx); o.y = snap(g.y + dy);
        for (const { q, p: p0 } of drag.owned) q.points[0] = [r2(p0[0] + o.x - g.x), r2(p0[1] + o.y - g.y)];
      }
      break;
    }

    case 'handle': {
      const h = drag.h;
      if (h === 'rot') {
        const a = Math.atan2(p.y - o.y, p.x - o.x) * 180 / Math.PI;
        o.rot = ((Math.round(a / 5) * 5) % 360 + 360) % 360;
      } else if (h === 'size') {
        const l = toLocal(o, p);
        if (o.type === 'image') { o.w = r2(Math.max(0.5, Math.abs(l.x) * 2)); o.h = r2(o.w * (o.ratio || 1)); }
        else if (hasH(o)) { o.w = Math.max(0.1, snap(Math.abs(l.x) * 2)); o.h = Math.max(0.1, snap(Math.abs(l.y) * 2)); }
        else o.w = Math.max(0.3, snap(Math.abs(alongX(o) ? l.x : l.y) * 2));
      } else if (h === 'p1' || h === 'p2') {
        const s = snapWallPoint(p, o), other = h === 'p1' ? [o.x2, o.y2] : [o.x1, o.y1];
        if (Math.abs(s.x - other[0]) < 0.15) s.x = other[0];
        if (Math.abs(s.y - other[1]) < 0.15) s.y = other[1];
        if (h === 'p1') { o.x1 = s.x; o.y1 = s.y; } else { o.x2 = s.x; o.y2 = s.y; }
      } else if (h.startsWith('pt:')) {
        o.points[+h.slice(3)] = [snap(p.x), snap(p.y)];
      }
      break;
    }

    case 'wall': {
      if (!drag.obj) {
        const s = snapWallPoint(drag.p0);
        drag.obj = { id: uid(), type: 'wall', x1: s.x, y1: s.y, x2: s.x, y2: s.y, thickness: 0.15 };
        scene.objects.push(drag.obj);
        selId = drag.obj.id;
      }
      const w = drag.obj, s = snapWallPoint(p, w);
      if (Math.abs(s.x - w.x1) < 0.15) s.x = w.x1;
      if (Math.abs(s.y - w.y1) < 0.15) s.y = w.y1;
      w.x2 = s.x; w.y2 = s.y;
      break;
    }

    case 'path': {
      if (!drag.obj) {
        const start = drag.owner ? [drag.owner.x, drag.owner.y] : [snap(drag.p0.x), snap(drag.p0.y)];
        drag.obj = { id: uid(), type: 'path', points: [start, start], ...(drag.owner ? { ownerId: drag.owner.id } : {}) };
        scene.objects.push(drag.obj);
        selId = drag.obj.id;
      }
      drag.obj.points[1] = [snap(p.x), snap(p.y)];
      break;
    }
  }
  renderWorld();
});

function endPointer(e) {
  if (!pts.has(e.pointerId)) return;
  pts.delete(e.pointerId);
  if (pinch) { if (pts.size < 2) pinch = null; drag = null; return; }
  if (!drag) return;
  const d = drag;
  drag = null;
  svg.classList.remove('dragging');
  if (d.kind === 'pan') {
    if (!d.moved && d.right && d.hit) openCtx(e.clientX, e.clientY, d.hit);
    else if (!d.moved && !d.right) select(null);
    return;
  }
  if (d.kind === 'erase') { if (d.erased) { commit(); renderAll(); } return; }
  if (d.kind === 'brush') { if (d.obj) { layers.draw = true; commit(); renderWorld(); } return; }
  if (d.kind === 'pen') {
    ink.setAttribute('points', '');
    const what = d.moved ? recognize(d.pts) : '';
    if (what) { layers.set = layers.people = true; commit(); renderAll(); toast(what); }
    return;
  }
  if (d.obj) {
    const o = d.obj;
    const len = o.type === 'wall' ? Math.hypot(o.x2 - o.x1, o.y2 - o.y1) : Math.hypot(o.points[1][0] - o.points[0][0], o.points[1][1] - o.points[0][1]);
    if (len < 0.2) { scene.objects = scene.objects.filter(q => q !== o); selId = null; }
    if (o.type === 'path') setTool('select');
  }
  commit();
  renderWorld();
  renderObjectPane();
  renderShots();
}
svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', endPointer);

svg.addEventListener('wheel', e => {
  if (!active) return;
  e.preventDefault();
  const r = stageRect();
  zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

// своё меню браузера не нужно: правая кнопка двигает доску, а меню объекта открывается по отпусканию без движения
svg.addEventListener('contextmenu', e => { if (active) e.preventDefault(); });

// Ластик стирает рисунки, через которые проходит.
function eraseAt(p) {
  const r = 0.15 + 8 / view.k;
  const before = scene.objects.length;
  scene.objects = scene.objects.filter(o => o.type !== 'stroke' || !o.points.some((q, i) => {
    const a = o.points[i - 1] || q, dx = q[0] - a[0], dy = q[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((p.x - a[0]) * dx + (p.y - a[1]) * dy) / l2, 0, 1) : 0;
    return Math.hypot(p.x - a[0] - t * dx, p.y - a[1] - t * dy) < r + (o.width || 0.05) / 2;
  }));
  if (scene.objects.length !== before) { if (drag) drag.erased++; renderWorld(); }
}

// Панель кисти: цвет и толщина.
const BRUSH_COLORS = ['#E8306C', '#1C2A30', '#1E58B8', '#2F8F6B', '#E9A21B', '#FFFFFF'];
const BRUSH_WIDTHS = [[0.02, 'Тонкая'], [0.05, 'Средняя'], [0.1, 'Толстая'], [0.2, 'Маркер']];
function renderBrushbar() {
  const bar = $('#brushbar');
  bar.classList.toggle('on', tool === 'brush');
  if (tool !== 'brush') return;
  bar.innerHTML = `<div class="swatches">${BRUSH_COLORS.map(c => `<button style="background:${c}" data-bcolor="${c}" aria-pressed="${c === brush.color}" aria-label="Цвет ${c}"></button>`).join('')}
    <label class="bcustom" title="Свой цвет"><input type="color" value="${brush.color}" data-bcolor-pick aria-label="Свой цвет"></label></div>
    <div class="bwidths">${BRUSH_WIDTHS.map(([w, n]) => `<button data-bwidth="${w}" aria-pressed="${w === brush.width}" title="${n}"><i style="height:${Math.max(2, w * 40)}px;background:${brush.color}"></i></button>`).join('')}</div>`;
}
$('#brushbar').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.bcolor) brush.color = b.dataset.bcolor;
  if (b.dataset.bwidth) brush.width = +b.dataset.bwidth;
  renderBrushbar();
});
$('#brushbar').addEventListener('input', e => { if ('bcolorPick' in e.target.dataset) { brush.color = e.target.value; renderBrushbar(); } });

$('#zoom-in').onclick = () => zoomBy(1.4, undefined, undefined, true);
$('#zoom-out').onclick = () => zoomBy(1 / 1.4, undefined, undefined, true);
$('#zoom-fit').onclick = () => (mode3d && v3 ? v3.refit() : fitView(true));
$('#undo').onclick = undo;
$('#redo').onclick = redo;

addEventListener('keydown', e => {
  if (!active) return;
  if (e.key === 'Escape' && placing) { cancelPlacing(); return; }
  if (e.key === 'Escape' && ctx.classList.contains('on')) { closeCtx(); return; }
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
  if (mod && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && e.code === 'KeyY') { e.preventDefault(); redo(); }
  else if (mod && e.code === 'KeyD') { e.preventDefault(); duplicateSelected(); }
  else if (key === 'delete' || key === 'backspace') { e.preventDefault(); removeSelected(); }
  else if (key === 'escape') { tool !== 'select' ? setTool('select') : select(null); }
  else if (key.startsWith('arrow') && sel() && 'x' in sel()) {
    e.preventDefault();
    const o = sel(), s = e.shiftKey ? 0.5 : 0.05;
    moveTo(o, r2(o.x + (key === 'arrowleft' ? -s : key === 'arrowright' ? s : 0)), r2(o.y + (key === 'arrowup' ? -s : key === 'arrowdown' ? s : 0)));
    commit(); renderWorld();
  }
});

// ---------- панель: вкладки ----------

// На телефоне панель выезжает снизу: open раскрывает её, toggle сворачивает по повторному нажатию на ту же вкладку.
function showTab(name, open = false, toggle = false) {
  const panel = $('#panel');
  const current = $('#panel .tabs [aria-selected="true"]').dataset.tab;
  if (toggle && current === name && panel.classList.contains('open')) panel.classList.remove('open');
  else if (open || toggle) panel.classList.add('open');
  $$('#panel .tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === name));
  $$('#panel .pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + name));
}
$('#panel .tabs').addEventListener('click', e => {
  const b = e.target.closest('[role=tab]');
  if (b) showTab(b.dataset.tab, true, true);
});

// ---------- настройки объекта: панель справа и окно по правой кнопке ----------

const opt = (map, cur) => Object.entries(map).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(v.name || v)}</option>`).join('');
const num = (key, label, o, step = 0.05, min = 0, def = 0, max = '') => scrubField(key, label, o[key] ?? def, { step, min, max });
const txt = (key, label, o) => `<label class="field"><span>${label}</span><input type="text" data-key="${key}" value="${esc(o[key] || '')}"></label>`;

function formHTML(o) {
  let f = '';
  switch (o.type) {
    case 'character':
      f = txt('name', 'Имя', o)
        + `<label class="field"><span>Типаж в 3D</span><select data-key="look">${opt(LOOKS, o.look || 'm1')}</select></label>`
        + `<label class="field"><span>Поза</span><select data-key="pose">${opt(POSES, o.pose || 'stand')}</select></label>`
        + `<div class="field"><span>Цвет одежды</span><div class="swatches">${COLORS.map(c =>
          `<button style="background:${c}" data-color="${c}" aria-pressed="${c === o.color}" aria-label="Цвет ${c}"></button>`).join('')}</div></div>`
        + num('height', 'Рост, м', o, 0.01, 1, height3d(o), 2.2);
      break;
    case 'camera':
      f = txt('name', 'Имя', o) + scrubField('lens', 'Объектив, мм', o.lens, { step: 1, min: 8, max: 600 })
        + `<div class="field"><div class="chips">${LENSES.map(l => `<button data-lens="${l}" aria-pressed="${l === o.lens}">${l}</button>`).join('')}</div>
        <small class="fov">Угол по горизонтали ${Math.round(fov(o))}°</small></div>
        <label class="field"><span>Матрица</span><select data-key="sensor">${opt(SENSORS, o.sensor || 's35')}</select></label>`
        + num('height', 'Высота, м', o, 0.05, 0.05, height3d(o), 6) + num('tilt', 'Наклон, °', o, 1, -89, 0, 89);
      break;
    case 'light': {
      const k = LIGHTS[o.kind] || {};
      f = `<label class="field check"><input type="checkbox" data-key="on" ${o.off ? '' : 'checked'}><span>Включён</span></label>`
        + `<label class="field"><span>Тип</span><select data-key="kind">${opt(LIGHTS, o.kind)}</select></label>` + txt('label', 'Подпись', o)
        + (emits(o.kind) ? num('power', 'Яркость, %', o, 5, 5, 100, 800)
          + num('kelvin', 'Цветовая температура, K', o, 50, 1800, defaultKelvin(o.kind), 10000)
          + `<label class="field"><span>Цвет (гель)</span><input type="color" data-key="color" value="${o.color || k.color || LIGHT}"></label>` : '')
        + (k.shape === 'spot' ? num('beam', 'Луч: пятно ↔ заливка, °', o, 1, 8, k.beam, 80) : '')
        + (k.shape === 'spot' || k.shape === 'soft' || k.shape === 'bar' ? num('tilt', 'Наклон вниз, °', o, 1, -30, '', 89) : '')
        + (hasW(o) ? num('w', 'Размер, м', o, 0.05, 0.3) : '')
        + (o.kind === 'sun' ? num('elev', 'Высота солнца, °', o, 1, 3, 40, 88)
          : k.shape === 'glow' && o.kind !== 'china' ? num('height', 'Стоит на высоте, м', o, 0.05, 0, height3d(o), 3)
            : num('height', 'Высота над полом, м', o, 0.05, 0.05, height3d(o), 8));
      break;
    }
    case 'furniture':
      f = `<label class="field"><span>Вид</span><select data-key="kind">${opt(FURN, o.kind)}</select></label>` + txt('label', 'Подпись', o)
        + num('w', 'Длина, м', o, 0.05, 0.1) + num('h', 'Глубина, м', o, 0.05, 0.1);
      break;
    case 'door': case 'window':
      f = num('w', 'Ширина, м', o, 0.05, 0.3);
      break;
    case 'wall':
      f = `<label class="field"><span>Цвет стены</span><input type="color" data-key="color" value="${o.color || scene.wallColor || '#E8E4DC'}"></label>`
        + (o.color ? '<div class="actions"><button class="act" data-act="wall-default">Как у всех стен плана</button></div>' : '')
        + num('thickness', 'Толщина, м', o, 0.01, 0.02) + `<p class="empty">Длина ${r2(Math.hypot(o.x2 - o.x1, o.y2 - o.y1))} м. Концы стены тянутся за кружки.</p>`;
      break;
    case 'path':
      f = `<p class="empty">Тяните кружки, чтобы изменить маршрут. Полупрозрачный кружок посередине добавляет точку.</p>`;
      break;
    case 'text':
      f = `<label class="field"><span>Текст</span><textarea data-key="text" rows="3">${esc(o.text)}</textarea></label>` + num('size', 'Размер букв, м', o, 0.05, 0.1, 0.3, 3);
      break;
    case 'image':
      f = num('opacity', 'Прозрачность', o, 0.05, 0.1, 0.6, 1) + num('w', 'Ширина, м', o, 0.1, 0.5)
        + `<label class="field check"><input type="checkbox" data-key="locked" ${o.locked ? 'checked' : ''}><span>Закрепить, чтобы не сдвигалась</span></label>`;
      break;
  }
  if (canRotate(o)) f += num('rot', 'Поворот, °', o, 5, -360, 0, 360);
  return f + `<div class="actions two"><button class="act" data-act="dup">Дублировать</button><button class="act danger" data-act="del">Удалить</button></div>`;
}

function renderObjectPane() {
  const o = sel();
  $('#pane-object').innerHTML = o ? `<h2>${TITLES[o.type]}</h2>${formHTML(o)}`
    : `<p class="empty">Выберите объект на плане или добавьте новый из палитры. Правая кнопка по объекту открывает меню: движение между фазами, дублировать, удалить. Доску двигают левой или правой кнопкой по пустому месту.</p>`;
}
function refreshForms() {
  renderObjectPane();
  const o = sel();
  if (ctx.classList.contains('on') && ctx.dataset.kind === 'object') { if (o) ctx.innerHTML = `<h2>${TITLES[o.type]}</h2>${formHTML(o)}`; else closeCtx(); }
}

function onFormInput(e) {
  const t = e.target;
  if (t.dataset.layer) { layers[t.dataset.layer] = t.checked; renderWorld(); syncLayersBtn(); return; }
  if (t.dataset.phaseName !== undefined) {
    const ph = scene.phases[+t.dataset.phaseName];
    if (ph && t.value.trim()) { ph.name = t.value.trim(); $$('#phases [data-phase]')[+t.dataset.phaseName].textContent = ph.name; renderShots(); }
    return;
  }
  const o = sel(), key = t.dataset.key;
  if (!o || !key) return;
  let v = t.type === 'checkbox' ? t.checked : t.type === 'number' || t.type === 'range' ? parseFloat(t.value) : t.value;
  if (typeof v === 'number' && isNaN(v)) return;
  if (key === 'lens') v = clamp(v, 8, 600);
  if (key === 'on') { if (v) delete o.off; else o.off = true; renderWorld(); renderShots(); return; }
  if (key === 'kelvin') o.color = kelvinToHex(v); // температура задаёт цвет, гель потом можно подобрать вручную
  o[key] = v;
  if (key === 'kind') {
    const d = (o.type === 'light' ? LIGHTS : FURN)[v];
    if (d.w) o.w = d.w; else delete o.w;
    if (d.h) o.h = d.h;
    if (o.type === 'light') { if (emits(v)) o.color = d.color || LIGHT; else delete o.color; delete o.height; }
    refreshForms();
  }
  if (o.type === 'image' && key === 'w') o.h = r2(o.w * (o.ratio || 1));
  if (o.type === 'image' && key === 'locked' && v) { commit(); closeCtx(); select(null); renderPlanPane(); return; }
  if (key === 'lens' || key === 'sensor') {
    $$('.fov').forEach(el => { el.textContent = `Угол по горизонтали ${Math.round(fov(o))}°`; });
    $$('[data-lens]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.lens === o.lens));
  }
  renderWorld();
  if (o.type === 'camera') renderShots();
}
function onFormClick(e) {
  const o = sel(), b = e.target.closest('button');
  if (!o || !b) return;
  if (b.dataset.color) { o.color = b.dataset.color; commit(); renderWorld(); refreshForms(); }
  else if (b.dataset.lens) { o.lens = +b.dataset.lens; commit(); renderWorld(); refreshForms(); renderShots(); }
  else if (b.dataset.act === 'dup') duplicateSelected();
  else if (b.dataset.act === 'del') removeSelected();
  else if (b.dataset.act === 'wall-default') { delete o.color; commit(); renderWorld(); refreshForms(); }
}
for (const el of [$('#pane-object'), ctx]) {
  el.addEventListener('input', onFormInput);
  el.addEventListener('change', () => commit());
  el.addEventListener('click', onFormClick);
}

function placeCtx(x, y) {
  ctx.classList.add('on');
  ctx.style.left = clamp(x + 6, 8, innerWidth - ctx.offsetWidth - 8) + 'px';
  ctx.style.top = clamp(y + 6, 8, innerHeight - ctx.offsetHeight - 8) + 'px';
}
function openCtx(x, y, id) {
  selId = null;
  select(id);
  const o = sel();
  if (!o) return;
  const k = o.type === 'light' ? LIGHTS[o.kind] || {} : null;
  const next = scene.phases[scene.phase + 1], prev = scene.phases[scene.phase - 1];
  const item = (act, text, sub = '') => `<button data-menu="${act}">${text}${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
  ctx.dataset.kind = 'menu';
  ctx.innerHTML = `<h2>${esc(caption(o) || TITLES[o.type])}</h2><div class="menu">`
    + (PHASED(o) ? item('next', 'Движение к следующей фазе', next ? `куда пойдёт в «${next.name}»` : 'будет создана новая фаза')
      + item('prev', 'Движение к предыдущей фазе', prev ? `откуда пришёл в «${prev.name}»` : 'будет создана фаза перед этой') : '')
    + (o.type === 'light' && emits(o.kind) ? item('toggle', o.off ? 'Включить' : 'Выключить') : '')
    + (o.type === 'camera' ? item('look', 'Смотреть через эту камеру') : '')
    + item('settings', 'Настройки справа')
    + item('dup', 'Дублировать') + item('del', 'Удалить')
    + '</div>';
  placeCtx(x, y);
}
ctx.addEventListener('click', async e => {
  const b = e.target.closest('[data-menu]');
  if (!b || ctx.dataset.kind !== 'menu') return;
  const o = sel();
  if (!o) return closeCtx();
  const act = b.dataset.menu;
  if (act === 'next' || act === 'prev') return startPlacing(o.id, act === 'next' ? 1 : -1);
  closeCtx();
  if (act === 'toggle') { if (o.off) delete o.off; else o.off = true; commit(); renderWorld(); refreshForms(); renderCamBar(); }
  if (act === 'look') { await setMode(true); v3.setCamera(o.id); renderCamBar(); }
  if (act === 'settings') showTab('object', true);
  if (act === 'dup') duplicateSelected();
  if (act === 'del') removeSelected();
});
function openLayers(x, y) {
  ctx.dataset.kind = 'layers';
  ctx.innerHTML = `<h2>Слои</h2>${Object.entries(LAYERS).map(([k, name]) =>
    `<label class="field check"><input type="checkbox" data-layer="${k}" ${layers[k] ? 'checked' : ''}><span>${name}</span></label>`).join('')}
    <p class="empty">Скрытый слой не виден на плане и не мешает выбирать остальное.</p>`;
  placeCtx(x, y);
}
function closeCtx() { ctx.classList.remove('on'); }
function syncLayersBtn() { $('#layers-btn').classList.toggle('warn', Object.values(layers).some(v => !v)); }
document.addEventListener('pointerdown', e => {
  if (ctx.classList.contains('on') && !ctx.contains(e.target) && !e.target.closest('#layers-btn, #phases-btn')) closeCtx();
}, true);
$('#layers-btn').addEventListener('click', e => {
  if (ctx.classList.contains('on') && ctx.dataset.kind === 'layers') return closeCtx();
  const r = e.currentTarget.getBoundingClientRect();
  openLayers(r.left - 6, r.bottom);
});

// ---------- панель: кадры этого плана (общие с режиссёрским сценарием) ----------

const cameras = () => scene.objects.filter(o => o.type === 'camera');
const planShots = () => project().shots.filter(s => s.planId === scene.id);
const ICON = {
  up: '<svg viewBox="0 0 24 24"><path d="M6 14l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M6 10l6 6 6-6"/></svg>',
  del: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

function renderShots() {
  const el = $('#pane-shots'), cams = cameras(), shots = planShots(), nums = numbering(project()), many = scene.phases.length > 1;
  const list = shots.map((s, i) => `<li class="shot${s.cameraId && s.cameraId === selId ? ' hot' : ''}" data-id="${s.id}">
    <button class="num" data-act="go" title="Показать камеру на плане">${nums.get(s.id)}</button>
    <select data-key="cameraId" class="wide" aria-label="Камера"><option value="">Камера не выбрана</option>${cams.map(c =>
      `<option value="${c.id}"${c.id === s.cameraId ? ' selected' : ''}>${esc(caption(c))}</option>`).join('')}</select>
    ${many ? `<select data-key="phaseId" class="wide" aria-label="Фаза"><option value="">Фаза не указана</option>${scene.phases.map(ph =>
      `<option value="${ph.id}"${ph.id === s.phaseId ? ' selected' : ''}>${esc(ph.name)}</option>`).join('')}</select>` : ''}
    <select data-key="size" aria-label="Крупность">${SIZES.map(v => `<option${v === s.size ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <select data-key="move" aria-label="Движение камеры">${MOVES.map(v => `<option${v === s.move ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <textarea data-key="content" placeholder="Что происходит в кадре">${esc(s.content)}</textarea>
    <div class="shot-tools">
      <button class="ico" data-act="up" aria-label="Выше" title="Выше"${i ? '' : ' disabled'}>${ICON.up}</button>
      <button class="ico" data-act="down" aria-label="Ниже" title="Ниже"${i < shots.length - 1 ? '' : ' disabled'}>${ICON.down}</button>
      <button class="ico" data-act="del" aria-label="Убрать кадр" title="Убрать кадр">${ICON.del}</button>
    </div></li>`).join('');
  const empty = shots.length ? '' : `<p class="empty">${cams.length
    ? 'Кадров на этом плане пока нет. Добавьте первый и выберите для него камеру.'
    : 'Поставьте на план камеру, потом добавляйте кадры. Они сразу появятся в режиссёрском сценарии.'}</p>`;
  el.innerHTML = `<h2>Кадры на этом плане</h2>${empty}<ul class="shots">${list}</ul><div class="actions"><button class="act main" id="add-shot">Добавить кадр</button></div>`;
}

$('#pane-shots').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const all = project().shots;
  if (b.id === 'add-shot') {
    const cur = sel(), cams = cameras();
    all.push({ id: uid(), sceneId: scene.sceneId || '', planId: scene.id, cameraId: cur && cur.type === 'camera' ? cur.id : (cams[0] || {}).id || '',
      phaseId: scene.phases.length > 1 ? scene.phases[scene.phase].id : '',
      size: SIZES[2], move: MOVES[0], content: '', note: '', mode: '', dur: '', chars: '', props: '', tech: '', frame: '' });
    store.touch(); renderShots();
    const last = $('#pane-shots .shot:last-child textarea');
    last.scrollIntoView({ block: 'nearest', behavior: reduced.matches ? 'auto' : 'smooth' });
    last.focus({ preventScroll: true });
    return;
  }
  const li = b.closest('.shot'), s = all.find(x => x.id === li.dataset.id), mine = planShots(), i = mine.indexOf(s);
  const swap = (a, c) => { const ia = all.indexOf(a), ic = all.indexOf(c); [all[ia], all[ic]] = [all[ic], all[ia]]; };
  if (b.dataset.act === 'go' && s.cameraId) {
    const pi = scene.phases.findIndex(ph => ph.id === s.phaseId);
    if (pi >= 0 && pi !== scene.phase) { loadPhase(pi); commit(); renderAll(); }
    selId = null; select(s.cameraId); showTab('shots');
  }
  if (b.dataset.act === 'del') {
    if (!confirm('Убрать этот кадр? Он исчезнет и из режиссёрского сценария.')) return;
    all.splice(all.indexOf(s), 1); store.touch(); renderShots();
  }
  if (b.dataset.act === 'up' && i > 0) { swap(s, mine[i - 1]); store.touch(); renderShots(); }
  if (b.dataset.act === 'down' && i < mine.length - 1) { swap(s, mine[i + 1]); store.touch(); renderShots(); }
});
$('#pane-shots').addEventListener('input', e => {
  const li = e.target.closest('.shot'), key = e.target.dataset.key;
  if (!li || !key) return;
  project().shots.find(x => x.id === li.dataset.id)[key] = e.target.value;
  store.touch();
});

// ---------- панель: план ----------

function renderPlanPane() {
  const locked = scene.objects.filter(o => o.type === 'image' && o.locked);
  const scenes = scenesOf(project());
  $('#pane-scene').innerHTML = `
    <label class="field"><span>Название плана</span><input type="text" data-key="name" value="${esc(scene.name)}"></label>
    <label class="field"><span>Сцена из сценария</span><select data-key="sceneId"><option value="">Не привязан</option>${scenes.map((s, i) =>
      `<option value="${s.id}"${s.id === scene.sceneId ? ' selected' : ''}>${i + 1}. ${esc(s.text)}</option>`).join('')}</select>
      <small>${scenes.length ? 'Новые кадры этого плана попадут в эту сцену режиссёрского сценария.' : 'Сцены появятся здесь, когда в сценарии будут строки «Время и место».'}</small></label>
    ${scrubField('wallHeight', 'Высота стен в 3D, м', scene.wallHeight ?? 2.7, { step: 0.05, min: 0.3, max: 12 })}
    <div class="pair"><label class="field"><span>Цвет стен</span><input type="color" data-key="wallColor" value="${scene.wallColor || '#E8E4DC'}"></label>
    <label class="field"><span>Цвет пола</span><input type="color" data-key="floorColor" value="${scene.floorColor || '#FFFFFF'}"></label></div>
    <small class="field-note">Цвет стен влияет на отражённый свет: от белых стен в комнате светлее, от тёмных темнее.</small>
    <label class="field"><span>Заметки</span><textarea data-key="note" rows="3">${esc(scene.note)}</textarea></label>
    ${locked.length ? `<div class="actions"><button class="act" data-act="unlock">Открепить фото-подложку</button></div>` : ''}
    <p class="sub">Выгрузить</p>
    <div class="actions">
      <button class="act main" data-act="print">Печать или PDF</button>
      <button class="act" data-act="png">План картинкой PNG</button>
    </div>
    <p class="sub">План</p>
    <div class="actions two">
      <button class="act" data-act="copy">Дублировать</button>
      <button class="act danger" data-act="remove">Удалить план</button>
    </div>`;
}
$('#pane-scene').addEventListener('input', e => {
  const key = e.target.dataset.key;
  if (!key) return;
  if (key === 'wallHeight') { const v = parseFloat(e.target.value); if (v > 0) { scene.wallHeight = v; sync3d(); } }
  else if (key === 'wallColor' || key === 'floorColor') { scene[key] = e.target.value; renderWorld(); }
  else scene[key] = e.target.value;
});
$('#pane-scene').addEventListener('change', e => {
  commit();
  if (e.target.dataset.key === 'name') $('#scene-select').selectedOptions[0].textContent = scene.name;
});
$('#pane-scene').addEventListener('click', async e => {
  const act = (e.target.closest('button') || {}).dataset?.act;
  if (!act) return;
  if (act === 'print') printHTML(`<h1>${esc(scene.name)}</h1>${scene.note ? `<p>${esc(scene.note)}</p>` : ''}${planSVG(scene, { pad: 1 })}`, 'size: A4 landscape; margin: 12mm;', safeName(scene.name));
  if (act === 'png') exportPNG();
  if (act === 'copy') { const c = JSON.parse(JSON.stringify(scene)); c.name += ', копия'; goto(createPlan(c)); toast('Создана копия плана'); }
  if (act === 'unlock') { scene.objects.forEach(o => { if (o.type === 'image') o.locked = false; }); commit(); renderAll(); toast('Подложку снова можно двигать'); }
  if (act === 'remove') {
    const n = planShots().length;
    if (!confirm(`Удалить план «${scene.name}»?${n ? ` Его кадры (${n}) останутся в режиссёрском сценарии без плана.` : ''}`)) return;
    const p = project();
    p.shots.forEach(s => { if (s.planId === scene.id) { s.planId = ''; s.cameraId = ''; s.phaseId = ''; } });
    p.plans = p.plans.filter(x => x.id !== scene.id);
    store.touch();
    location.hash = `#/p/${p.id}`;
    toast('План удалён');
  }
});

async function exportPNG() {
  const b = bounds(scene), pad = 1, w0 = b.w + pad * 2, h0 = b.h + pad * 2;
  const ppm = Math.min(220, 4200 / Math.max(w0, h0));
  const w = Math.round(w0 * ppm), h = Math.round(h0 * ppm);
  let markup = planSVG(scene, { pad, attrs: `width="${w}" height="${h}"` })
    .replace('</svg>', `<defs>${gridPattern('', 'g2')}</defs><rect x="${b.x - pad}" y="${b.y - pad}" width="${w0}" height="${h0}" fill="url(#g2)" pointer-events="none"/></svg>`);
  // картинки-подложки встраиваем внутрь, иначе браузер не нарисует их в PNG
  for (const o of scene.objects.filter(q => q.type === 'image' && !q.src.startsWith('data:'))) {
    try {
      const blob = await (await fetch(srcOf(o.src))).blob();
      const data = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      markup = markup.split(`href="${esc(srcOf(o.src))}"`).join(`href="${data}"`);
    } catch { /* подложка просто не попадёт в картинку */ }
  }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = PAPER; g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    c.toBlob(blob => download(blob, safeName(scene.name) + '.png'), 'image/png');
  };
  img.onerror = () => toast('Не получилось собрать картинку');
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
}

// ---------- 3D-вид ----------

const hooks3d = {
  onChange: () => renderCamBar(),
  onSelect: id => { selId = null; select(id); },
  onMove(id, x, y) {
    const o = scene.objects.find(q => q.id === id);
    if (!o || !('x' in o)) return;
    moveTo(o, snap(x), snap(y));
    renderWorld();
  },
  onRotate(id, deg) {
    const o = scene.objects.find(q => q.id === id);
    if (!o || !canRotate(o)) return;
    o.rot = (((o.rot || 0) + deg) % 360 + 360) % 360;
    renderWorld();
  },
  onMoveEnd() { commit(); refreshForms(); },
  onContext: (id, x, y) => openCtx(x, y, id),
};

async function setMode(on) {
  if (on && !v3) {
    try { v3 = (await import('./view3d.js')).create3D($('#stage3d'), hooks3d); }
    catch (err) { console.error(err); toast('3D не запустился на этом устройстве'); on = false; }
  }
  mode3d = on;
  $$('#mode [data-mode]').forEach(b => b.setAttribute('aria-selected', (b.dataset.mode === '3d') === on));
  $('#stage').classList.toggle('is3d', on);
  if (on) { if (tool !== 'select') setTool('select'); v3.update(scene); renderCamBar(); }
}

function sync3d() {
  if (!mode3d || !v3 || !active) return;
  cancelAnimationFrame(v3frame);
  v3frame = requestAnimationFrame(() => { v3.update(scene); renderCamBar(); });
}

// Нижняя полоса 3D: камеры, быстрый выбор оптики и выключатели света.
function renderCamBar() {
  if (!v3) return;
  if (document.activeElement && document.activeElement.closest('#cam-bar select')) return;
  const cams = cameras(), cur = v3.cameraId, nums = numbering(project());
  const cam = cams.find(c => c.id === cur);
  const shots = cur ? planShots().filter(s => s.cameraId === cur) : [];
  if (!shots.some(s => s.id === snapShot)) snapShot = (shots.find(s => !s.frame) || shots[0] || {}).id || '';
  const lamps = scene.objects.filter(o => o.type === 'light' && emits(o.kind));
  $('#cam-bar').innerHTML =
    (lamps.length ? `<div class="cam-chips" aria-label="Свет">${lamps.map(l => `<button data-lamp="${l.id}" aria-pressed="${!l.off}" title="Включить или выключить">
      <i style="background:${l.color || LIGHT}"></i>${esc(l.label || LIGHTS[l.kind].name)}</button>`).join('')}</div>` : '')
    + (cam ? `<div class="cam-chips" aria-label="Объектив">${LENSES.map(l => `<button data-qlens="${l}" aria-pressed="${l === cam.lens}">${l}</button>`).join('')}</div>` : '')
    + `<div class="cam-chips"><button data-cam="" aria-pressed="${!cur}">Облёт</button>${cams.map(c =>
      `<button data-cam="${c.id}" aria-pressed="${c.id === cur}">${esc(caption(c))}</button>`).join('')}</div>`
    + (cur ? `<div class="cam-snap">${shots.length > 1 ? `<select id="snap-shot" aria-label="Кадр">${shots.map(s => `<option value="${s.id}"${s.id === snapShot ? ' selected' : ''}>Кадр ${nums.get(s.id)}</option>`).join('')}</select>` : ''}
      <button id="snap">Кадр в раскадровку</button></div>` : cams.length ? '' : '<p class="cam-tip">Поставьте на план камеру, чтобы посмотреть её глазами.</p>');
}

$('#mode').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (b) setMode(b.dataset.mode === '3d');
});
$('#cam-bar').addEventListener('change', e => { if (e.target.id === 'snap-shot') { snapShot = e.target.value; e.target.blur(); } });
$('#cam-bar').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.lamp) {
    const l = scene.objects.find(o => o.id === b.dataset.lamp);
    if (l.off) delete l.off; else l.off = true;
    commit(); renderWorld(); refreshForms(); renderCamBar();
    return;
  }
  if (b.dataset.qlens) {
    const cam = scene.objects.find(o => o.id === v3.cameraId);
    if (cam) { cam.lens = +b.dataset.qlens; commit(); renderWorld(); refreshForms(); renderShots(); renderCamBar(); }
    return;
  }
  if (b.dataset.cam !== undefined) {
    v3.setCamera(b.dataset.cam);
    if (b.dataset.cam) { selId = null; select(b.dataset.cam); }
    renderCamBar();
    return;
  }
  if (b.id !== 'snap') return;
  const cam = v3.cameraId, shots = planShots().filter(s => s.cameraId === cam);
  if (!shots.length) { showTab('shots', true); return toast('Сначала добавьте кадр с этой камерой во вкладке «Кадры»'); }
  const s = shots.find(x => x.id === snapShot) || shots[0], n = numbering(project()).get(s.id);
  if (s.frame && !confirm(`У кадра ${n} уже есть картинка в раскадровке. Заменить её?`)) return;
  try {
    const blob = await v3.snapshot();
    s.frame = await storage.putAsset(`frame-${Date.now().toString(36)}${uid()}.jpg`, blob, store.project.id);
    store.touch();
    renderCamBar();
    toast(`Кадр ${n} добавлен в раскадровку режиссёрского сценария`);
  } catch { toast('Не получилось сохранить кадр'); }
});

// ---------- верхняя полоса плана ----------

$('#scene-select').addEventListener('change', e => goto(e.target.value));
$('#new-scene').addEventListener('click', () => goto(createPlan()));
new ResizeObserver(() => active && scene && renderView()).observe(svg);
buildPalette();
