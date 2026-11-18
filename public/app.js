// Точка входа: переходы между экранами, список проектов и страница проекта.
import { storage } from './storage.js';
import { store, $, $$, esc, toast, pickFile, createProject, copyToCloud, exportProjectFile, importProjectFile, scenesOf } from './store.js';
import { cloud, isCloud } from './cloud.js';
import { planSVG } from './shapes.js';
import { mountPlan, unmountPlan, createPlan } from './plan.js';
import { mountScript, unmountScript, scriptStats, printScript, toFountain, loadScriptInto, SCRIPT_FILES } from './script.js';
import { mountDirector, unmountDirector, printDirector, csvDirector, totalSeconds, clock } from './director.js';
import { download, safeName } from './store.js';

const VIEWS = ['home', 'project', 'script', 'director', 'plan'];
let current = '', lanUrls = [], dataDir = '', appVersion = '';

store.onStatus = (text, bad = false) => {
  const el = $('#status');
  el.textContent = text;
  el.classList.toggle('bad', bad);
};
store.onRemote = (p, why) => {
  route(true);
  toast(why === 'cloud' ? 'Пришли правки соавтора' : why === 'merge' ? 'Ваши правки объединены с правками соавтора' : 'Проект обновлён из файла');
};
cloud.onAuth = () => { if (current === 'home') renderHome(); };
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
    store.onStatus('');
    show('home', 'Проекты', '');
    return renderHome();
  }
  const pid = parts[1];
  if (!store.project || store.project.id !== pid) {
    try { await store.open(pid); }
    catch { toast('Проект не найден'); location.hash = '#/'; return; }
  }
  const p = store.project, base = `#/p/${pid}`, sub = parts[2] || '';
  if (sub === 'script') {
    if (current === 'script' && !remote) return;
    show('script', 'Сценарий', base);
    unmountScript();
    mountScript($('#view-script'));
  } else if (sub === 'director') {
    show('director', 'Режиссёрский сценарий', base);
    unmountDirector();
    mountDirector($('#view-director'));
  } else if (sub === 'plan' && p.plans.some(x => x.id === parts[3])) {
    show('plan', 'Shot Designer', base);
    mountPlan(parts[3], parts[4]);
  } else {
    show('project', p.name, '#/');
    renderProject();
  }
}

// ---------- список проектов ----------

async function renderHome() {
  const el = $('#view-home');
  let list = [];
  try { list = await storage.list(); } catch { /* покажем пустой список */ }
  const date = ms => ms ? new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const tiles = list.map(p => `<a class="tile" href="#/p/${p.id}">
      <span class="thumb">${p.cover && p.cover.objects && p.cover.objects.length ? planSVG(p.cover, { pad: 0.8 }) : '<span class="thumb-empty">Планов пока нет</span>'}</span>
      <span class="tile-name">${esc(p.name)}</span>
      <span class="tile-meta">${[date(p.mtime), plural(p.plans || 0, 'план', 'плана', 'планов'), plural(p.shots || 0, 'кадр', 'кадра', 'кадров')].filter(Boolean).join(', ')}</span>
    </a>`).join('');
  el.innerHTML = `<div class="home">
    <header class="home-head"><h1>Проекты</h1>
      <div class="home-actions"><button class="act main" id="h-new">Новый проект</button><button class="act" id="h-open">Открыть из файла</button></div></header>
    ${list.length ? `<div class="home-grid">${tiles}</div>` : `<p class="home-empty">Здесь будут ваши проекты. Создайте новый или откройте файл проекта .mizproj с компьютера или телефона.</p>`}
    <p class="home-where">${storage.mode === 'server'
      ? `Проекты лежат на этом компьютере в папке <b>${esc(dataDir || 'projects')}</b>${window.mizDesktop && window.mizDesktop.openData ? ' <button class="linkbtn" id="h-folder">Открыть папку</button>' : ''}.${appVersion ? ` Версия программы ${esc(appVersion)}.` : ''}${lanUrls.length ? ` На телефоне в той же сети Wi-Fi откройте ${lanUrls.map(u => `<b>${u}</b>`).join(' или ')}: там те же проекты, правки видны сразу на обоих устройствах.` : ''}`
      : 'Сервер не запущен, поэтому проекты хранятся только в этом браузере. Сохраняйте проект в файл, чтобы не потерять работу.'}</p>
    <section class="cloud" id="cloud"></section>
  </div>`;
  renderCloud();
}

