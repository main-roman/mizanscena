// Трёхмерный вид плана: та же сцена, что в Shot Designer, поднятая в объём.
// Оси: X плана = X сцены, Y плана = Z сцены, вверх = Y. Метр равен единице.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { GLTFLoader } from './vendor/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from './vendor/utils/SkeletonUtils.js';
import { mergeVertices } from './vendor/utils/BufferGeometryUtils.js';
import { HDRLoader } from './vendor/jsm/loaders/HDRLoader.js';
import { fov, bounds, height3d, LIGHTS, LIGHT, COLORS, CAM, LOOKS } from './shapes.js';

const rad = d => d * Math.PI / 180;
const ASPECT = 16 / 9;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));

const mats = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts }));
  return mats.get(key);
}
const WOOD = '#A9794C', WHITE = '#E9E7E1', DARK = '#2B3338', METAL = '#8D979B', FABRIC = '#6F8296', GREEN = '#5E9A62';

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
// коробка: w вдоль X, h вверх, d вдоль Z; y задаёт низ
const box = (w, h, d, x, y, z, material) => mesh(new THREE.BoxGeometry(w, h, d), material, x, y + h / 2, z);
const cyl = (r, h, x, y, z, material, seg = 20) => mesh(new THREE.CylinderGeometry(r, r, h, seg), material, x, y + h / 2, z);
// «кость»: скруглённый цилиндр от точки до точки
function limb(a, b, r, material) {
  const d = b.clone().sub(a), len = d.length();
  const m = mesh(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 5, 12), material);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
  return m;
}

function legs(g, w, d, h, t = 0.05, material = mat(WOOD)) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(t, h, t, sx * (w / 2 - t), 0, sz * (d / 2 - t), material));
}

// ---------- человек: готовая модель из public/models (Quaternius, CC0); пока она грузится, стоит манекен ----------
// Все модели на одном скелете, поэтому поза «сидит» ставится одинаково: бёдра вперёд, голени вниз.
const models = {};
let onModelReady = () => {};
const TOP = { m1: 'Red_Dark', m2: 'Purple', m3: 'Tie', f1: 'Orange', f2: 'White', f3: 'Worker_Vest' }; // материал, который красится в цвет персонажа

// Сглаживание: нормали усредняются по точкам с одинаковым положением, даже если вершины
// разрезаны швами цвета или развёртки (поэтому прежнее сшивание вершин не срабатывало).
function smoothNormals(geo) {
  const pos = geo.attributes.position, idx = geo.index, acc = new Map(), keys = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) keys[i] = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const tri = idx ? idx.count / 3 : pos.count / 3;
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    n.subVectors(c, b).cross(a.sub(b)); // длина пропорциональна площади грани: большие грани весят больше
    for (const i of [i0, i1, i2]) { const v = acc.get(keys[i]); if (v) v.add(n); else acc.set(keys[i], n.clone()); }
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const v = acc.get(keys[i]); if (!v) continue; const l = v.length() || 1; out[i * 3] = v.x / l; out[i * 3 + 1] = v.y / l; out[i * 3 + 2] = v.z / l; }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
}

function loadModel(look) {
  if (models[look]) return;
  models[look] = { state: 'loading' };
  const scan = !!LOOKS[look].scan;
  new GLTFLoader().load('models/' + (LOOKS[look].file || look + '.glb'), g => {
    // низкополигональные модели с гранёной заливкой сглаживаем, чтобы тело читалось объёмом, а не гранями; у сканов нормали и так хорошие
    g.scene.traverse(n => { if (!n.isMesh) return; if (!scan) smoothNormals(n.geometry); if (scan) return; if (n.material) for (const m of [].concat(n.material)) { m.flatShading = false; m.roughness = Math.max(m.roughness, 0.75); m.metalness = 0; } });
    models[look] = { state: 'ready', scene: g.scene, clips: g.animations }; onModelReady();
  },
    undefined, () => { models[look] = { state: 'failed' }; });
}

// Поворачивает кость так, чтобы она смотрела на своего потомка в заданном направлении (в осях модели).
function aimBone(bone, child, dir) {
  bone.updateWorldMatrix(true, true);
  const a = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld), b = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld);
  const q = new THREE.Quaternion().setFromUnitVectors(b.sub(a).normalize(), dir.clone().normalize());
  const world = bone.getWorldQuaternion(new THREE.Quaternion()), parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parent.invert().multiply(q).multiply(world));
  bone.updateWorldMatrix(false, true);
}

// Сканы Renderpeople приходят в позе «руки в стороны»: опускаем руки, а для позы «сидит» сгибаем ноги и кладём руки на колени.
// Имена костей у них вида upperarm_l_024, поэтому ищем по началу имени.
function scanBone(obj, prefix) {
  let b = null;
  obj.traverse(n => { if (!b && n.isBone && n.name.startsWith(prefix)) b = n; });
  return b;
}
function poseScan(obj, sit) {
  obj.updateMatrixWorld(true);
  const hip = scanBone(obj, 'hip_'), hx = hip ? new THREE.Vector3().setFromMatrixPosition(hip.matrixWorld).x : 0;
  for (const side of ['l', 'r']) {
    const up = scanBone(obj, `upperarm_${side}_`), low = scanBone(obj, `lowerarm_${side}_`), hand = scanBone(obj, `hand_${side}_`);
    if (up && low && hand) {
      const out = Math.sign(new THREE.Vector3().setFromMatrixPosition(low.matrixWorld).x - hx) || 1; // в какую сторону от тела эта рука
      aimBone(up, low, new THREE.Vector3(out * 0.12, -1, sit ? 0.35 : 0.04));
      aimBone(low, hand, sit ? new THREE.Vector3(out * 0.05, -0.35, 1) : new THREE.Vector3(out * 0.04, -1, 0.12));
    }
    if (!sit) continue;
    const thigh = scanBone(obj, `upperleg_${side}_`), shin = scanBone(obj, `lowerleg_${side}_`), foot = scanBone(obj, `foot_${side}_`);
    if (thigh && shin && foot) {
      aimBone(thigh, shin, new THREE.Vector3(0, -0.06, 1));
      aimBone(shin, foot, new THREE.Vector3(0, -1, 0.06));
    }
  }
}

