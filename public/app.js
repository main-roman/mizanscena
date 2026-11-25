// Точка входа: переходы между экранами, список проектов и страница проекта.
import { shiftNo, DAY_KINDS } from './schedmodel.js';
import { renderFrames } from './frames.js';
import { storage } from './storage.js';
import { store, $, $$, esc, toast, uid, pickFile, createProject, copyToCloud, exportProjectFile, importProjectFile, normalizeProject, coverOf } from './store.js';
import { srcOf } from './storage.js';
import { cloud, isCloud } from './cloud.js';
import { ask } from './ui.js';
import { planSVG } from './shapes.js';
import { mountPlan, unmountPlan, createPlan } from './plan.js';
import { mountScript, unmountScript, showScene, scriptStats, printScript, toFountain, loadScriptInto, SCRIPT_FILES } from './script.js';
import { renderLocations, mountLocation, sceneTitle } from './locations.js';
import { renderScenes, mountScene } from './scenes.js';
import { renderSchedule } from './schedule.js';
import { mountCallsheet } from './callsheet.js';
import { mountCrew } from './crew.js';
import { exportKPP } from './kppexport.js';
import './tilemenu.js';
import './combo.js';
import { sceneInfo, eighthsText } from './breakdown.js';
import { openScene, openLocation, openPlan, closeSplit, refreshSplit } from './split.js';
import { mountDirector, unmountDirector, printDirector, csvDirector, totalSeconds, clock } from './director.js';
import { download, safeName, replaceHash } from './store.js';

const VIEWS = ['home', 'project', 'script', 'director', 'plan', 'plans', 'locations', 'location', 'scenes', 'scene', 'schedule', 'call', 'crew'];
let current = '', lanUrls = [], dataDir = '', appVersion = '', mcpInfo = null;

store.onStatus = (text, bad = false) => {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('bad', bad);
};
store.onRemote = (p, why) => {
  route(true);
  refreshSplit();
  toast(why === 'cloud' ? 'Пришли правки соавтора' : why === 'merge' ? 'Ваши правки объединены с правками соавтора' : 'Проект обновлён из файла');
};
cloud.onAuth = () => { syncSession(); if (current === 'home') renderHome(); };