// ---------- облако на главном экране ----------

const ROLE = { owner: 'ваш проект', editor: 'можно править', viewer: 'только просмотр' };

async function renderCloud() {
  const el = $('#cloud');
  if (!el) return;
  if (!cloud.signedIn) {
    el.innerHTML = `<header class="home-head"><h2>Облако</h2></header>
      <p class="cloud-about">Проекты в облаке открываются на любом компьютере и телефоне, над ними можно работать вместе: правки соавторов приходят через несколько секунд. Данные хранятся в России, в Yandex Cloud.</p>
      <button class="act ya" id="c-login"><span class="ya-y">Я</span>Войти через Яндекс ID</button>`;
    return;
  }
  const u = cloud.user;
  el.innerHTML = `<header class="home-head"><h2>Облако</h2>
      <div class="home-actions"><button class="act main" id="c-new">Новый проект в облаке</button><button class="act" id="c-join">У меня приглашение</button></div></header>
    <p class="cloud-user">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : ''}<span>${esc(u.name)}${u.email ? ` <i>${esc(u.email)}</i>` : ''}</span><button class="linkbtn" id="c-logout">Выйти</button></p>
    <div class="home-grid" id="c-grid"><p class="home-empty">Загружаю…</p></div>`;
  let list;
  try { list = await cloud.list(); } catch (e) { const g = $('#c-grid'); if (g) g.innerHTML = `<p class="home-empty">${esc(e.message)}</p>`; return; }
  const grid = $('#c-grid');
  if (!grid) return;
  const date = ms => ms ? new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  grid.innerHTML = list.length ? list.sort((a, b) => b.updated - a.updated).map(p => `<a class="tile" href="#/p/${p.id}">
      <span class="thumb cloud-thumb"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.1 4.5 4.5 0 0 0 7 18z"/></svg></span>
      <span class="tile-name">${esc(p.name)}</span>
      <span class="tile-meta">${[date(p.updated), ROLE[p.role] || ''].filter(Boolean).join(', ')}</span></a>`).join('')
    : `<p class="home-empty">В облаке пока нет проектов. Создайте новый или перенесите локальный: откройте его и нажмите «Перенести в облако».</p>`;
}

async function cloudLogin() {
  try { return await cloud.login(); }
  catch (e) { toast(e.message || 'Не получилось войти'); return false; }
}