function modelPerson(o) {
  const look = LOOKS[o.look] ? o.look : 'm1', m = models[look];
  if (!m) { loadModel(look); return null; }
  if (m.state !== 'ready') return null;
  const f = LOOKS[look].sex === 'f', h = +o.height || (f ? 1.66 : 1.78);
  const obj = cloneSkinned(m.scene);
  const clip = m.clips.find(c => /Idle_Neutral$/.test(c.name)) || m.clips.find(c => /Idle$/.test(c.name));
  if (clip) { const mixer = new THREE.AnimationMixer(obj); mixer.clipAction(clip).play(); mixer.setTime(0.02); }
  obj.traverse(n => {
    if (!n.isMesh) return;
    n.castShadow = true; n.receiveShadow = true; n.frustumCulled = false;
    const paint = x => { if (x.name !== TOP[look] || !o.color) return x; const c = x.clone(); c.color.set(o.color); return c; };
    n.material = Array.isArray(n.material) ? n.material.map(paint) : paint(n.material);
  });
  const g = new THREE.Group();
  g.add(obj);
  const size = () => { obj.updateMatrixWorld(true); return new THREE.Box3().setFromObject(obj, true); };
  let box0 = size();
  const s = h / Math.max(0.01, box0.max.y - box0.min.y);
  obj.scale.multiplyScalar(s);
  if (LOOKS[look].scan) poseScan(obj, o.pose === 'sit');
  else if (o.pose === 'sit') {
    for (const side of ['L', 'R']) {
      const up = obj.getObjectByName('UpperLeg' + side), low = obj.getObjectByName('LowerLeg' + side), foot = obj.getObjectByName('Foot' + side);
      if (!up || !low) continue;
      aimBone(up, low, new THREE.Vector3(0, -0.06, 1));
      const end = obj.getObjectByName('LowerLeg' + side + '_end');
      if (!end) continue;
      aimBone(low, end, new THREE.Vector3(0, -1, 0.06));
      // ступня в этом скелете не привязана к голени, поэтому переносим её под колено вручную
      if (foot) { obj.updateMatrixWorld(true); foot.position.copy(foot.parent.worldToLocal(new THREE.Vector3().setFromMatrixPosition(end.matrixWorld))); }
    }
  }
  box0 = size();
  obj.position.y -= box0.min.y; // ступни на полу
  obj.rotation.y = Math.PI / 2; // модель смотрит вдоль +Z, а персонаж плана вдоль +X
  g.userData.top = box0.max.y - box0.min.y + 0.1;
  return g;
}

const personCache = new Map();
// Модель персонажа пересобирается только когда меняются типаж, поза, рост или цвет, а не при каждом сдвиге.
function person(o, cacheId) {
  const key = [o.look, o.pose, o.height, o.color].join('|');
  const hit = cacheId && personCache.get(cacheId);
  if (hit && hit.key === key) return hit.group;
  const g = modelPerson(o);
  if (!g) return mannequin(o);
  if (cacheId) personCache.set(cacheId, { key, group: g });
  return g;
}

// ---------- манекен с пропорциями, типажом и позой. Смотрит вдоль +X ----------
function mannequin(o) {
  const look = LOOKS[o.look] || LOOKS.m1, f = look.sex === 'f';
  const h = +o.height || (f ? 1.66 : 1.78), sit = o.pose === 'sit';
  const g = new THREE.Group();
  const skin = mat(look.skin, { roughness: 0.7 }), top = mat(o.color || COLORS[0], { roughness: 0.9 });
  const bottom = mat(f ? '#3B4250' : '#2F3640', { roughness: 0.95 }), shoe = mat('#1E1E20', { roughness: 0.6 }), hair = mat(look.hairColor, { roughness: 0.95 });
  const k = h / 1.75, heavy = look.heavy ? 1.15 : 1;
  const legL = 0.47 * h, hipW = (f ? 0.19 : 0.17) * k * heavy, shW = (f ? 0.36 : 0.43) * k * heavy;
  const hipY = sit ? 0.47 : legL, shY = hipY + 0.335 * h, headY = shY + 0.125 * h;
  const thigh = legL * 0.52;

  for (const s of [-1, 1]) { // ноги
    const z = s * hipW * 0.5, hip = V(0, hipY, z);
    const knee = sit ? V(thigh, hipY + 0.01, z) : V(0.01, hipY - thigh, z);
    const ankle = sit ? V(thigh + 0.03, 0.08, z) : V(0, 0.08, z);
    g.add(limb(hip, knee, 0.075 * k * heavy, look.dress ? skin : bottom));
    g.add(limb(knee, ankle, 0.055 * k, look.dress ? skin : bottom));
    g.add(box(0.24 * k, 0.07, 0.09 * k, ankle.x + 0.05, 0, z, shoe));
  }
  // таз и торс
  const pelvis = mesh(new THREE.SphereGeometry(1, 16, 12), look.dress ? top : bottom, 0, hipY + 0.03, 0);
  pelvis.scale.set(0.12 * k * heavy, 0.11 * k, hipW * 0.95);
  g.add(pelvis);
  if (look.dress) {
    const skirt = mesh(new THREE.CylinderGeometry(hipW * 0.95, hipW * 1.45, sit ? 0.3 : 0.5 * k, 20, 1, true), mat(o.color || COLORS[0], { roughness: 0.9, side: THREE.DoubleSide }));
    if (sit) { skirt.rotation.z = -Math.PI / 2 + 0.25; skirt.position.set(0.16, hipY, 0); } else skirt.position.set(0, hipY - 0.2 * k, 0);
    skirt.scale.x = 0.75;
    g.add(skirt);
  }
  const torso = mesh(new THREE.CylinderGeometry(shW * 0.46, hipW * (f ? 0.78 : 0.92) * heavy, shY - hipY, 18), top, 0, (shY + hipY) / 2, 0);
  torso.scale.x = (f ? 0.56 : 0.6) * heavy;
  g.add(torso);
  const sh = mesh(new THREE.SphereGeometry(1, 16, 10), top, 0, shY - 0.02, 0);
  sh.scale.set(0.105 * k * heavy, 0.075 * k, shW * 0.5);
  g.add(sh);
  if (f) for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.062 * k, 12, 10), top, 0.085 * k, shY - 0.15 * k, s * 0.075 * k));
  for (const s of [-1, 1]) { // руки
    const z = s * shW * 0.5, a = V(0, shY - 0.03, z);
    const elbow = sit ? V(0.1, shY - 0.3 * k, z * 1.05) : V(-0.01, shY - 0.31 * k, z * 1.1);
    const wrist = sit ? V(0.36 * k, hipY + 0.1, z * 0.75) : V(0.05, shY - 0.59 * k, z * 1.12);
    g.add(limb(a, elbow, 0.045 * k * heavy, top));
    g.add(limb(elbow, wrist, 0.036 * k, top));
    g.add(mesh(new THREE.SphereGeometry(0.045 * k, 10, 8), skin, wrist.x + 0.02, wrist.y - 0.03, wrist.z));
  }
  // шея и голова
  g.add(cyl(0.048 * k, 0.09 * k, 0, shY + 0.01, 0, skin, 12));
  const head = mesh(new THREE.SphereGeometry(1, 22, 18), skin, 0.01, headY, 0);
  head.scale.set(0.098 * k, 0.118 * k, 0.088 * k);
  g.add(head);
  const nose = mesh(new THREE.ConeGeometry(0.014 * k, 0.04 * k, 8), skin, 0.105 * k, headY - 0.012 * k, 0);
  nose.rotation.z = -Math.PI / 2;
  g.add(nose);
  for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.011 * k, 8, 6), mat('#1A1A1A', { roughness: 0.3 }), 0.092 * k, headY + 0.018 * k, s * 0.034 * k));
  // волосы: шапочка, у длинных и каре добавляется полотно сзади
  const cap = mesh(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI * (look.hair === 'thin' ? 0.36 : 0.52)), hair, 0, headY + 0.008 * k, 0);
  cap.scale.set(0.106 * k, 0.126 * k, 0.096 * k);
  cap.rotation.z = 0.32;
  g.add(cap);
  if (look.hair === 'long' || look.hair === 'bob') {
    const len = (look.hair === 'long' ? 0.34 : 0.15) * k;
    const back = mesh(new THREE.SphereGeometry(1, 16, 12), hair, -0.045 * k, headY - len * 0.42, 0);
    back.scale.set(0.07 * k, len * 0.75, 0.1 * k);
    g.add(back);
  }
  if (look.hair === 'bun') g.add(mesh(new THREE.SphereGeometry(0.045 * k, 12, 10), hair, -0.085 * k, headY + 0.085 * k, 0));
  if (look.beard) { const b = mesh(new THREE.SphereGeometry(1, 14, 10), hair, 0.04 * k, headY - 0.07 * k, 0); b.scale.set(0.07 * k, 0.07 * k, 0.075 * k); g.add(b); }
  g.userData.top = headY + 0.14 * k;
  return g;
}