// Пропуск в облако передаётся серверу программы, чтобы подключённый ИИ-помощник видел и облачные проекты.
// Страница без входа не стирает вход, сохранённый другим окном: сбрасывает его только «Выйти» (clear = true).
function syncSession(clear = false) {
  if (storage.mode !== 'server') return;
  if (!cloud.signedIn && !clear) return;
  fetch('/api/cloud-session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cloud.signedIn ? { session: cloud.session, user: cloud.user } : null) }).catch(() => {});
}
store.onList = () => { if (current === 'home') renderHome(); };

function show(name, title, back) {
  if (current === 'script' && name !== 'script') unmountScript();
  if (current === 'director' && name !== 'director') unmountDirector();
  if (current === 'plan' && name !== 'plan') unmountPlan();
  current = name;
  document.body.dataset.view = name;
  for (const v of VIEWS) $('#view-' + v).classList.toggle('on', v === name);
  $('#crumb').textContent = title;
  const b = $('#back');
  b.hidden = !back;
  if (back) b.href = back;
  document.title = (title === 'Проекты' ? 'Мизансцена' : `Мизансцена: ${title}`) + (document.body.classList.contains('is-test') ? ' — тест' : '');
}

const plural = (n, one, few, many) => {
  const a = n % 10, b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`;
};

async function route(remote = false) {
  // адрес приходит закодированным, а id планов бывают с русскими буквами
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(x => { try { return decodeURIComponent(x); } catch { return x; } });
  if (parts[0] !== 'p' || !parts[1]) {
    unmountScript(); // успевает записать последние правки текста до закрытия проекта
    await store.flush();
    store.close();
    closeSplit();
    store.onStatus('');
    show('home', 'Проекты', '');
    return renderHome();
  }
  const pid = parts[1];
  if (!store.project || store.project.id !== pid) {
    try { await store.open(pid); }
    catch { toast('Проект не найден'); replaceHash('#/'); return; }
  }
  const p = store.project, base = `#/p/${pid}`, sub = parts[2] || '';
  if (sub === 'script') {
    if (current === 'script' && !remote) { if (parts[3]) showScene(parts[3]); return; }
    show('script', 'Сценарий', base);
    unmountScript();
    mountScript($('#view-script'));
    if (parts[3] && !remote) showScene(parts[3]);
  } else if (sub === 'director') {
    show('director', 'Режиссёрский сценарий', base);
    unmountDirector();
    mountDirector($('#view-director'));
  } else if (sub === 'plan' && p.plans.some(x => x.id === parts[3])) {
    show('plan', 'План', base + '/plans');
    mountPlan(parts[3], parts[4]);
  } else if (sub === 'plans') {
    // «Кадры»: список сцен, а с id сцены — её раскадровка
    const sc = parts[3] && parts[3] !== 'none' ? sceneTitle(p, parts[3]) : null;
    if (parts[3]) show('plans', sc ? `Кадры · сцена ${sc.n}` : 'Кадры без сцены', base + '/plans');
    else show('plans', 'Кадры', base);
    renderFrames(parts[3] && (sc || parts[3] === 'none') ? parts[3] : '');
  } else if (sub === 'scenes') {
    show('scenes', 'Сцены и разбор', base);
    renderScenes();
  } else if (sub === 'scene' && p.script.blocks.some(b => b.type === 'scene' && b.id === parts[3])) {
    const t = sceneTitle(p, parts[3]);
    show('scene', `Сцена ${t.n}`, base + '/scenes');
    mountScene(parts[3]);
    $('#view-scene').scrollTop = 0;
  } else if (sub === 'crew') {
    show('crew', 'Группа', base);
    mountCrew();
  } else if (sub === 'schedule') {
    show('schedule', 'КПП', base);
    renderSchedule();
  } else if (sub === 'call' && p.schedule.days.some(d => d.id === parts[3])) {
    const d = p.schedule.days.find(x => x.id === parts[3]);
    show('call', d.kind === 'work' ? `Вызывной лист, смена ${shiftNo(p, d)}` : `Вызывной лист, ${DAY_KINDS[d.kind].toLowerCase()} день`, base + '/schedule');
    mountCallsheet(parts[3]);
  } else if (sub === 'locations') {
    show('locations', 'Локации', base);
    renderLocations();
  } else if (sub === 'loc' && p.locations.some(x => x.id === parts[3])) {
    show('location', p.locations.find(x => x.id === parts[3]).name, base + '/locations');
    mountLocation(parts[3]);
  } else {
    show('project', p.name, '#/');
    renderProject();
  }
}

// ---------- список проектов ----------
// Один список: проекты на этом компьютере и в облаке вместе, облачные со значком облака.
// Всё, что делается с проектом (пригласить, перенести в облако, сохранить в файл, удалить), — правой кнопкой по нему.

const ROLE = { owner: 'ваш проект', editor: 'можно править', viewer: 'только просмотр' };
const CLOUD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.1 4.5 4.5 0 0 0 7 18z"/></svg>';
let homeList = [];

async function renderHome() {
  const el = $('#view-home');
  let local = [], remote = [], cloudErr = '';
  try { local = await storage.list(); } catch { /* покажем пустой список */ }
  if (cloud.signedIn) { try { remote = await cloud.list(); } catch (e) { cloudErr = e.message; } }
  homeList = [
    ...local.map(p => ({ ...p, cloud: false, time: p.mtime || 0 })),
    ...remote.map(p => ({ ...p, cloud: true, time: p.updated || 0, cover: coverOf(p.id) })),
  ].sort((a, b) => b.time - a.time);
  const date = ms => ms ? new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const tiles = homeList.map(p => `<a class="tile" href="#/p/${p.id}" data-proj="${p.id}">
      <span class="thumb${p.cloud && !(p.cover && p.cover.objects && p.cover.objects.length) ? ' cloud-thumb' : ''}">${p.cover && p.cover.objects && p.cover.objects.length ? planSVG(p.cover, { pad: 0.8 }) : p.cloud ? CLOUD_ICON : '<span class="thumb-empty">Планов пока нет</span>'}
        ${p.cloud ? `<span class="tile-cloud" title="Проект в облаке${p.role && p.role !== 'owner' ? ': ' + ROLE[p.role] : ''}">${CLOUD_ICON}</span>` : ''}</span>
      <span class="tile-name">${esc(p.name)}</span>
      <span class="tile-meta">${(p.cloud
        ? [date(p.time), p.role && p.role !== 'owner' ? ROLE[p.role] : 'в облаке']
        : [date(p.time), plural(p.plans || 0, 'план', 'плана', 'планов'), plural(p.shots || 0, 'кадр', 'кадра', 'кадров')]).filter(Boolean).join(', ')}</span>
    </a>`).join('');
  const u = cloud.user;
  el.innerHTML = `<div class="home">
    <header class="home-head"><h1>Проекты</h1>
      <div class="home-actions"><button class="act main" id="h-new">Новый проект</button>
        ${cloud.signedIn ? '<button class="act" id="c-new">Новый в облаке</button><button class="act" id="c-join">У меня приглашение</button>' : ''}
        <button class="act" id="h-open">Открыть из файла</button>${mcpInfo ? '<button class="act" id="h-ai">Подключить ИИ</button>' : ''}</div></header>
    ${homeList.length ? `<div class="home-grid">${tiles}</div><p class="home-hint">Правая кнопка мыши по проекту: пригласить соавторов, перенести в облако, сохранить в файл, удалить.</p>`
      : `<p class="home-empty">Здесь будут ваши проекты. Создайте новый или откройте файл проекта .mizproj с компьютера или телефона.</p>`}
    ${cloudErr ? `<p class="home-where">Облако не ответило: ${esc(cloudErr)}. Проекты на компьютере доступны как обычно.</p>` : ''}
    <section class="cloud-line">${cloud.signedIn
      ? `<p class="cloud-user">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : ''}<span>Облако: ${esc(u.name)}${u.email ? ` <i>${esc(u.email)}</i>` : ''}</span><button class="linkbtn" id="c-logout">Выйти</button></p>`
      : `<p class="cloud-about">Проекты в облаке открываются на любом компьютере и телефоне, над ними можно работать вместе: правки соавторов приходят через несколько секунд. Данные хранятся в России, в Yandex Cloud.</p>
        <button class="act ya" id="c-login"><span class="ya-y">Я</span>Войти через Яндекс ID</button>`}</section>
    <p class="home-where">${storage.mode === 'server'
      ? `Проекты на компьютере лежат в папке <b>${esc(dataDir || 'projects')}</b>${window.mizDesktop && window.mizDesktop.openData ? ' <button class="linkbtn" id="h-folder">Открыть папку</button>' : ''}.${appVersion ? ` Версия программы ${esc(appVersion)}.` : ''}${lanUrls.length ? ` На телефоне в той же сети Wi-Fi откройте ${lanUrls.map(u => `<b>${u}</b>`).join(' или ')}: там те же проекты, правки видны сразу на обоих устройствах.` : ''}`
      : 'Сервер не запущен, поэтому проекты хранятся только в этом браузере. Сохраняйте проект в файл, чтобы не потерять работу.'}</p>
  </div>`;
}

