// Хранилище проектов: папка projects/ через локальный сервер,
// а если сервера нет (приложение открыто как статическая страница), то память браузера.
const LS_INDEX = 'miz:projects';
const lsKey = id => 'miz:project:' + id;

async function api(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const lsIndex = () => JSON.parse(localStorage.getItem(LS_INDEX) || '[]');

export const storage = {
  mode: 'server',

  async init() {
    try { await api('/api/projects'); this.mode = 'server'; }
    catch { this.mode = 'local'; }
  },

  async list() {
    if (this.mode === 'server') return api('/api/projects');
    return lsIndex().sort((a, b) => b.mtime - a.mtime);
  },

  async get(id) {
    if (this.mode === 'server') return api('/api/projects/' + id);
    const raw = localStorage.getItem(lsKey(id));
    if (!raw) throw new Error('not found');
    return JSON.parse(raw);
  },

  async put(p) {
    if (this.mode === 'server') {
      return api('/api/projects/' + p.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    }
    localStorage.setItem(lsKey(p.id), JSON.stringify(p));
    const index = lsIndex().filter(s => s.id !== p.id);
    index.push({ id: p.id, name: p.name, mtime: Date.now(), plans: p.plans.length, shots: p.shots.length, cover: p.plans[0] || null });
    localStorage.setItem(LS_INDEX, JSON.stringify(index));
  },

  async remove(id) {
    if (this.mode === 'server') return api('/api/projects/' + id, { method: 'DELETE' });
    localStorage.removeItem(lsKey(id));
    localStorage.setItem(LS_INDEX, JSON.stringify(lsIndex().filter(s => s.id !== id)));
  },

  // Возвращает адрес картинки, который можно положить в проект.
  async putAsset(name, blob) {
    if (this.mode === 'server') {
      const r = await api('/api/assets/' + name, { method: 'PUT', body: blob });
      return r.src;
    }
    return blobToData(blob);
  },

  // Сообщает, когда файл проекта поменялся снаружи (его правил Claude или другое устройство).
  watch(cb) {
    if (this.mode !== 'server') return;
    const es = new EventSource('/api/events');
    es.onmessage = e => { try { cb(JSON.parse(e.data)); } catch { /* пропускаем */ } };
  },
};

export function blobToData(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}