// ---------- фактуры, небо и мебель из Poly Haven (public/assets3d, лицензия CC0) ----------
let onAsset = () => {};
const texLoader = new THREE.TextureLoader(), pbrCache = {};
// Материал по фотофактуре: цвет, рельеф и шероховатость. repeat задаёт, сколько раз фактура повторяется на единицу UV.
function pbrMat(name, repeat, opts = {}) {
  const key = name + '|' + repeat + '|' + JSON.stringify(opts);
  if (pbrCache[key]) return pbrCache[key];
  const t = (suffix, color) => {
    const x = texLoader.load(`assets3d/textures/${name}_${suffix}.jpg`, () => onAsset());
    x.wrapS = x.wrapT = THREE.RepeatWrapping;
    x.repeat.set(repeat, repeat);
    x.anisotropy = 8;
    if (color) x.colorSpace = THREE.SRGBColorSpace;
    return x;
  };
  return (pbrCache[key] = new THREE.MeshStandardMaterial({ map: t('color', true), normalMap: t('normal'), roughnessMap: t('rough'), ...opts }));
}
// Развёртка коробки в метрах: фактура стены не растягивается от длины стены.
function worldUV(geo, w, h, d, tile) {
  const uv = geo.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const j = f * 4 + i; uv.setXY(j, uv.getX(j) * dims[f][0] / tile, uv.getY(j) * dims[f][1] / tile); }
  return geo;
}

let sky = null;
function daySky() {
  if (!sky) {
    sky = { state: 'loading' };
    new HDRLoader().load('assets3d/sky/day.hdr', t => { t.mapping = THREE.EquirectangularReflectionMapping; sky = { state: 'ready', tex: t }; onModelReady(); },
      undefined, () => { sky = { state: 'failed' }; });
  }
  return sky.state === 'ready' ? sky.tex : null;
}

// Какие предметы плана заменяются настоящими моделями; остальные остаются простыми формами.
const FURN_MODELS = new Set(['table', 'round', 'chair', 'armchair', 'sofa', 'bed', 'cabinet', 'shelf', 'stove', 'mirror', 'bush', 'rock', 'fire', 'bench', 'lamp', 'genny', 'plant']);
const TURN = new Set(['chair', 'armchair']); // модель смотрит вдоль +Z, а сиденье на плане вдоль +X
const NATURE = new Set(['bush', 'rock', 'fire']); // их можно масштабировать целиком; мебели сохраняем настоящую высоту
const furnModels = {};
function furnModel(o) {
  if (!FURN_MODELS.has(o.kind)) return null;
  const m = furnModels[o.kind];
  if (!m) {
    furnModels[o.kind] = { state: 'loading' };
    new GLTFLoader().load(`assets3d/furniture/${o.kind}/model.gltf`, g => {
      g.scene.traverse(n => { if (n.isMesh) { n.castShadow = n.receiveShadow = true; n.userData.keep = true; } });
      furnModels[o.kind] = { state: 'ready', scene: g.scene }; onModelReady();
    }, undefined, () => { furnModels[o.kind] = { state: 'failed' }; });
    return null;
  }
  if (m.state !== 'ready') return null;
  const inner = new THREE.Group();
  inner.add(m.scene.clone(true));
  if (TURN.has(o.kind)) inner.rotation.y = Math.PI / 2;
  inner.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(inner), size = bb.getSize(V(0, 0, 0)), c = bb.getCenter(V(0, 0, 0));
  inner.position.set(-c.x, -bb.min.y, -c.z);
  let sx = o.w / size.x, sz = o.h / size.z;
  if (size.z < 0.12) sz = sx; // плоское (зеркало): глубину не растягиваем
  const g = new THREE.Group();
  g.add(inner);
  g.scale.set(sx, NATURE.has(o.kind) ? (sx + sz) / 2 : 1, sz);
  if (o.kind === 'mirror') g.position.y = 1;
  return g;
}