async function cloudLogin() {
  try { return await cloud.login(); }
  catch (e) { toast(e.message || 'Не получилось войти'); return false; }
}

async function inviteFromHome(p, role) {
  try { await cloud.get(p.id); } catch { /* роль узнаем из списка */ }
  return invite(p, role);
}

// Перенос в облако: проект копируется в облако со всеми картинками, а копия на компьютере уходит в projects/.trash.
async function moveToCloud(id) {
  if (!cloud.signedIn && !(await cloudLogin())) return null;
  toast('Переношу в облако…');
  try {
    if (store.project && store.project.id === id) await store.flush();
    const p = normalizeProject(await storage.get(id));
    p.id = id;
    const cid = await copyToCloud(p);
    if (store.project && store.project.id === id) store.close();
    await storage.remove(id);
    toast(storage.mode === 'server' ? 'Проект в облаке. Прежний файл на компьютере лежит в projects/.trash' : 'Проект в облаке');
    return cid;
  } catch (err) { toast(err.message || 'Не получилось перенести'); return null; }
}

async function removeProject(p) {
  if (!confirm(`Удалить проект «${p.name}»?${p.cloud ? ' Он пропадёт у всех участников.' : ''}`)) return false;
  if (store.project && store.project.id === p.id) { clearTimeout(store.timer); store.timer = 0; store.close(); }
  try { await storage.remove(p.id); } catch (err) { toast(err.message || 'Не получилось удалить'); return false; }
  toast(p.cloud ? 'Проект удалён из облака' : storage.mode === 'server' ? 'Проект перенесён в projects/.trash' : 'Проект удалён');
  return true;
}

$('#view-home').addEventListener('click', async e => {
  if (e.target.closest('#h-folder')) { window.mizDesktop.openData(); return; }
  if (e.target.closest('#h-ai')) { showAI(); return; }
  if (e.target.closest('#c-login')) { if (await cloudLogin()) toast('Вы вошли: ' + cloud.user.name); return; }
  if (e.target.closest('#c-logout')) { if (confirm('Выйти из облака на этом устройстве? Проекты в облаке останутся.')) { cloud.logout(); syncSession(true); renderHome(); } return; }
  if (e.target.closest('#c-new')) { try { location.hash = `#/p/${await createProject(null, true)}`; } catch (err) { toast(err.message); } return; }
  if (e.target.closest('#c-join')) {
    const code = (await ask('Приглашение в проект', { text: 'Вставьте сообщение с приглашением целиком или только код из него.', placeholder: 'Код приглашения', ok: 'Войти в проект' }) || '').match(/[\w-]{10,}/g);
    if (!code) return;
    try { location.hash = `#/p/${await cloud.join(code[code.length - 1])}`; toast('Вы в проекте'); } catch (err) { toast(err.message); }
    return;
  }
  if (e.target.closest('#h-new')) location.hash = `#/p/${await createProject()}`;
  if (e.target.closest('#h-open')) {
    const file = await pickFile('.mizproj,.json,application/json');
    if (!file) return;
    try { location.hash = `#/p/${await importProjectFile(file)}`; toast('Проект открыт из файла'); }
    catch { toast('Это не файл проекта'); }
  }
});

