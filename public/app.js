// Точка входа: переходы между экранами, список проектов и страница проекта.
import { storage } from './storage.js';
import { store, $, $$, esc, toast, pickFile, createProject, exportProjectFile, importProjectFile, scenesOf } from './store.js';
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
store.onRemote = () => { route(true); toast('Проект обновлён из файла'); };
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
  </div>`;
}

$('#view-home').addEventListener('click', async e => {
  if (e.target.closest('#h-folder')) { window.mizDesktop.openData(); return; }
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
      <p class="where">Проект сохраняется сам после каждой правки. Файл .mizproj нужен, чтобы перенести проект на другое устройство или сделать копию.</p>
      <p class="sub">Экспорт</p>
      <div class="actions">
        <button class="act" data-act="script-pdf">Сценарий, PDF</button>
        <button class="act" data-act="script-fountain">Сценарий, Fountain</button>
        <button class="act" data-act="dir-pdf">Режиссёрский сценарий, PDF</button>
        <button class="act" data-act="dir-csv">Режиссёрский сценарий, Excel</button>
      </div>
      <div class="actions proj-danger"><button class="act danger" data-act="remove">Удалить проект</button></div>
    </div>
  </div>`;
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
  if (act === 'remove') {
    if (!confirm(`Удалить проект «${p.name}»?`)) return;
    clearTimeout(store.timer); store.timer = 0;
    await storage.remove(p.id);
    store.close();
    location.hash = '#/';
    toast(storage.mode === 'server' ? 'Проект перенесён в projects/.trash' : 'Проект удалён');
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
