// Интерьер локации: стены, двери, окна, мебель и подложка, которые повторяются во всех мизансценах этой локации.
// Первый план локации с обстановкой становится её базой (l.interior); новый план локации получает её сразу.
// Базу можно перезаписать из любого плана — в мизансцене или на странице локации.
import { uid } from './store.js';

export const ENV = o => ['wall', 'door', 'window', 'furniture', 'image'].includes(o.type);
export const hasEnv = plan => !!plan && plan.objects.some(o => o.type === 'wall' || o.type === 'furniture');
const clone = x => JSON.parse(JSON.stringify(x));

// локация плана: выбранная в плане, иначе та, к которой привязана его сцена
export function locOfPlan(p, plan) {
  if (!plan) return null;
  return p.locations.find(l => l.id === plan.locationId) || (!plan.locationId && plan.sceneId && p.locations.find(l => l.sceneIds.includes(plan.sceneId))) || null;
}
const planOfLoc = (p, l, plan) => plan.locationId === l.id || (!plan.locationId && plan.sceneId && l.sceneIds.includes(plan.sceneId));

// база локации; у старых проектов её ещё нет — тогда первый план этой локации с обстановкой
// становится базой (и запоминается)
export function baseOf(p, l, exceptPlanId = '') {
  if (!l) return null;
  if (l.interior && Array.isArray(l.interior.objects)) return l.interior;
  const src = p.plans.find(pl => pl.id !== exceptPlanId && planOfLoc(p, l, pl) && hasEnv(pl));
  if (!src) return null;
  saveBase(l, src);
  return l.interior;
}

export function saveBase(l, plan) {
  l.interior = {
    objects: plan.objects.filter(ENV).map(o => { const c = clone(o); delete c.phased; return c; }),
    wallColor: plan.wallColor || '', floorColor: plan.floorColor || '', wallHeight: plan.wallHeight ?? 2.7,
    from: plan.name, planId: plan.id, at: Date.now(),
  };
  return l.interior;
}

// заменяет обстановку плана базовой; камеры, люди, свет, движение и заметки остаются
export function applyBase(plan, base) {
  const gone = new Set(plan.objects.filter(ENV).map(o => o.id));
  plan.objects = plan.objects.filter(o => !gone.has(o.id));
  for (const ph of plan.phases || []) for (const id of gone) delete ph.pos[id];
  const add = base.objects.map(o => ({ ...clone(o), id: uid() }));
  // обстановка встаёт под людей и камеры
  plan.objects.unshift(...add);
  if (base.wallColor) plan.wallColor = base.wallColor;
  if (base.floorColor) plan.floorColor = base.floorColor;
  if (base.wallHeight) plan.wallHeight = base.wallHeight;
  return add.length;
}

export const baseCount = base => base ? base.objects.filter(o => o.type !== 'image').length : 0;

// План — в сцену. locId: локация, где это сделали (страница локации). Без неё план получает локацию сцены,
// а если у плана уже есть локация, а у сцены нет — сцена привязывается к локации плана.
export function bindPlan(p, pl, sceneId, locId = '') {
  pl.sceneId = sceneId;
  const sceneLoc = p.locations.find(l => l.sceneIds.includes(sceneId));
  if (locId) pl.locationId = locId;
  else if (!pl.locationId && sceneLoc) pl.locationId = sceneLoc.id;
  const l = p.locations.find(x => x.id === pl.locationId);
  if (l && !l.sceneIds.includes(sceneId) && (!sceneLoc || locId)) l.sceneIds.push(sceneId);
}