// меню проекта по правой кнопке
const ctxEl = $('#ctx');
let ctxProj = null;
$('#view-home').addEventListener('contextmenu', e => {
  const t = e.target.closest('[data-proj]');
  if (!t) return;
  const p = homeList.find(x => x.id === t.dataset.proj);
  if (!p) return;
  e.preventDefault();
  ctxProj = p;
  const canEdit = !p.cloud || p.role !== 'viewer', owner = !p.cloud || p.role === 'owner';
  ctxEl.dataset.kind = 'proj';
  ctxEl.innerHTML = `<h2>${esc(p.name)}</h2><div class="menu">
    <button data-menu="open">Открыть</button>
    ${p.cloud && canEdit ? '<button data-menu="inv-edit">Пригласить: может править<small>текст приглашения скопируется</small></button><button data-menu="inv-view">Пригласить: только смотреть</button>' : ''}
    ${p.cloud ? '' : '<button data-menu="to-cloud">Перенести в облако<small>откроется на всех устройствах, можно звать соавторов</small></button>'}
    <button data-menu="file">Сохранить в файл .mizproj</button>
    ${owner ? '<button data-menu="del">Удалить проект</button>' : ''}</div>`;
  ctxEl.classList.add('on');
  ctxEl.style.left = Math.max(8, Math.min(e.clientX + 6, innerWidth - ctxEl.offsetWidth - 8)) + 'px';
  ctxEl.style.top = Math.max(8, Math.min(e.clientY + 6, innerHeight - ctxEl.offsetHeight - 8)) + 'px';
});
ctxEl.addEventListener('click', async e => {
  const b = e.target.closest('[data-menu]');
  if (!b || ctxEl.dataset.kind !== 'proj' || !ctxProj) return;
  ctxEl.classList.remove('on');
  const p = ctxProj, act = b.dataset.menu;
  if (act === 'open') location.hash = `#/p/${p.id}`;
  if (act === 'inv-edit' || act === 'inv-view') inviteFromHome(p, act === 'inv-view' ? 'viewer' : 'editor');
  if (act === 'to-cloud') { if (await moveToCloud(p.id)) renderHome(); }
  if (act === 'file') {
    try { const full = normalizeProject(await storage.get(p.id)); full.id = p.id; await exportProjectFile(full); toast('Файл проекта сохранён в загрузки'); }
    catch (err) { toast(err.message || 'Не получилось сохранить файл'); }
  }
  if (act === 'del') { if (await removeProject(p)) renderHome(); }
});
document.addEventListener('pointerdown', e => { if (ctxEl.dataset.kind === 'proj' && ctxEl.classList.contains('on') && !ctxEl.contains(e.target)) ctxEl.classList.remove('on'); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape' && ctxEl.dataset.kind === 'proj') ctxEl.classList.remove('on'); });

// Ctrl+Z — отменить последнее действие, Ctrl+Y или Ctrl+Shift+Z — вернуть. В полях ввода и в тексте сценария
// работает обычная отмена набора; в мизансцене — своя отмена плана.
addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || !store.project || !['KeyZ', 'KeyY'].includes(e.code)) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (document.body.dataset.view === 'plan' || document.querySelector('dialog[open]')) return;
  e.preventDefault();
  const back = e.code === 'KeyZ' && !e.shiftKey;
  if (back ? store.undo() : store.redo()) { route(true); refreshSplit(); toast(back ? 'Отменено' : 'Возвращено'); }
  else toast(back ? 'Отменять нечего' : 'Возвращать нечего');
});

// ---------- подключение ИИ-помощника (MCP) ----------

