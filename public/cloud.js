// Облако: вход через Яндекс ID, проекты на сервере в Yandex Cloud, участники и приглашения.
// Облачные проекты имеют id вида c-xxxx; всё остальное (локальные проекты) работает как раньше.
export const API = 'https://functions.yandexcloud.net/d4efuoit544a7d9u5a8d';
export const CLIENT_ID = 'ef0675ead0d24b5d99dce23f6411795b';
const KEY = 'miz:cloud';

export const isCloud = id => /^c-/.test(String(id || ''));

let auth = null;
try { auth = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { auth = null; }

// по каждому открытому облачному проекту помним версию и состояние, от которого шли правки (для объединения)
const meta = new Map();

class CloudError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

async function call(op, { body, qs = {}, raw, type } = {}) {
  const url = API + '?' + new URLSearchParams({ op, ...qs });
  const headers = {};
  if (auth) headers['X-Miz-Session'] = auth.session;
  if (body) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = type || 'application/octet-stream';
  let r;
  try {
    r = await fetch(url, { method: body || raw ? 'POST' : 'GET', headers, body: raw || (body ? JSON.stringify(body) : undefined) });
  } catch { throw new CloudError(0, 'Нет связи с облаком'); }
  let data = {};
  try { data = await r.json(); } catch { /* пустой ответ */ }
  if (r.status === 401 && auth) { cloud.logout(); cloud.onAuth(); }
  if (!r.ok) throw new CloudError(r.status, data.error || 'Облако ответило ошибкой ' + r.status);
  return data;
}

export const cloud = {
  onAuth: () => {},
  get user() { return auth && auth.user; },
  get signedIn() { return !!auth; },

  // В программе вход идёт в отдельном окошке; в браузере человек вставляет код со страницы Яндекса.
  async login() {
    let token = null;
    if (window.mizDesktop && window.mizDesktop.yandexLogin) token = await window.mizDesktop.yandexLogin(CLIENT_ID);
    else {
      open(`https://oauth.yandex.ru/authorize?response_type=token&client_id=${CLIENT_ID}`, '_blank');
      token = prompt('Войдите в открывшейся вкладке Яндекса и вставьте сюда показанный код');
    }
    if (!token) return false;
    const r = await call('login', { body: { yandexToken: token.trim() } });
    auth = { session: r.session, user: r.user };
    localStorage.setItem(KEY, JSON.stringify(auth));
    this.onAuth();
    return true;
  },

  logout() {
    auth = null;
    meta.clear();
    localStorage.removeItem(KEY);
  },

  async list() { return (await call('list')).projects; },

  async get(id) {
    const r = await call('get', { qs: { id } });
    meta.set(id, { version: r.version, base: JSON.stringify(r.data), role: r.role });
    return r.data;
  },
  role: id => (meta.get(id) || {}).role || '',
  version: id => (meta.get(id) || {}).version || 0,

  // свежая версия с сервера без запоминания: решение, принять ли её, за тем, кто открыл проект
  async peek(id) { return call('get', { qs: { id } }); },
  async ver(id) { return (await call('ver', { qs: { id } })).version; },
  accept(id, data, version) { const m = meta.get(id) || {}; meta.set(id, { ...m, version, base: JSON.stringify(data) }); },

  async create(data) {
    const copy = { ...data };
    delete copy.id;
    return (await call('create', { body: { data: copy } })).id;
  },

  // Сохранение. Если кто-то успел изменить проект, правки объединяются и сохраняются снова.
  // Возвращает объединённый проект, если он отличается от отправленного.
  async put(p) {
    const m = meta.get(p.id);
    if (!m) throw new CloudError(0, 'Проект не загружен');
    if (m.role === 'viewer') return null;
    let mine = JSON.parse(JSON.stringify(p)), merged = false;
    for (let i = 0; i < 5; i++) {
      const r = await call('put', { body: { id: p.id, baseVersion: m.version, data: mine } });
      if (!r.conflict) {
        m.version = r.version;
        m.base = JSON.stringify(mine);
        return merged ? mine : null;
      }
      mine = merge(JSON.parse(m.base), mine, r.data);
      m.version = r.version;
      m.base = JSON.stringify(r.data);
      merged = true;
    }
    throw new CloudError(409, 'Не удалось объединить правки');
  },

  async remove(id) { await call('remove', { body: { id } }); meta.delete(id); },
  async members(id) { return (await call('members', { qs: { id } })).members; },
  async invite(id, role) { return call('invite', { body: { id, role } }); },
  async join(code) { return (await call('join', { body: { code } })).id; },
  async kick(id, user) { return call('kick', { body: { id, user } }); },

  async upload(id, blob) {
    const type = /^image\/(jpeg|png|webp)$/.test(blob.type) ? blob.type : 'image/jpeg';
    const r = await call('upload', { qs: { id, type }, raw: blob, type });
    return 'cloud:' + r.key;
  },

  // адрес картинки для <img>: пропуск передаётся в адресе, потому что заголовки туда не добавить
  src(s) {
    if (!String(s).startsWith('cloud:')) return s;
    return `${API}?op=file&key=${encodeURIComponent(s.slice(6))}&t=${encodeURIComponent(auth ? auth.session : '')}`;
  },
};

// ---------- объединение правок ----------
// Три состояния: base (от чего оба начали), mine (у меня), theirs (на сервере).
// Списки объектов с id (планы, предметы, кадры, блоки сценария) объединяются поштучно,
// поэтому двое могут одновременно двигать разные предметы или писать в разных сценах.
// Если оба изменили одно и то же поле, остаётся моя правка.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const byId = a => Array.isArray(a) && a.length > 0 && a.every(x => isObj(x) && x.id != null);

export function merge(base, mine, theirs) {
  if (same(mine, theirs)) return mine;
  if (same(base, mine)) return theirs;
  if (same(base, theirs)) return mine;
  if (isObj(mine) && isObj(theirs)) {
    const b = isObj(base) ? base : {}, out = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const inM = k in mine, inT = k in theirs;
      if (inM && inT) out[k] = merge(b[k], mine[k], theirs[k]);
      else if (inM) { if (!(k in b) || !same(b[k], mine[k])) out[k] = mine[k]; } // у них удалено: оставляем, только если я менял
      else if (!(k in b) || !same(b[k], theirs[k])) out[k] = theirs[k];
    }
    return out;
  }
  if ((byId(mine) || byId(theirs)) && Array.isArray(mine) && Array.isArray(theirs)) return mergeList(Array.isArray(base) ? base : [], mine, theirs);
  return mine;
}

function mergeList(base, mine, theirs) {
  const B = new Map(base.filter(isObj).map(x => [x.id, x]));
  const M = new Map(mine.map(x => [x.id, x]));
  const T = new Map(theirs.map(x => [x.id, x]));
  const keep = (id) => {
    const b = B.get(id), m = M.get(id), t = T.get(id);
    if (m && t) return merge(b, m, t);
    if (m) return b && same(b, m) ? null : m; // удалено у них; если я его менял, оставляем
    if (t) return b && same(b, t) ? null : t; // удалено у меня
    return null;
  };
  // порядок берём у них, а мои новые элементы вставляем после соседа, за которым они стояли у меня
  const order = theirs.map(x => x.id);
  mine.forEach((x, i) => {
    if (T.has(x.id) || B.has(x.id)) return;
    const prev = i > 0 ? mine[i - 1].id : null;
    const at = prev == null ? 0 : order.indexOf(prev) + 1;
    order.splice(at > 0 ? at : (prev == null ? 0 : order.length), 0, x.id);
  });
  for (const x of mine) if (!order.includes(x.id)) order.push(x.id);
  return order.map(keep).filter(Boolean);
}
