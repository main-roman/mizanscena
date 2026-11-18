// Сервер Мизансцены в Yandex Cloud (Cloud Functions, Node.js).
// Одна функция обслуживает всё: вход через Яндекс ID, проекты, участников, приглашения и файлы.
// Проекты лежат в базе YDB (данные в России), фото и раскадровки — в Object Storage, отдаются только участникам.
// Вызов: https://functions.yandexcloud.net/<id>?op=<действие>, ответ JSON.
'use strict';
const crypto = require('crypto');
const { Driver, TokenAuthService, TypedValues, TypedData } = require('ydb-sdk');

const YDB_ENDPOINT = process.env.YDB_ENDPOINT || 'grpcs://ydb.serverless.yandexcloud.net:2135';
const YDB_DATABASE = process.env.YDB_DATABASE;     // /ru-central1/<облако>/<база>
const BUCKET = process.env.BUCKET;                // хранилище файлов
const SECRET = process.env.SESSION_SECRET;        // подпись пропусков после входа
const S3 = 'https://storage.yandexcloud.net';
const MAX_PROJECT = 6 * 1024 * 1024;              // проект без картинок обычно сотни килобайт

let driver = null;
// Доступ к базе: IAM-токен служебного аккаунта, который облако передаёт функции при каждом вызове.
// Токен со временем меняется, поэтому база спрашивает его заново при каждом подключении.
let iamToken = '';
const auth = { getAuthMetadata: () => new TokenAuthService(iamToken).getAuthMetadata() };
async function db() {
  if (!driver) {
    driver = new Driver({ endpoint: YDB_ENDPOINT, database: YDB_DATABASE, authService: auth });
    if (!(await driver.ready(10000))) { driver = null; throw new Error('База недоступна'); }
  }
  return driver;
}
// Запрос к базе. params: { $имя: TypedValues.* }. Возвращает строки первой таблицы результата.
async function q(text, params = {}) {
  const d = await db();
  return d.tableClient.withSessionRetry(async s => {
    const res = await s.executeQuery(text, params, { beginTx: { serializableReadWrite: {} }, commitTx: true });
    const rs = res.resultSets && res.resultSets[0];
    return rs ? TypedData.createNativeObjects(rs).map(r => ({ ...r })) : [];
  });
}
const U = TypedValues.utf8, U64 = TypedValues.uint64, TS = TypedValues.timestamp;

// ---------- ответы ----------
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (code, data) => ({ statusCode: code, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(data) });
class Fail extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// ---------- пропуск после входа: id.срок.подпись ----------
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function issue(uid) {
  const body = `${uid}.${Date.now() + 60 * 24 * 3600 * 1000}`; // 60 дней
  return `${body}.${sign(body)}`;
}
function who(event) {
  const h = event.headers || {};
  const t = String(h.Authorization || h.authorization || '').replace(/^Bearer\s+/i, '');
  const [uid, exp, sig] = t.split('.');
  if (!uid || !exp || !sig) throw new Fail(401, 'Нужно войти');
  const good = sign(`${uid}.${exp}`);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) throw new Fail(401, 'Пропуск недействителен, войдите снова');
  if (+exp < Date.now()) throw new Fail(401, 'Срок входа истёк, войдите снова');
  return uid;
}

async function role(uid, pid) {
  const r = await q('DECLARE $u AS Utf8; DECLARE $p AS Utf8; SELECT role FROM members WHERE user_id = $u AND project_id = $p;', { $u: U(uid), $p: U(pid) });
  return r[0] ? r[0].role : null;
}
async function need(uid, pid, write) {
  const r = await role(uid, pid);
  if (!r) throw new Fail(403, 'Нет доступа к проекту');
  if (write && r === 'viewer') throw new Fail(403, 'У вас доступ только для просмотра');
  return r;
}