function showAI() {
  const m = mcpInfo, name = 'mizanscena' + (document.body.classList.contains('is-test') ? '-test' : '');
  const desktop = { mcpServers: { [name]: m.node
    ? { command: 'node', args: [m.bridge, '--port', String(m.port)] }
    : { command: m.exe, args: [m.bridge, '--port', String(m.port)], env: { ELECTRON_RUN_AS_NODE: '1' } } } };
  const mac = /Mac/.test(navigator.platform);
  const blocks = [
    ['Claude Code', 'Выполните в терминале:', `claude mcp add --transport http ${name} ${m.url}`],
    ['Claude Desktop', `Вставьте в файл настроек ${mac ? '~/Library/Application Support/Claude/claude_desktop_config.json' : '%APPDATA%\\Claude\\claude_desktop_config.json'} (Настройки → Разработчик → Изменить конфигурацию) и перезапустите Claude. Если в файле уже есть mcpServers, добавьте строку ${name} внутрь.`, JSON.stringify(desktop, null, 2)],
    ['Cursor, VS Code, Windsurf и другие', 'Адрес MCP-сервера (Streamable HTTP):', JSON.stringify({ mcpServers: { [name]: { url: m.url } } }, null, 2)],
  ];
  const d = document.createElement('dialog');
  d.className = 'ask ai';
  d.innerHTML = `<form method="dialog"><h3>Подключить ИИ-помощника</h3>
    <p class="ask-text">MCP — это способ дать ИИ-помощнику (Claude, ChatGPT, Cursor и другим) доступ к программе. После подключения вы пишете помощнику обычными словами, а он сам читает и правит ваши проекты: сценарий, разбор сцен, режиссёрский сценарий, локации, планы мизансцены и раскадровку. Правки сразу видны здесь.
    Мизансцена должна быть открыта; облачные проекты видны, если вы вошли в облако.</p>
    <section class="ai-block"><h4>Что попросить</h4>
      <ul class="ai-asks"><li>«Сделай разбор сцены 5 в Птичке по графам»</li><li>«Разбери весь сценарий по графам, как для КПП»</li><li>«Проверь разбор: что пропущено и что названо по-разному»</li><li>«Расставь на плане кухни маму у плиты и камеру на 35 мм»</li></ul>
      <p class="ask-text">Помощник получает правила Мизансцены: как разбирать сцену, как называть предметы, что текст сценария без просьбы не править. Всё, что он запишет в разбор, появится в пунктирной рамке, чтобы вы проверили. Проверенное вами он не меняет. В Claude Desktop эти задания есть готовыми в меню «+» → Мизансцена.</p></section>
    ${blocks.map(([t, hint, code], i) => `<section class="ai-block"><h4>${esc(t)}</h4><p class="ask-text">${esc(hint)}</p>
      <div class="ai-code"><pre>${esc(code)}</pre><button type="button" class="act" data-copy="${i}">Скопировать</button></div></section>`).join('')}
    <p class="ask-text">Помощник работает только с этого компьютера; телефоны и другие устройства в Wi-Fi к нему не подключатся.</p>
    <div class="ask-row"><button class="act main" value="ok">Готово</button></div></form>`;
  d.addEventListener('click', async e => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(blocks[b.dataset.copy][2]); b.textContent = 'Скопировано'; } catch { b.textContent = 'Не получилось'; }
  });
  d.addEventListener('close', () => { d.classList.add('out'); setTimeout(() => d.remove(), 200); });
  document.body.append(d);
  d.showModal();
}

// ---------- страница проекта ----------