function furniture(o, wallH) {
  const g = new THREE.Group(), w = o.w, d = o.h, k = o.kind;
  const slab = (h, y, color, opts) => g.add(box(w, h, d, 0, y, 0, mat(color, opts)));
  const model = furnModel(o);
  if (model) {
    g.add(model);
    if (k === 'fire') { // огонь и его свет поверх каменного кострища
      const fl = new THREE.Mesh(new THREE.ConeGeometry(w * 0.16, 0.45, 10), new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#FF8A2A', emissiveIntensity: 4 })); fl.position.y = 0.42; g.add(fl);
      const pl = new THREE.PointLight('#FF9A4A', 9, 0, 2); pl.position.set(0, 0.6, 0); pl.castShadow = true; pl.shadow.mapSize.set(512, 512); pl.shadow.bias = -0.003; g.add(pl);
    }
    if (k === 'lamp') { const pl = new THREE.PointLight('#FFD79A', 30, 0, 2); pl.position.set(0, 3.5, 0); g.add(pl); }
    return g;
  }
  switch (k) {
    case 'table': slab(0.04, 0.72, WOOD, { roughness: 0.55 }); legs(g, w, d, 0.72); break;
    case 'round': { const t = cyl(0.5, 0.04, 0, 0.72, 0, mat(WOOD, { roughness: 0.55 }), 32); t.scale.set(w, 1, d); g.add(t); g.add(cyl(0.05, 0.72, 0, 0, 0, mat(DARK))); break; }
    case 'chair': slab(0.04, 0.44, WOOD); legs(g, w, d, 0.44, 0.035); g.add(box(0.04, 0.46, d, -w / 2 + 0.02, 0.48, 0, mat(WOOD))); break;
    case 'armchair': slab(0.42, 0, FABRIC); g.add(box(w * 0.22, 0.45, d, -w / 2 + w * 0.11, 0.42, 0, mat(FABRIC)));
      for (const s of [-1, 1]) g.add(box(w * 0.78, 0.2, d * 0.16, w * 0.11, 0.42, s * (d / 2 - d * 0.08), mat(FABRIC))); break;
    case 'sofa': { const b = Math.min(0.22, d * 0.3); slab(0.42, 0, FABRIC); g.add(box(w, 0.42, b, 0, 0.42, -d / 2 + b / 2, mat(FABRIC)));
      for (const s of [-1, 1]) g.add(box(b, 0.22, d - b, s * (w / 2 - b / 2), 0.42, b / 2, mat(FABRIC))); break; }
    case 'bed': slab(0.3, 0.15, WHITE); slab(0.15, 0, WOOD); g.add(box(Math.min(0.45, w * 0.25), 0.12, d - 0.2, -w / 2 + 0.32, 0.45, 0, mat('#F4F2EC'))); g.add(box(0.05, 0.9, d, -w / 2 + 0.025, 0, 0, mat(WOOD))); break;
    case 'cabinet': slab(2, 0, WOOD); break;
    case 'shelf': slab(1.8, 0, WOOD); break;
    case 'bar': slab(1.05, 0, DARK); slab(0.04, 1.05, WOOD); break;
    case 'piano': slab(1.2, 0, '#1B1B1D', { roughness: 0.25 }); g.add(box(w - 0.1, 0.03, 0.18, 0, 0.72, d / 2 + 0.09, mat('#F4F2EC'))); break;
    case 'tv': g.add(box(w, w * 0.56, 0.05, 0, 0.75, 0, mat('#111315', { roughness: 0.3 }))); g.add(box(w * 0.5, 0.75, 0.3, 0, 0, 0, mat(DARK))); break;
    case 'rug': g.add(box(w, 0.015, d, 0, 0, 0, mat('#8F4F45', { roughness: 1 }))); break;
    case 'stove': slab(0.85, 0, WHITE, { roughness: 0.4 }); slab(0.02, 0.85, DARK, { roughness: 0.3 }); break;
    case 'sink': slab(0.85, 0, WHITE, { roughness: 0.4 }); g.add(box(w - 0.14, 0.02, d - 0.14, 0, 0.845, 0, mat(METAL, { metalness: 0.6, roughness: 0.4 }))); break;
    case 'fridge': slab(1.8, 0, '#DADDDD', { roughness: 0.35 }); break;
    case 'bath': slab(0.55, 0, '#F4F2EC', { roughness: 0.3 }); g.add(box(w - 0.16, 0.02, d - 0.16, 0, 0.54, 0, mat('#BFD9E6'))); break;
    case 'toilet': g.add(box(w * 0.28, 0.8, d, -w / 2 + w * 0.14, 0, 0, mat('#F4F2EC'))); g.add(box(w * 0.7, 0.4, d * 0.85, w * 0.14, 0, 0, mat('#F4F2EC'))); break;
    case 'stairs': { const n = Math.max(2, Math.round(w / 0.28)); for (let i = 0; i < n; i++) g.add(box(w / n, (i + 1) * 0.17, d, -w / 2 + (i + 0.5) * w / n, 0, 0, mat('#BDB8AE'))); break; }
    case 'column': slab(wallH, 0, '#D9D6CF'); break;
    case 'fireplace': slab(1.1, 0, '#A9A29A'); g.add(box(w * 0.6, 0.6, 0.05, 0, 0, d / 2, mat('#151515'))); break;
    case 'mirror': g.add(box(w, 1.5, Math.max(d, 0.03), 0, 0.3, 0, mat('#C9DCE4', { metalness: 0.9, roughness: 0.08 }))); break;
    case 'curtain': g.add(box(w, wallH - 0.15, 0.06, 0, 0, 0, mat('#8D6E6A', { roughness: 1 }))); break;
    case 'block': slab(0.5, 0, '#BDB8AE'); break;
    case 'tree': { const r = Math.min(w, d) / 2; g.add(cyl(0.12, 2.2, 0, 0, 0, mat('#5A4632'), 10)); const c = mesh(new THREE.IcosahedronGeometry(1, 2), mat(GREEN, { roughness: 1 }), 0, 2.2 + r * 0.7, 0); c.scale.set(w / 2, r * 1.1, d / 2); g.add(c); break; }
    case 'bush': { const c = mesh(new THREE.IcosahedronGeometry(1, 2), mat('#73A873', { roughness: 1 }), 0, 0.4, 0); c.scale.set(w / 2, 0.55, d / 2); g.add(c); break; }
    case 'rock': { const c = mesh(new THREE.DodecahedronGeometry(1, 0), mat('#8E9390', { roughness: 1, flatShading: true }), 0, 0.2, 0); c.scale.set(w / 2, Math.min(w, d) * 0.4, d / 2); g.add(c); break; }
    case 'fire': { for (let i = 0; i < 3; i++) { const l = cyl(0.04, w * 0.8, 0, 0.04, 0, mat('#4A382A'), 8); l.rotation.set(Math.PI / 2, 0, i * 1.05); l.position.y = 0.06; g.add(l); }
      const fl = new THREE.Mesh(new THREE.ConeGeometry(w * 0.22, 0.5, 10), new THREE.MeshBasicMaterial({ color: '#FF9A3D' })); fl.position.y = 0.32; g.add(fl);
      const pl = new THREE.PointLight('#FF9A4A', 9, 0, 2); pl.position.set(0, 0.5, 0); pl.castShadow = true; pl.shadow.mapSize.set(512, 512); pl.shadow.bias = -0.003; g.add(pl); break; }
    case 'bench': slab(0.05, 0.42, WOOD); legs(g, w, d, 0.42, 0.06, mat(DARK)); break;
    case 'lamp': { g.add(cyl(0.05, 3.6, 0, 0, 0, mat(DARK), 10)); const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), new THREE.MeshBasicMaterial({ color: '#FFE2A8' })); bulb.position.y = 3.7; g.add(bulb);
      const pl = new THREE.PointLight('#FFD79A', 30, 0, 2); pl.position.set(0, 3.55, 0); g.add(pl); break; }
    case 'fence': g.add(box(w, 1.4, 0.05, 0, 0, 0, mat('#8A7257', { roughness: 1 }))); break;
    case 'road': g.add(box(w, 0.012, d, 0, 0, 0, mat('#5F6466', { roughness: 1 }))); break;
    case 'water': g.add(box(w, 0.02, d, 0, 0, 0, mat('#4C88A8', { roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.85 }))); break;
    case 'tent': { const c = mesh(new THREE.ConeGeometry(0.707, 1, 4), mat('#8A9A78', { roughness: 1, flatShading: true }), 0, 0.85, 0); c.rotation.y = Math.PI / 4; c.scale.set(w, 1.7, d); g.add(c); break; }
    case 'car': g.add(box(w, 0.65, d, 0, 0.3, 0, mat('#8C2F2A', { roughness: 0.3, metalness: 0.5 }))); g.add(box(w * 0.5, 0.5, d * 0.9, -w * 0.06, 0.95, 0, mat('#26323A', { roughness: 0.15, metalness: 0.6 })));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const wh = cyl(0.32, 0.22, sx * w * 0.3, 0, sz * (d / 2 - 0.1), mat('#17191A')); wh.rotation.x = Math.PI / 2; wh.position.y = 0.32; g.add(wh); } break;
    case 'truck': g.add(box(w * 0.74, 2.5, d, -w * 0.13, 0.7, 0, mat('#C9CCC8'))); g.add(box(w * 0.22, 1.9, d, w * 0.39, 0.5, 0, mat('#2F5D8C', { roughness: 0.4 }))); slab(0.3, 0.4, DARK); break;
    case 'bike': g.add(box(w * 0.7, 0.5, 0.25, 0, 0.45, 0, mat(DARK, { roughness: 0.4 })));
      for (const sx of [-1, 1]) { const wh = cyl(0.3, 0.1, sx * w * 0.36, 0, 0, mat('#17191A')); wh.rotation.x = Math.PI / 2; wh.position.y = 0.3; g.add(wh); } break;
    case 'track': for (const s of [-1, 1]) g.add(box(w, 0.05, 0.05, 0, 0, s * d / 2, mat(METAL, { metalness: 0.7, roughness: 0.35 }))); break;
    case 'dolly': slab(0.12, 0.12, DARK); g.add(cyl(0.05, 0.9, 0, 0.24, 0, mat(METAL))); break;
    case 'crane': g.add(cyl(0.35, 0.5, -w * 0.2, 0, 0, mat(DARK))); g.add(cyl(0.06, 1.7, -w * 0.2, 0.5, 0, mat(METAL))); g.add(box(w - 0.4, 0.12, 0.12, 0, 2.2, 0, mat(METAL))); g.add(box(0.4, 0.4, 0.36, -w / 2 + 0.2, 2.0, 0, mat(DARK))); break;
    case 'monitor': g.add(cyl(0.03, 1.1, 0, 0, 0, mat(DARK))); g.add(box(0.06, 0.45, w, 0, 1.1, 0, mat('#111315', { roughness: 0.3 }))); break;
    case 'boom': g.add(cyl(0.025, 1.9, -w / 2 + d / 2, 0, 0, mat(DARK))); g.add(box(w - d / 2, 0.03, 0.03, d / 4, 2.2, 0, mat(DARK))); break;
    case 'haze': slab(0.3, 0, DARK); break;
    case 'genny': slab(0.9, 0, '#B9882A'); break;
    case 'crowd': { const cols = Math.max(1, Math.floor(w / 0.55)), rows = Math.max(1, Math.floor(d / 0.55)), ids = Object.keys(LOOKS); let i = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const p = mannequin({ look: ids[(i * 5 + 1) % ids.length], color: ['#6F7C83', '#8A7E72', '#5F6E63', '#7C6F86', '#8C6A5A'][i % 5] }); i++;
        p.position.set(-w / 2 + (c + 0.5) * w / cols + (r % 2 ? 0.08 : -0.08), 0, -d / 2 + (r + 0.5) * d / rows); p.rotation.y = (i * 2.4) % 6.28; g.add(p); } break; }
    default: slab(0.8, 0, '#BDB8AE');
  }
  return g;
}

