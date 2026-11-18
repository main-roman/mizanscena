// Мост MCP для клиентов, которые запускают сервер командой и говорят с ним через stdin/stdout (например, Claude Desktop).
// Пересылает сообщения в программу Мизансцена (http://127.0.0.1:<порт>/mcp). Если программа закрыта, открывает её.
// Запуск: «Мизансцена.exe» с переменной ELECTRON_RUN_AS_NODE=1 и этим файлом, или просто `node mcp-stdio.js [--port 5180]`.
'use strict';
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const arg = process.argv.indexOf('--port');
const PORT = Number(arg > 0 ? process.argv[arg + 1] : process.env.MIZ_PORT) || 5180;

function post(body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(body) } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ code: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

// Программа закрыта: открываем её (если мост запущен из самой программы) и ждём, пока сервер ответит.
let opening = null;
function openApp() {
  if (!opening) {
    opening = (async () => {
      if (process.versions.electron) {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const packaged = __dirname.includes('app.asar');
        spawn(process.execPath, packaged ? [] : [path.join(__dirname)], { detached: true, stdio: 'ignore', env }).unref();
      }
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 500));
        try { await post('{"jsonrpc":"2.0","id":0,"method":"ping"}'); return; } catch { /* ещё запускается */ }
      }
    })();
  }
  return opening;
}

async function forward(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  let r;
  try { r = await post(line); }
  catch {
    await openApp();
    try { r = await post(line); }
    catch {
      if (msg.id !== undefined) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Мизансцена не запущена. Откройте программу и повторите.' } });
      return;
    }
  }
  if (r.code === 202 || !r.text) return;
  try { out(JSON.parse(r.text)); }
  catch { if (msg.id !== undefined) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'Мизансцена ответила ошибкой ' + r.code } }); }
}

const out = m => process.stdout.write(JSON.stringify(m) + '\n');

// сообщения обрабатываются по очереди, чтобы ответы шли в том же порядке
let queue = Promise.resolve(), buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) queue = queue.then(() => forward(line));
  }
});
process.stdin.on('end', () => queue.then(() => process.exit(0)));