// окошко с итогом: строки текста и одна кнопка
function report(title, lines) {
  const d = document.createElement('dialog');
  d.className = 'ask';
  d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>${lines.map(l => `<p class="ask-text">${esc(l)}</p>`).join('')}<div class="ask-row"><button class="act main" value="ok">Понятно</button></div></form>`;
  d.addEventListener('close', () => { d.classList.add('out'); setTimeout(() => d.remove(), 200); });
  document.body.append(d);
  d.showModal();
}

function renderProject() {
  const p = store.project, base = `#/p/${p.id}`;
  const st = scriptStats(p), hasText = p.script.blocks.some(b => b.text.trim()), sec = totalSeconds(p);
  $('#view-project').innerHTML = `<div class="proj">
    <input class="proj-name" id="proj-name" value="${esc(p.name)}" aria-label="Название проекта" spellcheck="false">
    <div class="proj-list">
      <a class="sect" href="${base}/script"><span class="sect-n">Сценарий</span>
        <span class="sect-d">${hasText ? `${plural(st.scenes, 'сцена', 'сцены', 'сцен')}, примерно ${plural(st.pages, 'страница', 'страницы', 'страниц')}` : 'Пока пусто. Напишите здесь или откройте файл Fountain или Final Draft'}</span></a>
      <a class="sect" href="${base}/scenes"><span class="sect-n">Сцены и разбор</span>
        <span class="sect-d">${st.scenes ? `${plural(st.scenes, 'сцена', 'сцены', 'сцен')}, ${eighthsText(sceneInfo(p).reduce((a, s) => a + s.eighths, 0))} стр.: персонажи, реквизит, костюм, транспорт и другие графы по каждой сцене` : 'Разбор сцен: персонажи, реквизит, костюм, транспорт и другие графы'}</span></a>
      <a class="sect" href="${base}/schedule"><span class="sect-n">КПП и вызывные листы</span>
        <span class="sect-d">${p.schedule.days.length ? `${(() => { const w = p.schedule.days.filter(d => d.kind === 'work').length, o = p.schedule.days.length - w; return plural(w, 'смена', 'смены', 'смен') + (o ? `, ${plural(o, 'нерабочий день', 'нерабочих дня', 'нерабочих дней')}` : ''); })()}${p.schedule.days[0].date ? `, с ${new Date(p.schedule.days[0].date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` : ''}` : 'Съёмочные дни по сценам, рассвет и закат, занятость актёров, вызывные листы на каждый день'}</span></a>
      <a class="sect" href="${base}/crew"><span class="sect-n">Группа</span>
        <span class="sect-d">${(() => { const n = p.schedule.info.crew.filter(r => r.name).length, a = p.schedule.cast.filter(c => c.actor).length; return n || a ? `${a ? plural(a, 'актёр', 'актёра', 'актёров') : ''}${a && n ? ', ' : ''}${n ? plural(n, 'человек', 'человека', 'человек') + ' в группе' : ''}: контакты по цехам` : 'Актёры и съёмочная группа по цехам: должности, телефоны, почта'; })()}</span></a>
      <a class="sect" href="${base}/director"><span class="sect-n">Режиссёрский сценарий</span>
        <span class="sect-d">${p.shots.length ? plural(p.shots.length, 'кадр', 'кадра', 'кадров') + (sec ? `, хронометраж ${clock(sec)}` : '') : 'Таблица кадров по сценам: содержание, персонажи, реквизит, техника'}</span></a>
      <a class="sect" href="${base}/plans"><span class="sect-n">Кадры</span>
        <span class="sect-d">${(() => { const pics = p.shots.filter(s => s.frame).length; return p.plans.length || pics ? [p.plans.length ? plural(p.plans.length, 'план', 'плана', 'планов') + ' мизансцены' : '', pics ? plural(pics, 'картинка', 'картинки', 'картинок') + ' раскадровки' : ''].filter(Boolean).join(', ') : 'По сценам: планы мизансцены и раскадровка'; })()}</span>
</a>
      <a class="sect" href="${base}/locations"><span class="sect-n">Локации</span>
        <span class="sect-d">${p.locations.length ? plural(p.locations.length, 'локация', 'локации', 'локаций') + ': фото, адреса, сцены, постановочный реквизит' : 'Фото мест съёмки, адреса, сцены и постановочный реквизит'}</span>
</a>
    </div>
    <div class="proj-side">
      ${hasText ? `<div class="analyze-box"><button class="act main" data-act="analyze-script">Анализ сценария</button>
        <p class="where">Сам заполнит всё, что можно без человека: разбор сцен по графам, локации для каждого места, персонажей в группе. Сцены сразу появятся на столе КПП. Уже вписанное не трогает.</p></div>` : ''}
      <p class="sub">Проект</p>
      <div class="actions">
        <button class="act" data-act="file">Сохранить проект в файл</button>
        <button class="act" data-act="import-script">Загрузить сценарий: Word, PDF, Fountain</button>
      </div>
      <p class="where">${isCloud(p.id) ? 'Проект в облаке: сохраняется сам и открывается на всех ваших устройствах.' : 'Проект сохраняется сам после каждой правки. Файл .mizproj нужен, чтобы перенести проект на другое устройство или сделать копию.'}</p>
      ${isCloud(p.id) ? `<p class="sub">Совместная работа</p><div class="members" id="members"><p class="where">Загружаю участников…</p></div>
      ${cloud.role(p.id) !== 'viewer' ? `<div class="actions"><button class="act" data-act="invite-edit">Пригласить: может править</button><button class="act" data-act="invite-view">Пригласить: только смотреть</button></div>` : ''}`
      : `<div class="actions"><button class="act" data-act="to-cloud">Перенести в облако</button></div>`}
      <p class="sub">Экспорт</p>
      <div class="actions">
        <button class="act" data-act="script-pdf">Сценарий, PDF</button>
        <button class="act" data-act="script-fountain">Сценарий, Fountain</button>
        <button class="act" data-act="dir-pdf">Режиссёрский сценарий, PDF</button>
        <button class="act" data-act="dir-csv">Режиссёрский сценарий, Excel</button>
        <button class="act" data-act="kpp-pdf">КПП, PDF</button>
        <button class="act" data-act="kpp-xlsx">КПП, Excel</button>
      </div>
      ${!isCloud(p.id) || cloud.role(p.id) === 'owner' ? '<div class="actions proj-danger"><button class="act danger" data-act="remove">Удалить проект</button></div>' : ''}
    </div>
  </div>`;
  if (isCloud(p.id)) renderMembers(p.id);
}

async function renderMembers(id) {
  let list;
  try { list = await cloud.members(id); } catch { return; }
  const el = $('#members');
  if (!el || !store.project || store.project.id !== id) return;
  const owner = cloud.role(id) === 'owner', me = cloud.user && cloud.user.id;
  el.innerHTML = list.map(m => `<div class="member">${m.avatar ? `<img src="${esc(m.avatar)}" alt="">` : '<span class="member-pic"></span>'}
    <span class="member-name">${esc(m.name)}${m.id === me ? ' (вы)' : ''}<i>${m.role === 'owner' ? 'владелец' : ROLE[m.role] || ''}</i></span>
    ${owner && m.id !== me ? `<button class="linkbtn" data-kick="${esc(m.id)}" data-name="${esc(m.name)}">Убрать</button>` : ''}</div>`).join('');
}

