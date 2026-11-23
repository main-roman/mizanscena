// Мизансцена: локальный сервер без зависимостей.
// Раздаёт приложение из public/ и хранит проекты обычными JSON-файлами в «Документы/Мизансцена/projects».
// Проекты лежат отдельно от программы: установщик и обновления их не трогают.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 5180;
const PUBLIC = path.join(__dirname, 'public');
const DATA = process.env.MIZ_DATA || path.join(os.homedir(), 'Documents', 'Мизансцена');
const PROJECTS = path.join(DATA, 'projects');

// Первый запуск после переезда: проекты из старой папки рядом с программой копируются в «Документы».
// Старая папка остаётся как была, ничего не удаляется.
(function migrate() {
  const old = path.join(__dirname, 'projects');
  try {
    if (old === PROJECTS || !fs.existsSync(old) || (fs.existsSync(PROJECTS) && fs.readdirSync(PROJECTS).some(f => f.endsWith('.json')))) return;
    fs.mkdirSync(DATA, { recursive: true });
    fs.cpSync(old, PROJECTS, { recursive: true, errorOnExist: false, force: false });
    console.log('Проекты скопированы в', PROJECTS);
  } catch (e) { console.error('Не получилось перенести проекты:', e.message); }
})();
const ASSETS = path.join(PROJECTS, 'assets');
const TRASH = path.join(PROJECTS, '.trash');
for (const d of [PROJECTS, ASSETS, TRASH]) fs.mkdirSync(d, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.webmanifest': 'application/manifest+json',
};
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const ASSET = /^[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp)$/;

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, code, data) => send(res, code, JSON.stringify(data));

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// Страховка: прежняя версия проекта раз в час уходит в projects/.history/<id>/, хранятся последние 48.
const HISTORY = path.join(PROJECTS, '.history');
function keepHistory(id, file) {
  try {
    if (!fs.existsSync(file)) return;
    const dir = path.join(HISTORY, id);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 13).replace('T', '_');
    const dest = path.join(dir, stamp + '.json');
    if (fs.existsSync(dest)) return;
    fs.copyFileSync(file, dest);
    const old = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 48))) fs.unlinkSync(path.join(dir, f));
  } catch { /* история не должна мешать сохранению */ }
}