// ---------- хранилище файлов (доступ сервера по IAM-токену функции) ----------
async function s3(method, key, body, type, token) {
  const r = await fetch(`${S3}/${BUCKET}/${encodeURIComponent(key).replace(/%2F/g, '/')}`, {
    method, body, headers: { 'X-YaCloud-SubjectToken': token, ...(type ? { 'Content-Type': type } : {}) },
  });
  if (!r.ok) throw new Fail(r.status === 404 ? 404 : 502, 'Хранилище: ' + r.status);
  return r;
}

// ---------- действия ----------
const ops = {
  // Вход: программа получила токен Яндекс ID, сервер узнаёт по нему человека и выдаёт свой пропуск.
  async login(ev, body) {
    const r = await fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: 'OAuth ' + body.yandexToken } });
    if (!r.ok) throw new Fail(401, 'Яндекс не подтвердил вход');
    const y = await r.json();
    const uid = 'ya' + y.id;
    const name = y.real_name || y.display_name || y.login || 'Без имени';
    const email = y.default_email || '';
    const avatar = y.is_avatar_empty ? '' : `https://avatars.yandex.net/get-yapic/${y.default_avatar_id}/islands-200`;
    await q('DECLARE $id AS Utf8; DECLARE $n AS Utf8; DECLARE $e AS Utf8; DECLARE $a AS Utf8; DECLARE $t AS Timestamp; UPSERT INTO users (id, name, email, avatar, seen) VALUES ($id, $n, $e, $a, $t);',
      { $id: U(uid), $n: U(name), $e: U(email), $a: U(avatar), $t: TS(new Date()) });
    return { session: issue(uid), user: { id: uid, name, email, avatar } };
  },

  async me(ev) {
    const uid = who(ev);
    const r = await q('DECLARE $id AS Utf8; SELECT id, name, email, avatar FROM users WHERE id = $id;', { $id: U(uid) });
    if (!r[0]) throw new Fail(401, 'Войдите снова');
    return { user: r[0] };
  },

  // Мои проекты: где я владелец или участник.
  async list(ev) {
    const uid = who(ev);
    const rows = await q(`DECLARE $u AS Utf8;
      SELECT p.id AS id, p.name AS name, p.version AS version, p.updated AS updated, p.owner AS owner, m.role AS role
      FROM members AS m INNER JOIN projects AS p ON p.id = m.project_id
      WHERE m.user_id = $u AND (p.deleted IS NULL OR p.deleted = false);`, { $u: U(uid) });
    return { projects: rows.map(r => ({ ...r, version: Number(r.version), updated: r.updated ? new Date(r.updated).getTime() : 0 })) };
  },

  async get(ev, body, qs) {
    const uid = who(ev), pid = qs.id;
    const r = await need(uid, pid, false);
    const rows = await q('DECLARE $p AS Utf8; SELECT data, version, updated_by FROM projects WHERE id = $p;', { $p: U(pid) });
    if (!rows[0]) throw new Fail(404, 'Проект не найден');
    return { data: JSON.parse(rows[0].data), version: Number(rows[0].version), role: r, by: rows[0].updatedBy || rows[0].updated_by || '' };
  },

  // Лёгкая проверка «не изменился ли проект» для живого обновления у всех участников.
  async ver(ev, body, qs) {
    const uid = who(ev);
    await need(uid, qs.id, false);
    const rows = await q('DECLARE $p AS Utf8; SELECT version, updated_by FROM projects WHERE id = $p;', { $p: U(qs.id) });
    return { version: rows[0] ? Number(rows[0].version) : 0, by: rows[0] ? (rows[0].updatedBy || rows[0].updated_by || '') : '' };
  },

  async create(ev, body) {
    const uid = who(ev);
    const id = 'c-' + crypto.randomBytes(6).toString('base64url');
    const data = { ...body.data, id };
    const text = JSON.stringify(data);
    if (text.length > MAX_PROJECT) throw new Fail(413, 'Проект слишком большой');
    await q(`DECLARE $id AS Utf8; DECLARE $o AS Utf8; DECLARE $n AS Utf8; DECLARE $d AS Utf8; DECLARE $t AS Timestamp;
      UPSERT INTO projects (id, owner, name, data, version, updated, updated_by, deleted) VALUES ($id, $o, $n, $d, 1ul, $t, $o, false);
      UPSERT INTO members (user_id, project_id, role) VALUES ($o, $id, "owner");`,
    { $id: U(id), $o: U(uid), $n: U(String(data.name || 'Без названия')), $d: U(text), $t: TS(new Date()) });
    return { id, version: 1 };
  },

  // Сохранение. Если проект уже изменил кто-то другой (версия не совпала), сервер отвечает 409 и присылает свежую версию:
  // программа объединяет правки и сохраняет снова.
  async put(ev, body) {
    const uid = who(ev), pid = body.id;
    await need(uid, pid, true);
    const text = JSON.stringify({ ...body.data, id: pid });
    if (text.length > MAX_PROJECT) throw new Fail(413, 'Проект слишком большой');
    const d = await db();
    return d.tableClient.withSessionRetry(async s => {
      const tx = { beginTx: { serializableReadWrite: {} }, commitTx: false };
      const cur = await s.executeQuery('DECLARE $p AS Utf8; SELECT version, data FROM projects WHERE id = $p;', { $p: U(pid) }, tx);
      const txId = cur.txMeta && cur.txMeta.id;
      const row = TypedData.createNativeObjects(cur.resultSets[0])[0];
      if (!row) { await s.rollbackTransaction({ txId }); throw new Fail(404, 'Проект не найден'); }
      const version = Number(row.version);
      if (version !== Number(body.baseVersion)) {
        await s.rollbackTransaction({ txId });
        return { conflict: true, version, data: JSON.parse(row.data) };
      }
      await s.executeQuery(`DECLARE $p AS Utf8; DECLARE $d AS Utf8; DECLARE $n AS Utf8; DECLARE $v AS Uint64; DECLARE $u AS Utf8; DECLARE $t AS Timestamp;
        UPDATE projects SET data = $d, name = $n, version = $v, updated = $t, updated_by = $u WHERE id = $p;`,
      { $p: U(pid), $d: U(text), $n: U(String(body.data.name || 'Без названия')), $v: U64(version + 1), $u: U(uid), $t: TS(new Date()) },
      { txId, commitTx: true });
      return { version: version + 1 };
    });
  },

  async remove(ev, body) {
    const uid = who(ev);
    if ((await role(uid, body.id)) !== 'owner') throw new Fail(403, 'Удалить проект может только владелец');
    // не стираем: помечаем удалённым, восстановить можно из базы
    await q('DECLARE $p AS Utf8; UPDATE projects SET deleted = true WHERE id = $p;', { $p: U(body.id) });
    return { ok: true };
  },

  // ---------- участники и приглашения ----------
  async members(ev, body, qs) {
    const uid = who(ev);
    await need(uid, qs.id, false);
    const rows = await q(`DECLARE $p AS Utf8;
      SELECT u.id AS id, u.name AS name, u.email AS email, u.avatar AS avatar, m.role AS role
      FROM members VIEW by_project AS m INNER JOIN users AS u ON u.id = m.user_id WHERE m.project_id = $p;`, { $p: U(qs.id) });
    return { members: rows };
  },

  async invite(ev, body) {
    const uid = who(ev);
    const r = await need(uid, body.id, true);
    if (r !== 'owner' && r !== 'editor') throw new Fail(403, 'Приглашать могут владелец и редакторы');
    const role = body.role === 'viewer' ? 'viewer' : 'editor';
    const code = crypto.randomBytes(9).toString('base64url');
    await q('DECLARE $c AS Utf8; DECLARE $p AS Utf8; DECLARE $r AS Utf8; DECLARE $u AS Utf8; DECLARE $t AS Timestamp; UPSERT INTO invites (code, project_id, role, created_by, created) VALUES ($c, $p, $r, $u, $t);',
      { $c: U(code), $p: U(body.id), $r: U(role), $u: U(uid), $t: TS(new Date()) });
    return { code, role };
  },

  async join(ev, body) {
    const uid = who(ev);
    const rows = await q('DECLARE $c AS Utf8; SELECT project_id, role, created FROM invites WHERE code = $c;', { $c: U(String(body.code || '')) });
    const inv = rows[0];
    if (!inv) throw new Fail(404, 'Приглашение не найдено');
    if (Date.now() - new Date(inv.created).getTime() > 14 * 24 * 3600 * 1000) throw new Fail(410, 'Приглашение устарело, попросите новое');
    const pid = inv.projectId || inv.project_id;
    const cur = await role(uid, pid);
    if (!cur || (cur === 'viewer' && inv.role === 'editor')) {
      await q('DECLARE $u AS Utf8; DECLARE $p AS Utf8; DECLARE $r AS Utf8; UPSERT INTO members (user_id, project_id, role) VALUES ($u, $p, $r);', { $u: U(uid), $p: U(pid), $r: U(inv.role) });
    }
    return { id: pid };
  },

  async kick(ev, body) {
    const uid = who(ev);
    if ((await role(uid, body.id)) !== 'owner') throw new Fail(403, 'Убирать участников может только владелец');
    if (body.user === uid) throw new Fail(400, 'Владелец не может убрать себя');
    await q('DECLARE $u AS Utf8; DECLARE $p AS Utf8; DELETE FROM members WHERE user_id = $u AND project_id = $p;', { $u: U(body.user), $p: U(body.id) });
    return { ok: true };
  },

  // ---------- файлы: фото, раскадровки ----------
  async upload(ev, body, qs, ctx) {
    const uid = who(ev);
    await need(uid, qs.id, true);
    const type = /^image\/(jpeg|png|webp)$/.test(qs.type) ? qs.type : 'image/jpeg';
    const key = `p/${qs.id}/${crypto.randomBytes(9).toString('base64url')}.${type.split('/')[1].replace('jpeg', 'jpg')}`;
    const buf = Buffer.from(ev.body || '', ev.isBase64Encoded ? 'base64' : 'binary');
    if (!buf.length || buf.length > 3 * 1024 * 1024) throw new Fail(413, 'Картинка должна быть до 3 МБ');
    await s3('PUT', key, buf, type, ctx.token.access_token);
    return { key };
  },
};