async function invite(p, role) {
  try {
    const { code } = await cloud.invite(p.id, role);
    const text = `Приглашаю в проект «${p.name}» в Мизансцене (${role === 'viewer' ? 'просмотр' : 'можно править'}). Откройте программу, войдите через Яндекс ID, нажмите «У меня приглашение» и вставьте код: ${code}`;
    let copied = true;
    await navigator.clipboard.writeText(text).catch(() => { copied = false; });
    await ask(role === 'viewer' ? 'Приглашение: только смотреть' : 'Приглашение: может править', {
      text: `${copied ? 'Текст уже скопирован. ' : ''}Отправьте его соавтору в любом мессенджере. Приглашение действует 14 дней.`, value: text, readonly: true, ok: 'Закрыть' });
  } catch (e) { toast(e.message); }
}

$('#view-project').addEventListener('change', e => {
  if (e.target.id !== 'proj-name') return;
  const p = store.project;
  p.name = e.target.value.trim() || 'Без названия';
  e.target.value = p.name;
  $('#crumb').textContent = p.name;
  store.touch();
});
$('#view-project').addEventListener('click', async e => {
  const p = store.project;
  const kick = e.target.closest('[data-kick]');
  if (kick) {
    if (!confirm(`Убрать ${kick.dataset.name} из проекта?`)) return;
    try { await cloud.kick(p.id, kick.dataset.kick); renderMembers(p.id); } catch (err) { toast(err.message); }
    return;
  }
  const act = (e.target.closest('button') || {}).dataset?.act;
  if (!act) return;
  if (act === 'analyze-script') {
    const { applyAnalysis, ensureLocations } = await import('./breakdown.js');
    const { castList } = await import('./schedmodel.js');
    const info = sceneInfo(p), ids = info.map(x => x.id);
    const found = applyAnalysis(p, ids, uid), locs = ensureLocations(p, ids, uid);
    // персонажи сценария — строками в группе (актёра вписывает человек)
    let chars = 0;
    for (const c of castList(p, info)) if (!p.schedule.cast.some(r => r.char.toUpperCase() === c.char)) { p.schedule.cast.push({ id: uid(), char: c.char, actor: '', phone: '', busy: [], makeupMin: 0, costumeMin: 0, carMin: 0 }); chars++; }
    const free = info.filter(x => !p.schedule.days.some(d => d.items.some(i => i.sceneId === x.id))).length;
    store.touch(); renderProject();
    report('Анализ сценария', [
      `Сцен: ${info.length}.`,
      found ? `В разбор добавлено пунктов: ${found}.` : 'Нового в разборе не нашлось.',
      locs ? `Новых локаций: ${locs}.` : 'Все места уже есть в локациях.',
      chars ? `Персонажей добавлено в группу: ${chars}.` : 'Все персонажи уже в группе.',
      free ? `На столе КПП ждут раскладки сцен: ${free}.` : 'Все сцены уже стоят по дням КПП.',
      'Дальше — проверить разбор, вписать адреса локаций и актёров. Раскладку по дням удобно поручить ИИ-помощнику.',
    ]);
    return;
  }
  if (act === 'file') { await store.flush(); await exportProjectFile(p); toast('Файл проекта сохранён в загрузки'); }
  if (act === 'import-script') {
    const file = await pickFile(SCRIPT_FILES);
    if (!file) return;
    if (p.script.blocks.some(b => b.text.trim()) && !confirm('Заменить сценарий проекта текстом из файла? Привязки кадров и планов к сценам сбросятся.')) return;
    try {
      const n = await loadScriptInto(p, file);
      toast(`Сценарий загружен: сцен ${n}. Они уже есть в режиссёрском сценарии`);
      location.hash = `#/p/${p.id}/script`;
    } catch (err) { console.error(err); toast('Не получилось прочитать этот файл'); }
  }
  if (act === 'script-pdf') printScript(p);
  if (act === 'script-fountain') download(new Blob([toFountain(p)], { type: 'text/plain;charset=utf-8' }), safeName(p.name) + '.fountain');
  if (act === 'dir-pdf') printDirector(p);
  if (act === 'dir-csv') csvDirector(p);
  if (act === 'kpp-pdf' || act === 'kpp-xlsx') exportKPP(p, act === 'kpp-pdf' ? 'pdf' : 'xlsx');
  if (act === 'invite-edit' || act === 'invite-view') return invite(p, act === 'invite-view' ? 'viewer' : 'editor');
  if (act === 'to-cloud') {
    const id = await moveToCloud(p.id);
    if (id) replaceHash(`#/p/${id}`); // прежний адрес проекта больше не существует
    return;
  }
  if (act === 'remove') {
    if (!confirm(`Удалить проект «${p.name}»?${isCloud(p.id) ? ' Он пропадёт у всех участников.' : ''}`)) return;
    clearTimeout(store.timer); store.timer = 0;
    await storage.remove(p.id);
    store.close();
    replaceHash('#/');
    toast(isCloud(p.id) ? 'Проект удалён из облака' : storage.mode === 'server' ? 'Проект перенесён в projects/.trash' : 'Проект удалён');
  }
});