function serveFile(res, root, rel) {
  const file = path.resolve(root, '.' + path.sep + rel);
  if (!file.startsWith(root + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

// --- оповещение открытых вкладок об изменениях файлов проектов ---
const clients = new Set();
const pending = new Map();
fs.watch(PROJECTS, (_ev, name) => {
  if (!name || !name.endsWith('.json')) return;
  const id = name.slice(0, -5);
  clearTimeout(pending.get(id));
  pending.set(id, setTimeout(() => {
    pending.delete(id);
    for (const res of clients) res.write(`data: ${JSON.stringify({ id })}\n\n`);
  }, 150));
});

// MCP: ИИ-помощники подключаются к программе по адресу /mcp (см. mcp.js)
const mcp = require('./mcp.js');
mcp.init({ PROJECTS, DATA, writeAtomic: (file, data) => { if (path.dirname(file) === PROJECTS) keepHistory(path.basename(file, '.json'), file); writeAtomic(file, data); }, version: process.env.MIZ_VERSION || require('./package.json').version });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);

    if (p === '/mcp') return mcp.http(req, res, readBody);

    // программа сообщает пропуск в облако, чтобы ИИ-помощник видел и облачные проекты (только с этого компьютера)
    if (p === '/api/cloud-session' && req.method === 'POST') {
      if (!mcp.LOOPBACK(req.socket.remoteAddress)) return json(res, 403, { error: 'forbidden' });
      mcp.setSession(JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || 'null'));
      return json(res, 200, { ok: true });
    }

    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (p === '/api/info') {
      const urls = [];
      for (const list of Object.values(os.networkInterfaces())) {
        for (const n of list || []) if (n.family === 'IPv4' && !n.internal) urls.push(`http://${n.address}:${PORT}`);
      }
      return json(res, 200, {
        urls, data: PROJECTS, version: process.env.MIZ_VERSION || '', test: !!process.env.MIZ_TEST,
        mcp: { url: `http://localhost:${PORT}/mcp`, port: PORT, exe: process.env.MIZ_EXE || '', bridge: process.env.MIZ_BRIDGE || path.join(__dirname, 'mcp-stdio.js'), node: !process.env.MIZ_EXE },
      });
    }

    if (p === '/api/projects' && req.method === 'GET') {
      const list = [];
      for (const f of fs.readdirSync(PROJECTS)) {
        if (!f.endsWith('.json')) continue;
        try {
          const file = path.join(PROJECTS, f);
          const s = JSON.parse(fs.readFileSync(file, 'utf8'));
          list.push({
            id: f.slice(0, -5), name: s.name || f.slice(0, -5), mtime: fs.statSync(file).mtimeMs,
            plans: (s.plans || []).length, shots: (s.shots || []).length, cover: (s.plans || [])[0] || null,
          });
        } catch { /* битый файл пропускаем */ }
      }
      list.sort((a, b) => b.mtime - a.mtime);
      return json(res, 200, list);
    }

    let m = p.match(/^\/api\/projects\/([^/]+)$/);
    if (m) {
      const id = m[1];
      if (!ID.test(id)) return json(res, 400, { error: 'bad id' });
      const file = path.join(PROJECTS, id + '.json');
      if (req.method === 'GET') {
        if (!fs.existsSync(file)) return json(res, 404, { error: 'not found' });
        return send(res, 200, fs.readFileSync(file));
      }
      if (req.method === 'PUT') {
        const body = await readBody(req, 40 * 1024 * 1024);
        const project = JSON.parse(body.toString('utf8'));
        project.id = id;
        if (!project || typeof project !== 'object' || !project.script || !Array.isArray(project.plans)) return json(res, 400, { error: 'not a project' });
        keepHistory(id, file);
        writeAtomic(file, JSON.stringify(project, null, 2));
        return json(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        // ничего не стираем: файл уезжает в projects/.trash
        if (fs.existsSync(file)) fs.renameSync(file, path.join(TRASH, `${id}-${Date.now()}.json`));
        return json(res, 200, { ok: true });
      }
    }

    m = p.match(/^\/api\/assets\/([^/]+)$/);
    if (m && req.method === 'PUT') {
      if (!ASSET.test(m[1])) return json(res, 400, { error: 'bad name' });
      const body = await readBody(req, 20 * 1024 * 1024);
      fs.writeFileSync(path.join(ASSETS, m[1]), body);
      return json(res, 200, { src: '/assets/' + m[1] });
    }

    if (req.method !== 'GET') return json(res, 405, { error: 'method' });
    if (p.startsWith('/assets/')) return serveFile(res, ASSETS, p.slice('/assets/'.length));
    return serveFile(res, PUBLIC, p === '/' ? 'index.html' : p.slice(1));
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

// Запуск. Если порт занят другой копией Мизансцены, работаем через неё, а когда она закроется,
// поднимаем свой сервер (так программа не остаётся без сервера, если первым был запущен браузерный вариант).
let listening = false;
function start() {
  return new Promise(resolve => {
    const onError = err => {
      server.off('listening', onListen);
      if (err.code === 'EADDRINUSE') resolve(false); else throw err;
    };
    const onListen = () => {
      server.off('error', onError);
      listening = true;
      console.log(`Мизансцена запущена: http://localhost:${PORT}`);
      for (const list of Object.values(os.networkInterfaces())) {
        for (const n of list || []) {
          if (n.family === 'IPv4' && !n.internal) console.log(`С телефона в той же сети Wi-Fi: http://${n.address}:${PORT}`);
        }
      }
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListen);
    server.listen(PORT, '0.0.0.0');
  });
}

function alive() {
  return new Promise(resolve => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/info`, { timeout: 1500 }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Следит, чтобы на порту всегда кто-то отвечал; если чужой сервер пропал, занимает порт сам.
async function keepAlive() {
  if (await start()) return;
  console.log(`Порт ${PORT} уже занят другой копией Мизансцены, работаю через неё.`);
  const timer = setInterval(async () => {
    if (listening || await alive()) return;
    if (await start()) { clearInterval(timer); console.log('Прежний сервер закрылся, теперь сервер мой.'); }
  }, 2000);
}

module.exports = { PORT, keepAlive, alive };
if (require.main === module) keepAlive();
