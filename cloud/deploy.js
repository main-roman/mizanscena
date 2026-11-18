// Выкладывает новую версию функции mizanscena-api: упаковывает код и сохраняет прежние настройки (секрет, базу, хранилище).
// Использование: node deploy.js [ИМЯ=значение ...]   (пустое значение убирает настройку)
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const YC = path.join(process.env.USERPROFILE, 'yandex-cloud', 'bin', 'yc.exe');
const F = 'b1g1i1chsb9qvsj72op3';
const dir = path.join(__dirname, 'function'), zip = path.join(__dirname, 'function.zip');
const yc = args => execFileSync(YC, args, { maxBuffer: 1e8 }).toString();

const prev = JSON.parse(yc(['serverless', 'function', 'version', 'get-by-tag', '--function-name', 'mizanscena-api', '--folder-id', F, '--tag', '$latest', '--format', 'json']));
const env = { ...prev.environment };
for (const kv of process.argv.slice(2)) { const [k, ...v] = kv.split('='); if (v.join('=')) env[k] = v.join('='); else delete env[k]; }
const files = ['index.js', 'package.json', 'package-lock.json'].map(f => `'${path.join(dir, f)}'`).join(',');
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Force -Path ${files} -DestinationPath '${zip}'`]);
const out = yc(['serverless', 'function', 'version', 'create', '--function-name', 'mizanscena-api', '--folder-id', F, '--runtime', 'nodejs22',
  '--entrypoint', 'index.handler', '--memory', '256m', '--execution-timeout', '20s', '--source-path', zip,
  '--service-account-id', prev.service_account_id, '--environment', Object.entries(env).map(([k, v]) => `${k}=${v}`).join(',')]);
console.log((out.match(/status: \w+/) || ['?'])[0], 'настройки:', Object.keys(env).join(', '));