$('#view-home').addEventListener('click', async e => {
  if (e.target.closest('#h-folder')) { window.mizDesktop.openData(); return; }
  if (e.target.closest('#c-login')) { if (await cloudLogin()) toast('Вы вошли: ' + cloud.user.name); return; }
  if (e.target.closest('#c-logout')) { if (confirm('Выйти из облака на этом устройстве? Проекты в облаке останутся.')) { cloud.logout(); renderHome(); } return; }
  if (e.target.closest('#c-new')) { try { location.hash = `#/p/${await createProject(null, true)}`; } catch (err) { toast(err.message); } return; }
  if (e.target.closest('#c-join')) {
    const code = (prompt('Вставьте приглашение (код или всё сообщение целиком)') || '').match(/[\w-]{10,}/g);
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

// ---------- страница проекта ----------

function renderProject() {
  const p = store.project, base = `#/p/${p.id}`;
  const st = scriptStats(p), hasText = p.script.blocks.some(b => b.text.trim()), sec = totalSeconds(p);
  const scenes = scenesOf(p);
  const sceneName = id => { const i = scenes.findIndex(s => s.id === id); return i < 0 ? '' : `Сцена ${i + 1}`; };
  $('#view-project').innerHTML = `<div class="proj">
    <input class="proj-name" id="proj-name" value="${esc(p.name)}" aria-label="Название проекта" spellcheck="false">
    <div class="proj-list">
      <a class="sect" href="${base}/script"><span class="sect-n">Сценарий</span>
        <span class="sect-d">${hasText ? `${plural(st.scenes, 'сцена', 'сцены', 'сцен')}, примерно ${plural(st.pages, 'страница', 'страницы', 'страниц')}` : 'Пока пусто. Напишите здесь или откройте файл Fountain или Final Draft'}</span></a>
      <a class="sect" href="${base}/director"><span class="sect-n">Режиссёрский сценарий</span>
        <span class="sect-d">${p.shots.length ? plural(p.shots.length, 'кадр', 'кадра', 'кадров') + (sec ? `, хронометраж ${clock(sec)}` : '') : 'Таблица кадров по сценам: содержание, персонажи, реквизит, техника'}</span></a>
      <section class="sect sect-plans"><span class="sect-n">Shot Designer</span>
        <span class="sect-d">Планы сверху: мизансцена, камера, свет</span>
        <div class="plan-row">${p.plans.map(x => `<a class="plan-tile" href="${base}/plan/${x.id}"><span class="thumb">${planSVG(x, { pad: 0.8 })}</span>
          <span class="tile-name">${esc(x.name)}</span><span class="tile-meta">${sceneName(x.sceneId) || 'Без сцены'}</span></a>`).join('')}
          <button class="plan-tile plan-new" id="plan-new"><span class="thumb"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span><span class="tile-name">Новый план</span></button>
        </div></section>
    </div>
    <div class="proj-side">
      <p class="sub">Проект</p>
      <div class="actions">
        <button class="act main" data-act="file">Сохранить проект в файл</button>
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
    await navigator.clipboard.writeText(text).catch(() => {});
    prompt('Приглашение скопировано, отправьте его соавтору. Действует 14 дней.', text);
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
  if (e.target.closest('#plan-new')) { location.hash = `#/p/${p.id}/plan/${createPlan()}`; return; }
  const act = (e.target.closest('button') || {}).dataset?.act;
  if (!act) return;
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
  if (act === 'invite-edit' || act === 'invite-view') return invite(p, act === 'invite-view' ? 'viewer' : 'editor');
  if (act === 'to-cloud') {
    if (!cloud.signedIn && !(await cloudLogin())) return;
    toast('Переношу в облако…');
    try {
      await store.flush();
      const id = await copyToCloud(p);
      toast('Готово: копия в облаке. Этот проект остался на компьютере');
      location.hash = `#/p/${id}`;
    } catch (err) { toast(err.message || 'Не получилось'); }
    return;
  }
  if (act === 'remove') {
    if (!confirm(`Удалить проект «${p.name}»?${isCloud(p.id) ? ' Он пропадёт у всех участников.' : ''}`)) return;
    clearTimeout(store.timer); store.timer = 0;
    await storage.remove(p.id);
    store.close();
    location.hash = '#/';
    toast(isCloud(p.id) ? 'Проект удалён из облака' : storage.mode === 'server' ? 'Проект перенесён в projects/.trash' : 'Проект удалён');
  }
});

// ---------- запуск ----------

addEventListener('hashchange', () => route());
addEventListener('beforeunload', () => { unmountScript(); if (store.timer) store.save(); });

(async function start() {
  await storage.init();
  if (storage.mode === 'server') {
    try { const info = await (await fetch('/api/info')).json(); lanUrls = info.urls || []; dataDir = info.data || ''; appVersion = info.version || ''; if (info.test) { document.body.classList.add('is-test'); document.title = document.title.replace(/^Мизансцена/, 'Мизансцена — тест'); } } catch { /* адрес просто не покажем */ }
  }
  store.watch();
  await route();
  document.body.classList.add('ready');
})();