function label(text, color = '#1C2A30') {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = '600 44px Segoe UI, system-ui, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 36;
  c.width = w; c.height = 64;
  g.font = '600 44px Segoe UI, system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.beginPath(); g.roundRect(0, 0, w, 64, 18); g.fill();
  g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 18, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(w / 64 * 0.2, 0.2, 1);
  s.renderOrder = 10;
  return s;
}

// Пол: доски в помещении, земля на натуре. Рисуется один раз и повторяется плиткой.
const floorTex = {};
function floorTexture(outdoor) {
  const key = outdoor ? 'out' : 'in';
  if (floorTex[key]) return floorTex[key];
  const c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = c.height = 512;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  if (outdoor) {
    g.fillStyle = '#7F8767'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${60 + rnd() * 90 | 0},${80 + rnd() * 80 | 0},${40 + rnd() * 50 | 0},.28)`; g.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 5, 2 + rnd() * 5); }
  } else {
    for (let row = 0; row < 8; row++) {
      let x = -rnd() * 200;
      while (x < 512) {
        const len = 140 + rnd() * 160, t = 150 + rnd() * 26 | 0;
        g.fillStyle = `rgb(${t + 18},${t - 18},${t - 62})`;
        g.fillRect(x, row * 64, len, 64);
        g.fillStyle = 'rgba(40,25,10,.45)'; g.fillRect(x, row * 64, 2, 64);
        x += len;
      }
      g.fillStyle = 'rgba(40,25,10,.45)'; g.fillRect(0, row * 64, 512, 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(outdoor ? 70 : 130, outdoor ? 70 : 130);
  tex.anisotropy = 8;
  return (floorTex[key] = tex);
}

// Стена с проёмами: дверь и окно, стоящие на линии стены, вырезают в ней отверстия.
function wall(o, openings, H, root, color) {
  const dx = o.x2 - o.x1, dz = o.y2 - o.y1, L = Math.hypot(dx, dz), t = o.thickness || 0.15;
  if (L < 0.01) return;
  const g = new THREE.Group();
  g.position.set(o.x1, 0, o.y1);
  g.rotation.y = -Math.atan2(dz, dx);
  const m = pbrMat('wall', 1, { color: o.color || color });
  const wb = (w, h, d, x, y, z) => mesh(worldUV(new THREE.BoxGeometry(w, h, d), w, h, d, 1.6), m, x, y + h / 2, z);
  const cuts = openings.filter(c => c.wall === o).sort((a, b) => a.s - b.s);
  let from = -t / 2;
  const solid = to => { if (to - from > 0.005) g.add(wb(to - from, H, t, (from + to) / 2, 0, 0)); };
  for (const c of cuts) {
    const a = Math.max(0, c.s - c.w / 2), b = Math.min(L, c.s + c.w / 2);
    solid(a);
    const top = Math.min(H, 2.05), mid = (a + b) / 2, len = b - a;
    if (H > top) g.add(wb(len, H - top, t, mid, top, 0));
    if (c.type === 'window') {
      g.add(wb(len, 0.9, t, mid, 0, 0));
      g.add(box(len, 0.04, t + 0.08, mid, 0.9, 0, mat('#F3F1EC')));
      const glass = box(len, top - 0.94, 0.02, mid, 0.94, 0, mat('#BFDCEB', { transparent: true, opacity: 0.18, roughness: 0.05 }));
      glass.castShadow = false;
      g.add(glass);
    }
    from = b;
  }
  solid(L + t / 2);
  root.add(g);
}

export function create3D(host, hooks = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap; // позволяет каждому прибору свою мягкость тени
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setScissorTest(true);
  const canvas = renderer.domElement;
  host.prepend(canvas);

  const scene = new THREE.Scene();
  const orbit = new THREE.PerspectiveCamera(45, 1, 0.05, 400);
  const lens = new THREE.PerspectiveCamera(30, ASPECT, 0.05, 400);
  const controls = new OrbitControls(orbit, canvas);
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.enableDamping = false;
  controls.addEventListener('change', () => draw());

  onModelReady = () => { if (plan) { build(); draw(); } };
  onAsset = () => draw();
  let plan = null, camId = null, root = null, helpers = null, rigs = new Map(), framed = '', pickables = [], viewRect = null;

  function build() {
    for (const c of personCache.values()) c.group.removeFromParent(); // готовые модели переживают пересборку сцены
    if (root) { scene.remove(root); root.traverse(o => { if (o.geometry && !o.userData.keep) o.geometry.dispose(); if (o.isSprite) { o.material.map.dispose(); o.material.dispose(); } if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose(); }); }
    root = new THREE.Group();
    helpers = new THREE.Group();
    root.add(helpers);
    rigs = new Map();
    pickables = [];
    scene.add(root);
    const H = +plan.wallHeight || 2.7;
    const objs = plan.objects, b = bounds(plan);
    const walls = objs.filter(o => o.type === 'wall');
    const lit = objs.filter(o => o.type === 'light' && !o.off && (LIGHTS[o.kind] || {}).shape !== 'cloth');
    const sunOn = lit.some(o => o.kind === 'sun');
    const outdoor = sunOn && walls.length < 3;
    // днём небо настоящее (фотопанорама), оно же даёт отражения и рассеянный свет; ночью темно
    const skyTex = sunOn ? daySky() : null;
    scene.background = skyTex || new THREE.Color(sunOn ? '#A9C6DF' : '#12191C');
    scene.environment = skyTex;
    scene.environmentIntensity = outdoor ? 0.7 : 0.25; // в комнате небо светит только через окна, поэтому слабее

    const floor = mesh(new THREE.PlaneGeometry(400, 400), outdoor ? pbrMat('ground', 400 / 3, { color: plan.floorColor || '#FFFFFF' }) : pbrMat('floor', 400 / 1.8, { color: plan.floorColor || '#FFFFFF' }), b.x + b.w / 2, 0, b.y + b.h / 2);
    floor.rotation.x = -Math.PI / 2;
    floor.castShadow = false;
    root.add(floor);
    const grid = new THREE.GridHelper(60, 60, '#7E8A8C', '#9BA5A5');
    grid.position.set(Math.round(b.x + b.w / 2), 0.004, Math.round(b.y + b.h / 2));
    grid.material.transparent = true; grid.material.opacity = 0.22;
    helpers.add(grid);

    // общий свет: без приборов сцена освещена ровно, с приборами остаётся слабое заполнение, чтобы читался световой рисунок
    root.add(new THREE.HemisphereLight('#FFFFFF', '#5B5A56', lit.length ? 0.1 : 1.5));
    const wallColor = plan.wallColor || '#F2EEE6';
    if (lit.length && walls.length >= 3) {
      const c = new THREE.Color(wallColor), albedo = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // яркость стен, 0…1 (линейная)
      const flux = lit.reduce((a, l) => a + (l.kind === 'sun' ? 120 : ({ hmi: 150, fresnel: 42, open: 50, dedo: 24, soft: 38, panel: 28, tube: 12, ring: 14, china: 9, practical: 5, desk: 2 }[l.kind] || 30)) * ((+l.power || 100) / 100), 0);
      root.add(new THREE.HemisphereLight(c, new THREE.Color(plan.floorColor || '#B9A27A'), Math.min(0.9, flux * albedo * 0.004)));
    }
    if (!lit.length) { const dl = new THREE.DirectionalLight('#FFFFFF', 1.4); dl.position.set(b.x - 4, 9, b.y + b.h + 5); dl.target.position.set(b.x + b.w / 2, 0, b.y + b.h / 2); root.add(dl, dl.target); }

    // потолок: виден только изнутри, но тень отбрасывает всегда, поэтому солнце попадает в комнату только через окна
    if (walls.length >= 3) {
      const xs = walls.flatMap(w => [w.x1, w.x2]), zs = walls.flatMap(w => [w.y1, w.y2]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const ceil = mesh(new THREE.PlaneGeometry(x1 - x0 + 0.2, z1 - z0 + 0.2), new THREE.MeshStandardMaterial({ color: '#EDEAE3', roughness: 1, side: THREE.FrontSide, shadowSide: THREE.DoubleSide }), (x0 + x1) / 2, H, (z0 + z1) / 2);
      ceil.rotation.x = Math.PI / 2;
      root.add(ceil);
    }

    // проёмы привязываются к ближайшей стене
    const openings = [];
    for (const o of objs) {
      if (o.type !== 'door' && o.type !== 'window') continue;
      let best = null;
      for (const w of walls) {
        const dx = w.x2 - w.x1, dz = w.y2 - w.y1, L = Math.hypot(dx, dz);
        if (L < 0.01) continue;
        const s = ((o.x - w.x1) * dx + (o.y - w.y1) * dz) / L;
        const dist = Math.abs((o.x - w.x1) * dz - (o.y - w.y1) * dx) / L;
        if (s > -0.05 && s < L + 0.05 && dist < 0.3 && (!best || dist < best.dist)) best = { wall: w, s, dist, w: o.w, type: o.type };
      }
      if (best) openings.push(best);
    }
    for (const w of walls) wall(w, openings, H, root, wallColor);

    let shadows = 0;
    for (const o of objs) {
      if (o.type === 'wall' || o.type === 'door' || o.type === 'window' || o.type === 'text' || o.type === 'stroke') continue;
      if (o.type === 'path') {
        const pts = o.points.map(p => V(p[0], 0.02, p[1]));
        const owner = objs.find(q => q.id === o.ownerId);
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: owner ? (owner.type === 'camera' ? CAM : owner.color || '#1C2A30') : '#FFFFFF', dashSize: 0.16, gapSize: 0.1 }));
        line.computeLineDistances();
        helpers.add(line);
        continue;
      }
      const g = new THREE.Group();
      g.position.set(o.x, 0, o.y);
      g.rotation.y = -rad(o.rot || 0);
      g.userData.id = o.id;
      if (o.type === 'image') {
        const tex = new THREE.TextureLoader().load(o.src, () => draw());
        tex.colorSpace = THREE.SRGBColorSpace;
        const p = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: o.opacity ?? 0.6 }));
        p.rotation.x = -Math.PI / 2; p.position.y = 0.008;
        g.add(p);
        root.add(g);
        continue;
      } else if (o.type === 'furniture') {
        g.add(furniture(o, H));
        if (o.label) { const l = label(o.label); l.position.set(o.x, 0.4, o.y); helpers.add(l); }
      } else if (o.type === 'character') {
        const p = person(o, o.id);
        g.add(p);
        if (o.name) { const l = label(o.name, o.color); l.position.set(o.x, p.userData.top + 0.12, o.y); helpers.add(l); }
      } else if (o.type === 'camera') {
        const y = +o.height || height3d(o), rig = new THREE.Group();
        for (let i = 0; i < 3; i++) rig.add(limb(V(0, y - 0.14, 0), V(Math.cos(i * 2.094) * 0.42, 0, Math.sin(i * 2.094) * 0.42), 0.014, mat(DARK)));
        const head = new THREE.Group();
        head.position.y = y; head.rotation.z = rad(+o.tilt || 0);
        head.add(box(0.36, 0.22, 0.2, -0.08, -0.11, 0, mat(CAM, { roughness: 0.5 })));
        const lensM = cyl(0.07, 0.16, 0, 0, 0, mat('#15191B', { roughness: 0.3 })); lensM.rotation.z = Math.PI / 2; lensM.position.set(0.18, 0, 0); head.add(lensM);
        // пирамида кадра
        const hf = Math.tan(rad(fov(o)) / 2) * 1.6, vf = hf / ASPECT;
        const c = [[1.6, vf, -hf], [1.6, vf, hf], [1.6, -vf, hf], [1.6, -vf, -hf]].map(p => V(...p)), z = V(0.26, 0, 0);
        const fr = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([z, c[0], z, c[1], z, c[2], z, c[3], c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]]), new THREE.LineBasicMaterial({ color: '#6FA4FF' }));
        head.add(fr);
        rig.add(head);
        g.add(rig);
        rigs.set(o.id, { rig, frustum: fr });
        const l = label(`Кам. ${o.name || ''}`, CAM); l.position.set(o.x, y + 0.4, o.y); helpers.add(l);
      } else if (o.type === 'light') {
        const k = LIGHTS[o.kind] || LIGHTS.fresnel, color = o.color || k.color || LIGHT, on = !o.off;
        const gain = (+o.power || 100) / 100;
        const y = o.height ?? height3d(o);
        const glowMat = c => new THREE.MeshStandardMaterial({ color: '#000000', emissive: on ? c : '#4A4F52', emissiveIntensity: on ? 3 : 0.4 });
        if (k.shape === 'cloth') {
          const w = o.w || k.w;
          g.add(cyl(0.015, y + w * 0.45, 0, 0, 0, mat(DARK), 6));
          const p = box(0.02, w * 0.9, w, 0, y - w * 0.45, 0, mat(k.fill, { roughness: 1, side: THREE.DoubleSide, ...(k.dash ? { transparent: true, opacity: 0.55 } : {}) }));
          p.castShadow = !k.dash;
          g.add(p);
        } else if (k.shape === 'sun') {
          // солнце не стоит в сцене, от него остаётся только свет; его направление задаётся на плане
          if (on) {
            const sunColor = new THREE.Color(color).lerp(new THREE.Color('#FFFFFF'), 0.55);
            const dl = new THREE.DirectionalLight(sunColor, 5 * gain);
            const a = rad(o.rot || 0), el = rad(clampN(+o.elev || 40, 3, 88)), cx = b.x + b.w / 2, cz = b.y + b.h / 2, D = 45;
            dl.position.set(cx - Math.cos(a) * Math.cos(el) * D, Math.sin(el) * D, cz - Math.sin(a) * Math.cos(el) * D);
            dl.target.position.set(cx, 0, cz);
            dl.castShadow = true;
            const r = Math.max(b.w, b.h) / 2 + 7;
            Object.assign(dl.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 120 });
            dl.shadow.camera.updateProjectionMatrix();
            dl.shadow.mapSize.set(2048, 2048); dl.shadow.bias = -0.0003; dl.shadow.normalBias = 0.03; dl.shadow.radius = 1.5; // солнце: резкая тень
            root.add(dl, dl.target);
            root.add(new THREE.HemisphereLight('#CFE2F5', '#8C8A78', (outdoor ? 0.75 : 0.22) * (skyTex ? 0.35 : 1))); // свет неба
          }
          continue;
        } else if (k.shape === 'glow') {
          let ly;
          if (o.kind === 'china') { // шар на стойке
            // высоко висящий шар — это люстра: шнур к потолку, а не стойка с пола (стойка лезла в кадр)
            if (y >= 2) g.add(cyl(0.006, Math.max(0.05, H - y), 0, y, 0, mat(DARK), 6));
            else g.add(cyl(0.012, y, 0, 0, 0, mat(DARK), 6));
            const ball = new THREE.Mesh(new THREE.SphereGeometry(k.r, 20, 16), glowMat(color)); ball.position.y = y; g.add(ball);
            ly = y;
          } else { // торшер или настольная лампа: основание, ножка, абажур
            const tall = o.kind === 'practical', pole = tall ? 1.32 : 0.3, sr = tall ? 0.2 : 0.12, sh = tall ? 0.26 : 0.16;
            g.add(cyl(tall ? 0.15 : 0.08, 0.025, 0, y, 0, mat(DARK, { roughness: 0.4 })));
            g.add(cyl(0.012, pole, 0, y, 0, mat('#8C7A55', { metalness: 0.6, roughness: 0.4 }), 8));
            const shade = new THREE.Mesh(new THREE.CylinderGeometry(sr * 0.7, sr, sh, 24, 1, true),
              new THREE.MeshStandardMaterial({ color: '#F3E6CC', emissive: on ? color : '#000000', emissiveIntensity: on ? 0.85 : 0, side: THREE.DoubleSide, roughness: 1 }));
            shade.position.y = y + pole + sh / 2 - 0.04;
            g.add(shade);
            ly = y + pole + sh * 0.4;
          }
          if (on) {
            const pl = new THREE.PointLight(color, (o.kind === 'china' ? 9 : o.kind === 'desk' ? 2.2 : 5) * gain, 0, 2);
            pl.position.set(0, ly, 0);
            if (shadows < 8) { pl.castShadow = true; pl.shadow.mapSize.set(512, 512); pl.shadow.bias = -0.003; pl.shadow.camera.near = 0.25; pl.shadow.radius = o.kind === 'china' ? 10 : 4; pl.shadow.blurSamples = 12; shadows++; }
            g.add(pl);
          }
        } else {
          const power = { fresnel: 42, open: 50, dedo: 24, hmi: 150, soft: 38, panel: 28, tube: 12, ring: 14 }[o.kind] || 36;
          const w = o.w || k.w || 0.3;
          for (let i = 0; i < 3; i++) g.add(limb(V(0, Math.max(0.2, y - 0.12), 0), V(Math.cos(i * 2.094) * 0.4, 0, Math.sin(i * 2.094) * 0.4), 0.012, mat(DARK)));
          const head = new THREE.Group();
          head.position.y = y;
          // наклон вниз: задан вручную или прибор смотрит на уровень груди в трёх метрах перед собой
          const tiltDown = o.tilt !== undefined && o.tilt !== '' ? rad(+o.tilt) : Math.atan2(y - 1.25, 3);
          const aim = V(Math.cos(tiltDown), -Math.sin(tiltDown), 0);
          head.rotation.z = -tiltDown;
          const bh = k.thin ? 0.06 : Math.max(0.3, w * 0.7);
          if (k.shape === 'spot') { const c = cyl(k.r, k.r * 1.6, 0, 0, 0, mat(DARK, { roughness: 0.5 })); c.rotation.z = Math.PI / 2; c.position.set(0, 0, 0); head.add(c); }
          else head.add(box(0.12, bh, w, -0.06, -bh / 2, 0, mat(DARK, { roughness: 0.5 })));
          const face = new THREE.Mesh(k.shape === 'spot' ? new THREE.CircleGeometry(k.r * 0.9, 24) : new THREE.PlaneGeometry(w, bh * 0.92), glowMat(color));
          face.rotation.y = Math.PI / 2; face.position.x = k.shape === 'spot' ? k.r * 0.81 : 0.005;
          head.add(face);
          g.add(head);
          if (on) {
            // фокус: у прибора с линзой поток сохраняется, поэтому в пятне свет ярче, а в заливке слабее
            const beamDeg = k.shape === 'spot' ? clampN(+o.beam || k.beam, 6, 90) : Math.min(k.beam, 150);
            const half = rad(beamDeg / 2);
            const focus = k.shape === 'spot' ? (1 - Math.cos(rad(k.beam / 2))) / (1 - Math.cos(half)) : 1;
            // край пятна: у дедолайта резкий, у френеля мягкий, у прожектора без линзы ещё мягче, у мягких источников размыт полностью
            const edge = { dedo: 0.12, fresnel: 0.35, hmi: 0.3, open: 0.55 }[o.kind] ?? 0.9;
            const sl = new THREE.SpotLight(color, power * gain * focus, 0, half, edge, 2);
            sl.position.set(0, y, 0);
            sl.target.position.copy(aim).multiplyScalar(3).add(V(0, y, 0));
            if (shadows < 8) {
              sl.castShadow = true; sl.shadow.mapSize.set(1024, 1024); sl.shadow.bias = -0.0004; sl.shadow.normalBias = 0.02; sl.shadow.camera.near = 0.2; sl.shadow.camera.far = 40;
              // мягкость тени растёт с размером источника: френель даёт резкую тень, софтбокс размытую
              const size = k.shape === 'spot' ? k.r * 2 : (o.w || k.w || 0.5);
              sl.shadow.radius = Math.max(1.5, size * 28); sl.shadow.blurSamples = size > 0.4 ? 20 : 8;
              shadows++;
            }
            g.add(sl, sl.target);
            // луч в воздухе: помогает увидеть, куда и как широко светит прибор (в кадр камеры не попадает)
            const len = Math.min(7, k.len * 1.7), br = Math.tan(Math.min(half, rad(60))) * len;
            const beam = new THREE.Mesh(new THREE.ConeGeometry(br, len, 28, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
            const dir = aim.clone();
            beam.quaternion.setFromUnitVectors(V(0, -1, 0), dir);
            const hold = new THREE.Group();
            hold.position.set(o.x, y, o.y); hold.rotation.y = -rad(o.rot || 0);
            beam.position.copy(dir).multiplyScalar(len / 2);
            hold.add(beam);
            helpers.add(hold);
          }
        }
        if (o.label) { const l = label(o.label, '#7A5200'); l.position.set(o.x, (k.shape === 'glow' && o.kind !== 'china' ? y + 1.7 : y + 0.45), o.y); helpers.add(l); }
      }
      root.add(g);
      pickables.push(g);
    }
  }

  function frame() {
    const b = bounds(plan), size = Math.max(b.w, b.h, 3);
    controls.target.set(b.x + b.w / 2, 0.9, b.y + b.h / 2);
    orbit.position.set(b.x + b.w / 2 + size * 0.7, size * 1.1 + 1.5, b.y + b.h / 2 + size * 1.35);
    controls.update();
  }

  function aim() {
    const o = plan.objects.find(q => q.id === camId && q.type === 'camera');
    if (!o) { camId = null; return null; }
    const a = rad(o.rot || 0), t = rad(+o.tilt || 0), y = +o.height || height3d(o);
    lens.fov = 2 * Math.atan(Math.tan(rad(fov(o)) / 2) / ASPECT) * 180 / Math.PI;
    lens.position.set(o.x, y, o.y);
    lens.lookAt(o.x + Math.cos(a) * Math.cos(t), y + Math.sin(t), o.y + Math.sin(a) * Math.cos(t));
    lens.updateProjectionMatrix();
    return o;
  }

  function draw() {
    if (!plan || !root) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const through = camId && aim();
    helpers.visible = !through;
    for (const [, r] of rigs) { r.rig.visible = !through; r.frustum.visible = !through; } // через камеру другие камеры не мешают кадру
    renderer.setScissor(0, 0, w, h); renderer.setViewport(0, 0, w, h);
    renderer.setClearColor('#0A0F11'); renderer.clear();
    if (through) {
      let vw = w, vh = w / ASPECT;
      if (vh > h) { vh = h; vw = h * ASPECT; }
      const x = (w - vw) / 2, y = (h - vh) / 2;
      viewRect = { x, y, w: vw, h: vh };
      renderer.setViewport(x, y, vw, vh); renderer.setScissor(x, y, vw, vh);
      renderer.render(scene, lens);
    } else {
      viewRect = { x: 0, y: 0, w, h };
      orbit.aspect = w / h; orbit.updateProjectionMatrix();
      renderer.render(scene, orbit);
    }
  }

  // ---------- мышь: выбор, перетаскивание по полу, правая кнопка ----------
  const ray = new THREE.Raycaster(), ground = new THREE.Plane(V(0, 1, 0), 0);
  let dragging = null, rightDown = null;

  function setRay(e) {
    const r = canvas.getBoundingClientRect(), v = viewRect || { x: 0, y: 0, w: r.width, h: r.height };
    const nx = ((e.clientX - r.left - v.x) / v.w) * 2 - 1, ny = -(((e.clientY - r.top - (r.height - v.y - v.h)) / v.h) * 2 - 1);
    ray.setFromCamera(new THREE.Vector2(nx, ny), camId ? lens : orbit);
  }
  // Выбирается только то, во что попали по-настоящему: тело объекта, а не линии пирамиды кадра
  // (у линий зона попадания около метра, и раньше любой клик внутри поля зрения выбирал камеру).
  // Скрытое не выбирается, камера, через которую сейчас смотрим, тоже.
  const shown = n => { for (; n; n = n.parent) if (!n.visible) return false; return true; };
  function pick(e) {
    setRay(e);
    for (const hit of ray.intersectObjects(pickables, true)) {
      if (!hit.object.isMesh || !shown(hit.object)) continue;
      let n = hit.object;
      while (n && !n.userData.id) n = n.parent;
      if (n && n.userData.id !== camId) return { id: n.userData.id, point: hit.point };
    }
    return null;
  }
  function floorPoint(e) {
    setRay(e);
    const p = V(0, 0, 0);
    return ray.ray.intersectPlane(ground, p) ? p : null;
  }

  canvas.addEventListener('pointerdown', e => {
    if (!plan) return;
    if (e.button === 2) { rightDown = [e.clientX, e.clientY]; return; }
    if (e.button !== 0) return;
    const hit = pick(e);
    if (!hit) return;
    const o = plan.objects.find(q => q.id === hit.id), fp = floorPoint(e);
    if (!o || !fp) return;
    controls.enabled = false; // пока тащим объект, сцена не вращается
    dragging = { id: o.id, dx: o.x - fp.x, dz: o.y - fp.z, moved: false, sx: e.clientX, sy: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  }, true);
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    if (!dragging.moved && Math.hypot(e.clientX - dragging.sx, e.clientY - dragging.sy) < 4) return;
    dragging.moved = true;
    const fp = floorPoint(e);
    if (fp && hooks.onMove) hooks.onMove(dragging.id, fp.x + dragging.dx, fp.z + dragging.dz);
  });
  const endDrag = () => {
    if (!dragging) return;
    const d = dragging;
    dragging = null;
    canvas.style.cursor = '';
    controls.enabled = !camId;
    if (d.moved) hooks.onMoveEnd && hooks.onMoveEnd(); else hooks.onSelect && hooks.onSelect(d.id);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  // колесо во время перетаскивания поворачивает объект
  canvas.addEventListener('wheel', e => {
    if (!dragging) return;
    e.preventDefault(); e.stopImmediatePropagation();
    hooks.onRotate && hooks.onRotate(dragging.id, e.deltaY > 0 ? 15 : -15);
  }, { capture: true, passive: false });
  canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (rightDown && Math.hypot(e.clientX - rightDown[0], e.clientY - rightDown[1]) > 5) return; // это был сдвиг вида правой кнопкой
    const hit = pick(e);
    if (hit && hooks.onContext) hooks.onContext(hit.id, e.clientX, e.clientY);
  });

  new ResizeObserver(() => { const w = host.clientWidth, h = host.clientHeight; if (w && h) { renderer.setSize(w, h, false); draw(); } }).observe(host);

  return {
    get cameraId() { return camId; },
    update(p) {
      const first = !plan || plan.id !== p.id;
      plan = p;
      build();
      if (first && framed !== p.id) { framed = p.id; frame(); }
      if (camId && !p.objects.some(o => o.id === camId)) { camId = null; hooks.onChange && hooks.onChange(); }
      if (!dragging) controls.enabled = !camId;
      draw();
    },
    setCamera(id) { camId = id || null; controls.enabled = !camId; draw(); },
    refit() { frame(); draw(); },
    // Кадр глазами выбранной камеры, 1280 на 720.
    async snapshot() {
      if (!camId || !aim()) return null;
      const w = host.clientWidth, h = host.clientHeight, pr = renderer.getPixelRatio();
      renderer.setPixelRatio(1); renderer.setSize(1280, 720, false);
      helpers.visible = false;
      for (const [, r] of rigs) { r.rig.visible = false; r.frustum.visible = false; }
      renderer.setViewport(0, 0, 1280, 720); renderer.setScissor(0, 0, 1280, 720);
      renderer.render(scene, lens);
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
      renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
      draw();
      return blob;
    },
  };
}