// Файл отдаётся картинкой, а не JSON: адрес вставляется прямо в <img>. Пропуск передаётся в адресе (t=...).
async function file(ev, qs, ctx) {
  const uid = who({ headers: { Authorization: 'Bearer ' + (qs.t || '') } });
  const m = /^p\/([^/]+)\/[\w-]+\.(jpg|png|webp)$/.exec(qs.key || '');
  if (!m) throw new Fail(400, 'Неверный адрес файла');
  await need(uid, m[1], false);
  const r = await s3('GET', qs.key, undefined, undefined, ctx.token.access_token);
  return {
    statusCode: 200, isBase64Encoded: true, body: Buffer.from(await r.arrayBuffer()).toString('base64'),
    headers: { ...CORS, 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' },
  };
}

module.exports.handler = async (event, context) => {
  if (context && context.token) iamToken = context.token.access_token;
  try {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
    const qs = event.queryStringParameters || {};
    if (qs.op === 'file') return await file(event, qs, context);
    const fn = ops[qs.op];
    if (!fn) throw new Fail(404, 'Нет такого действия');
    let body = {};
    if (qs.op !== 'upload' && event.body) body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
    return json(200, await fn(event, body, qs, context));
  } catch (e) {
    if (e instanceof Fail) return json(e.code, { error: e.message });
    console.error(e);
    // подробности ошибки показываются только при наладке (переменная DEBUG в настройках функции)
    return json(500, { error: 'Ошибка сервера', ...(process.env.DEBUG ? { detail: String((e && e.stack) || e).slice(0, 1500) } : {}) });
  }
};