// кнопки «Сцена N», локация и план в любом месте программы открывают их на половине экрана
document.addEventListener('click', e => {
  const b = e.target.closest('[data-scene-open], [data-loc-open], [data-plan-open]');
  if (!b) return;
  e.preventDefault();
  if (b.dataset.sceneOpen) openScene(b.dataset.sceneOpen);
  else if (b.dataset.locOpen) openLocation(b.dataset.locOpen);
  else openPlan(b.dataset.planOpen);
});
// фото, брошенное мимо зоны, не должно открываться вместо программы
addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
addEventListener('drop', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });

// ---------- загрузка обновления (только в программе для компьютера) ----------
// Программа сообщает, сколько скачано; здесь это видно карточкой в углу, а на значке в панели задач — полоской.

const mb = n => (n / 1048576).toLocaleString('ru-RU', { maximumFractionDigits: n < 10485760 ? 1 : 0 });
const secs = s => s >= 90 ? `${Math.round(s / 60)} мин` : `${Math.max(1, Math.round(s))} с`;
function updateCard(d) {
  let el = $('#upd');
  if (!el) {
    el = document.createElement('div');
    el.id = 'upd';
    el.setAttribute('role', 'status');
    el.innerHTML = '<b class="upd-t"></b><div class="upd-bar"><i></i></div><span class="upd-d"></span><button class="ico upd-x" aria-label="Скрыть" title="Скрыть: загрузка продолжится"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    el.querySelector('.upd-x').onclick = () => el.classList.remove('on');
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('on'));
  }
  const t = $('.upd-t', el), bar = $('.upd-bar i', el), det = $('.upd-d', el);
  el.classList.toggle('bad', d.stage === 'error');
  if (d.stage === 'start') { el.dataset.version = d.version; t.textContent = `Загружается Мизансцена ${d.version}`; bar.style.width = '1%'; det.textContent = 'Начинаю загрузку…'; el.classList.add('on'); }
  if (d.stage === 'progress') {
    const left = d.speed > 0 ? (d.total - d.transferred) / d.speed : 0;
    t.textContent = `Загружается Мизансцена ${el.dataset.version || ''}`.trim();
    bar.style.width = Math.max(1, d.percent).toFixed(1) + '%';
    det.textContent = `${Math.floor(d.percent)}% · ${mb(d.transferred)} из ${mb(d.total)} МБ${d.speed > 0 ? ` · ${mb(d.speed)} МБ/с, осталось ${secs(left)}` : ''}`;
  }
  if (d.stage === 'done') {
    t.textContent = `Мизансцена ${d.version} загружена`; bar.style.width = '100%'; det.textContent = 'Перезапустите программу в открывшемся окне или просто закройте её позже.';
    setTimeout(() => el.classList.remove('on'), 8000);
  }
  if (d.stage === 'error') { t.textContent = 'Обновление не скачалось'; det.textContent = d.message || ''; }
}
if (window.mizDesktop && window.mizDesktop.onUpdate) window.mizDesktop.onUpdate(updateCard);

// ---------- запуск ----------

// Стрелка «Назад» ведёт на страницу, с которой пришли. Помним путь по программе;
// если раньше ничего не было (программу открыли сразу на этой странице), ведёт в раздел выше.
const trail = [location.hash || '#/'];
addEventListener('hashchange', () => {
  const h = location.hash || '#/';
  if (store.replacing) { store.replacing = false; trail[trail.length - 1] = h; }
  else if (trail.length > 1 && trail[trail.length - 2] === h) trail.pop();
  else if (trail[trail.length - 1] !== h) trail.push(h);
  if (trail.length > 200) trail.splice(0, trail.length - 200);
  route();
});
$('#back').addEventListener('click', e => {
  if (trail.length < 2) return; // обычная ссылка в раздел выше
  e.preventDefault();
  history.back();
});
addEventListener('beforeunload', () => { unmountScript(); if (store.timer) store.save(); });

(async function start() {
  await storage.init();
  if (storage.mode === 'server') {
    try { const info = await (await fetch('/api/info')).json(); mcpInfo = info.mcp && ['localhost', '127.0.0.1'].includes(location.hostname) ? info.mcp : null; lanUrls = info.urls || []; dataDir = info.data || ''; appVersion = info.version || ''; if (info.test) { document.body.classList.add('is-test'); document.title = document.title.replace(/^Мизансцена/, 'Мизансцена — тест'); } } catch { /* адрес просто не покажем */ }
  }
  syncSession();
  store.watch();
  await route();
  document.body.classList.add('ready');
})();
