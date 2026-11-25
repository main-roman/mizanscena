// Группа: актёры и съёмочная группа по цехам — с должностями, телефонами, почтой и заметками.
// Актёры общие с КПП и вызывными; отмеченные «в вызывном» люди попадают в блок «Руководители группы».
import { store, $, uid, esc, toast, download, safeName, printHTML } from './store.js';
import { sceneInfo } from './breakdown.js';
import { castList, dayOutOfDays, DEPARTMENTS, ROLES, STATUSES, guessDept, contactLink as tel, CONTACT_PH } from './schedmodel.js';
import { makeXlsx } from './xlsx.js';

const project = () => store.project;
const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const title = s => s ? s.charAt(0) + s.slice(1).toLowerCase() : '';
let query = '';

const match = (...v) => !query || v.join(' ').toLowerCase().includes(query);
const statusCls = s => ({ 'Утверждён': 'ok', 'Найден': 'found', 'Связались': 'found', 'Требуется решение': 'wait', 'В поисках': 'search', 'Ещё не связались': 'search', 'Отказался': 'no' })[s] || '';

// при каждом заходе на страницу поиск начинается заново
export function mountCrew() { query = ''; renderCrew(); }

const row = char => project().schedule.cast.find(c => c.char.toUpperCase() === char);
const busyText = r => { const n = r && r.busy ? r.busy.length : 0; return n ? `занят: ${n} ${n === 1 ? 'день' : n < 5 ? 'дня' : 'дней'}` : 'отметить'; };
function castRow(char) {
  let r = row(char);
  if (!r) { r = { id: uid(), char, actor: '', phone: '', busy: [], makeupMin: 0, costumeMin: 0, carMin: 0 }; project().schedule.cast.push(r); }
  return r;
}

export function renderCrew() {
  const p = project(), sch = p.schedule, info = sceneInfo(p), cast = castList(p, info), dood = dayOutOfDays(p, info, cast);
  const people = sch.info.crew;
  const castRows = cast.filter(c => match(c.char, c.actor, c.phone)).map(c => {
    const d = dood.find(x => x.char === c.char), days = d ? d.marks.map((m, i) => (m && m !== 'H' ? i + 1 : 0)).filter(Boolean) : [];
    const own = !c.scenes.length && !info.some(sc => sc.chars.includes(c.char)); // вписан руками, в сценарии его нет
    return `<tr data-char="${esc(c.char)}"><td class="cr-n">${c.n}</td><td><b>${esc(title(c.char))}</b>${own ? ` <button class="cr-delchar" data-delchar="${esc(c.char)}" title="Убрать персонажа" aria-label="Убрать персонажа">×</button>` : ''}</td>
      <td><input data-cast="actor" value="${esc(c.actor)}" placeholder="Кто играет"></td>
      <td class="cr-phone"><input data-cast="phone" value="${esc(c.phone)}" placeholder="${CONTACT_PH}">${tel(c.phone)}</td>
      <td>${c.scenes.length}</td><td>${days.length ? `${days.length} <small>(${days.join(', ')})</small>` : '<small>не в КПП</small>'}</td>
      ${['makeupMin', 'costumeMin', 'carMin'].map(k => `<td class="cr-min"><input type="number" min="0" step="5" data-castmin="${k}" value="${(row(c.char) || {})[k] || ''}" placeholder="—"></td>`).join('')}
      <td class="cr-busy"><button class="linkbtn" data-busy="${esc(c.char)}">${busyText(row(c.char))}</button></td></tr>`;
  }).join('');
  const dept = d => {
    const rows = people.filter(r => r.dept === d && match(r.role, r.name, r.phone, r.email, r.note));
    if (query && !rows.length) return '';
    return `<section class="cr-dept" data-dept="${esc(d)}"><header><h2>${esc(d)} <span>${people.filter(r => r.dept === d).length || ''}</span></h2>
        <button class="linkbtn" data-add="${esc(d)}">+ человек</button></header>
      ${rows.length ? `<div class="sl-wrap"><table class="cr-table"><thead><tr><th>Должность</th><th>Имя</th><th>Этап</th><th>Город</th><th>Телефон / Telegram</th><th>Почта</th><th>Заметка</th><th title="Показывать в блоке «Руководители группы» вызывного листа">В вызывном</th><th></th></tr></thead><tbody>
        ${rows.map(r => `<tr data-row="${r.id}"><td><input data-f="role" value="${esc(r.role)}" placeholder="Должность" data-combo="cr-roles-${DEPARTMENTS.indexOf(d)}" autocomplete="off"></td><td><input data-f="name" value="${esc(r.name)}" placeholder="Имя и фамилия"></td>
          <td><select class="cr-status ${statusCls(r.status)}" data-f="status"><option value="">—</option>${STATUSES.map(x => `<option${x === r.status ? ' selected' : ''}>${x}</option>`).join('')}</select></td>
          <td><input data-f="city" value="${esc(r.city)}" placeholder="Город" class="cr-city"></td>
          <td class="cr-phone"><input data-f="phone" value="${esc(r.phone)}" placeholder="${CONTACT_PH}">${tel(r.phone)}</td><td><input data-f="email" value="${esc(r.email)}" placeholder="почта"></td>
          <td><input data-f="note" value="${esc(r.note)}" placeholder="Машина, смены, аллергии"></td>
          <td class="cr-lead"><input type="checkbox" data-f="lead"${r.lead ? ' checked' : ''} aria-label="В вызывном"></td>
          <td class="cr-x"><select data-move aria-label="Перенести в другой цех" title="Перенести в другой цех"><option value="">→</option>${DEPARTMENTS.filter(x => x !== d).map(x => `<option>${esc(x)}</option>`).join('')}</select><button class="ico" data-del="${r.id}" title="Убрать" aria-label="Убрать">${X}</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="empty">Пока никого.</p>'}
      <datalist id="cr-roles-${DEPARTMENTS.indexOf(d)}">${(ROLES[d] || []).map(([x]) => `<option value="${esc(x)}">`).join('')}</datalist></section>`;
  };
  const total = people.length + cast.filter(c => c.actor).length, named = people.filter(r => r.name.trim()).length + cast.filter(c => c.actor).length;
  $('#view-crew').innerHTML = `<div class="page page-wide cr">
    <header class="page-head"><h1>Группа</h1>
      <input class="cr-search" type="search" placeholder="Найти человека, должность, телефон" value="${esc(query)}" aria-label="Поиск">
      ${people.length ? '' : '<button class="act" data-act="fill">Заполнить обычными должностями</button>'}
      <button class="act" data-act="paste">Вставить из таблицы</button>
      <button class="act" data-act="pdf">PDF</button><button class="act" data-act="xlsx">Excel</button></header>
    <p class="page-hint">${total ? `В группе ${named ? `${named} чел.` : 'пока никого'}${total > named ? `, ещё ${total - named} ${total - named === 1 ? 'должность' : total - named < 5 ? 'должности' : 'должностей'} без имени` : ''}.` : 'Здесь вся группа проекта.'} Актёры общие с КПП и вызывными листами. Галочка «В вызывном» показывает человека в блоке «Руководители группы».</p>
    <section class="cr-dept cr-cast"><header><h2>Актёры <span>${cast.length || ''}</span></h2></header>
      <div class="sl-wrap"><table class="cr-table"><thead><tr><th>№</th><th>Персонаж</th><th>Актёр</th><th>Телефон / Telegram</th><th>Сцен</th><th>Съёмочных дней</th><th title="Сколько минут на грим персонажа">Грим, мин</th><th title="Сколько минут на костюм">Костюм, мин</th><th title="За сколько минут до готовности приезжает машина">Машина, мин</th><th>Занятость</th></tr></thead><tbody>${castRows}
        <tr class="cr-addrow"><td class="cr-n"></td><td colspan="3"><input class="cr-addchar" placeholder="+ персонаж и Enter — можно и без сценария" aria-label="Новый персонаж"></td><td colspan="6"></td></tr></tbody></table></div>
      ${cast.length ? '' : '<p class="page-hint">Персонажи сами появятся из сценария — или впишите их здесь.</p>'}</section>
    <div class="cr-grid">${DEPARTMENTS.map(dept).join('')}</div>
  </div>`;
}

// ---------- правки ----------
const view = $('#view-crew');
const rowOf = el => project().schedule.info.crew.find(r => r.id === el.closest('[data-row]')?.dataset.row);
function rerender(focusSel) { const y = view.scrollTop; renderCrew(); view.scrollTop = y; if (focusSel) $(focusSel, view)?.focus(); }

view.addEventListener('input', e => {
  const t = e.target, p = project();
  if (t.matches('.cr-search')) { query = t.value.trim().toLowerCase(); rerender('.cr-search'); const s = $('.cr-search', view); s.setSelectionRange(s.value.length, s.value.length); return; }
  if (t.dataset.castmin) { castRow(t.closest('[data-char]').dataset.char)[t.dataset.castmin] = Math.max(0, Math.round(+t.value || 0)); store.touch(); return; }
  if (t.dataset.cast) {
    const char = t.closest('[data-char]').dataset.char;
    let row = p.schedule.cast.find(c => c.char.toUpperCase() === char);
    if (!row) { row = { id: uid(), char, actor: '', phone: '' }; p.schedule.cast.push(row); }
    row[t.dataset.cast] = t.value.trim(); store.touch(); return;
  }
  const r = rowOf(t);
  if (r && t.dataset.f && t.type !== 'checkbox') { r[t.dataset.f] = t.value; store.touch(); }
});
view.addEventListener('change', e => {
  const t = e.target, r = rowOf(t);
  if (r && t.dataset.f === 'lead') { r.lead = t.checked; store.touch(); return; }
  if (r && t.dataset.f === 'status') { r.status = t.value; store.touch(); t.className = 'cr-status ' + statusCls(t.value); return; }
  if (r && t.matches('[data-move]') && t.value) { r.dept = t.value; store.touch(); rerender(); toast(`Перенесено: ${t.value}`); return; }
  if (t.dataset.f === 'phone' || t.dataset.cast === 'phone') rerender(); // появится кнопка звонка
});
view.addEventListener('click', e => {
  const p = project(), b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.busy) { busyDialog(b.dataset.busy); return; }
  if (b.dataset.delchar) {
    const sch = p.schedule, r = sch.cast.find(c => c.char.toUpperCase() === b.dataset.delchar);
    if (r && (r.actor || r.phone) && !confirm(`Убрать персонажа ${title(b.dataset.delchar)} вместе с актёром ${r.actor || ''}?`)) return;
    sch.cast = sch.cast.filter(c => c.char.toUpperCase() !== b.dataset.delchar); store.touch(); rerender(); return;
  }
  if (b.dataset.add) {
    const r = { id: uid(), dept: b.dataset.add, role: '', name: '', phone: '', email: '', note: '', lead: false };
    p.schedule.info.crew.push(r); store.touch(); query = ''; rerender(`[data-row="${r.id}"] [data-f="role"]`); return;
  }
  if (b.dataset.del) {
    const r = p.schedule.info.crew.find(x => x.id === b.dataset.del);
    if (r && (r.name || r.phone) && !confirm(`Убрать из группы: ${r.role || ''} ${r.name || ''}?`)) return;
    p.schedule.info.crew = p.schedule.info.crew.filter(x => x.id !== b.dataset.del); store.touch(); rerender(); return;
  }
  const act = b.dataset.act;
  if (act === 'paste') { pasteDialog(); return; }
  if (act === 'fill') {
    for (const d of DEPARTMENTS) for (const [role, lead] of ROLES[d] || []) p.schedule.info.crew.push({ id: uid(), dept: d, role, name: '', phone: '', email: '', note: '', lead });
    store.touch(); rerender(); toast('Должности расставлены: впишите имена');
  }
  if (act === 'pdf' || act === 'xlsx') exportCrew(p, act);
});

// ---------- список группы: PDF и Excel ----------
function lists(p) {
  const info = sceneInfo(p), cast = castList(p, info);
  const people = p.schedule.info.crew.filter(r => r.name || r.phone);
  return {
    cast: cast.filter(c => c.actor || c.phone).map(c => [title(c.char), c.actor, c.phone]),
    depts: DEPARTMENTS.map(d => [d, people.filter(r => r.dept === d).map(r => [r.role, r.name, r.phone, r.email, r.note])]).filter(([, l]) => l.length),
  };
}
function exportCrew(p, fmt) {
  const { cast, depts } = lists(p);
  if (!cast.length && !depts.length) return toast('Впишите хотя бы одно имя или телефон');
  const name = safeName(p.name) + ', список группы';
  if (fmt === 'xlsx') {
    const rows = [{ cells: [`Список группы «${p.name}»`], style: 1, height: 28, merge: true }, { cells: ['Должность / персонаж', 'Имя', 'Телефон', 'Почта', 'Заметка'], style: 3, height: 24 }];
    if (cast.length) { rows.push({ cells: ['Актёры'], style: 4, height: 22, merge: true }); for (const c of cast) rows.push({ cells: [...c, '', ''], style: 5 }); }
    for (const [d, l] of depts) { rows.push({ cells: [d], style: 4, height: 22, merge: true }); for (const r of l) rows.push({ cells: r, style: 5 }); }
    download(makeXlsx({ name: 'Группа', widths: [30, 28, 18, 26, 30], rows, freeze: 3 }), name + '.xlsx');
    return toast('Список группы сохранён в загрузки');
  }
  const tr = cells => `<tr>${cells.map(v => `<td>${esc(v || '')}</td>`).join('')}</tr>`;
  printHTML(`<div class="pr-head"><p>Список группы</p><h1>${esc(p.name)}</h1><p>${new Date().toLocaleDateString('ru-RU')}</p></div>
    <table class="pr-table"><thead><tr><th>Должность / персонаж</th><th>Имя</th><th>Телефон</th><th>Почта</th><th>Заметка</th></tr></thead><tbody>
    ${cast.length ? `<tr class="pr-scene"><th colspan="5">Актёры</th></tr>${cast.map(c => tr([...c, '', ''])).join('')}` : ''}
    ${depts.map(([d, l]) => `<tr class="pr-scene"><th colspan="5">${esc(d)}</th></tr>${l.map(tr).join('')}`).join('')}</tbody></table>`, 'size: A4; margin: 12mm;', name);
}

// ---------- вставка списка группы из таблицы (Google Таблицы, Excel) ----------
// Столбцы узнаются по заголовкам: должность (или «кандидат»), этап, ФИО, город, контакты, почта, примечания.
const HEAD = [
  ['role', /должност|кандидат|позиц|роль|цех/i], ['status', /этап|статус|стади/i], ['name', /фио|имя|челов/i],
  ['city', /город/i], ['phone', /контакт|телефон|тел\b|telegram|телеграм/i], ['email', /почт|e-?mail/i], ['note', /примеч|заметк|коммент/i],
];
const normStatus = t => {
  const v = String(t || '').trim().toLowerCase();
  return STATUSES.find(s => s.toLowerCase().replace('ё', 'е') === v.replace('ё', 'е')) || (v ? t.trim() : '');
};
export function parseCrew(text) {
  const lines = String(text).replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const cells = l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, ''));
  const head = cells(lines[0]), map = {};
  head.forEach((h, i) => { const k = HEAD.find(([, re]) => re.test(h)); if (k && map[k[0]] === undefined) map[k[0]] = i; });
  const hasHead = Object.keys(map).length >= 2;
  const cols = hasHead ? map : { role: 0, status: 1, name: 2, city: 3, phone: 4, note: 5 };
  return lines.slice(hasHead ? 1 : 0).map(l => {
    const c = cells(l), g = k => (cols[k] !== undefined ? c[cols[k]] || '' : '');
    const role = g('role').replace(/\s+\d+$/, (m) => m), name = g('name'), city = g('city');
    return { role: g('role'), name, status: normStatus(g('status')), city: /^(нейтрально|неизвестно|удалено)$/i.test(city) ? '' : city, phone: g('phone'), email: g('email'), note: [g('note'), /^(удалено)$/i.test(city) ? 'Удалённо' : ''].filter(Boolean).join('; ') };
  }).filter(r => r.role || r.name);
}

function pasteDialog() {
  const d = document.createElement('dialog');
  d.className = 'ask cr-paste';
  d.innerHTML = `<form method="dialog"><h3>Вставить список группы</h3>
    <p class="ask-text">Скопируйте строки из Google Таблиц или Excel вместе с заголовками и вставьте сюда. Столбцы узнаются по названиям: должность, этап, ФИО, город, контакты, почта, примечания. Цех определится по должности.</p>
    <textarea rows="10" placeholder="Кандидат	Этап	ФИО	Город	Контакты	Примечания"></textarea>
    <p class="ask-text cr-paste-info"></p>
    <div class="ask-row"><button class="act" value="cancel">Отмена</button><button class="act main" value="ok">Добавить в группу</button></div></form>`;
  const ta = d.querySelector('textarea'), info = d.querySelector('.cr-paste-info');
  ta.addEventListener('input', () => { const n = parseCrew(ta.value).length; info.textContent = n ? `Найдено строк: ${n}` : ''; });
  d.addEventListener('close', () => {
    d.classList.add('out'); setTimeout(() => d.remove(), 200);
    if (d.returnValue !== 'ok') return;
    const rows = parseCrew(ta.value);
    if (!rows.length) return toast('Не нашлось ни одной строки');
    const n = importCrew(project(), rows, uid);
    store.touch(); rerender(); toast(`Добавлено в группу: ${n.added}, обновлено: ${n.updated}`);
  });
  document.body.append(d);
  d.showModal();
}

// Строки списка в группу: та же должность с тем же именем (или пустая должность без имени) обновляется, остальное добавляется.
export function importCrew(p, rows, mkid) {
  const crew = p.schedule.info.crew, low = v => String(v || '').trim().toLowerCase();
  let added = 0, updated = 0;
  for (const r of rows) {
    const same = crew.find(c => low(c.role) === low(r.role) && (low(c.name) === low(r.name) || (!c.name && !c.phone)));
    if (same) { for (const k of ['name', 'status', 'city', 'phone', 'email', 'note']) if (r[k]) same[k] = r[k]; updated++; continue; }
    const dept = guessDept(r.role);
    crew.push({ id: mkid(), dept, role: r.role, name: r.name, phone: r.phone, email: r.email, note: r.note, status: r.status, city: r.city, lead: !!r.name && !['Партнёры и контакты', 'Консультанты'].includes(dept) }); // в вызывной — все, кто уже есть, кроме меценатов и консультантов
    added++;
  }
  return { added, updated };
}

// ---------- занятость актёра по датам: КПП предупредит, если его сцена встанет на такой день ----------
function busyDialog(char) {
  const r = castRow(char);
  const d = document.createElement('dialog');
  d.className = 'ask cr-busyd';
  const fmt = v => { const [y, m, dd] = v.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }); };
  const draw = () => {
    r.busy.sort((a, b) => a.date.localeCompare(b.date));
    d.innerHTML = `<form method="dialog"><h3>Занятость: ${esc(title(char))}${r.actor ? ` — ${esc(r.actor)}` : ''}</h3>
      <p class="ask-text">Дни, когда актёр занят на других проектах. Если сцена с ним встанет на такой день, КПП покажет предупреждение.</p>
      <ul class="bz-list">${r.busy.map((b, i) => `<li><b>${esc(fmt(b.date))}</b><span class="bz-kind ${b.kind}">${b.kind === 'part' ? 'частично' : 'занят'}</span><span>${esc(b.note)}</span><button type="button" class="ico" data-bzdel="${i}" aria-label="Убрать">${X}</button></li>`).join('') || '<li class="empty">Свободен во все дни.</li>'}</ul>
      <div class="bz-add"><input type="date" data-bz="date"><select data-bz="kind"><option value="busy">занят</option><option value="part">частично</option></select><input type="text" data-bz="note" placeholder="Где, до скольки"><button type="button" class="act" data-bzadd>Добавить</button></div>
      <div class="bz-add"><span>или период</span><input type="date" data-bz="from"><span>—</span><input type="date" data-bz="to"><button type="button" class="act" data-bzrange>Добавить период</button></div>
      <div class="ask-row"><button class="act main" value="ok">Готово</button></div></form>`;
  };
  draw();
  d.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = k => d.querySelector(`[data-bz="${k}"]`).value;
    if (b.dataset.bzdel !== undefined) { r.busy.splice(+b.dataset.bzdel, 1); store.touch(); draw(); }
    if (b.dataset.bzadd !== undefined) {
      if (!v('date')) return toast('Выберите дату');
      r.busy = r.busy.filter(x => x.date !== v('date')); r.busy.push({ date: v('date'), kind: v('kind'), note: v('note').trim() }); store.touch(); draw();
    }
    if (b.dataset.bzrange !== undefined) {
      const from = v('from'), to = v('to');
      if (!from || !to || to < from) return toast('Укажите начало и конец периода');
      for (let t = new Date(from + 'T12:00'); t <= new Date(to + 'T12:00'); t.setDate(t.getDate() + 1)) {
        const date = t.toISOString().slice(0, 10);
        if (!r.busy.some(x => x.date === date)) r.busy.push({ date, kind: 'busy', note: '' });
      }
      store.touch(); draw();
    }
  });
  d.addEventListener('close', () => { d.classList.add('out'); setTimeout(() => d.remove(), 200); rerender(); });
  document.body.append(d);
  d.showModal();
}

// персонаж без сценария: вписать имя и Enter
view.addEventListener('keydown', e => {
  if (!e.target.matches('.cr-addchar') || e.key !== 'Enter') return;
  e.preventDefault();
  const name = e.target.value.trim().toUpperCase(), sch = project().schedule;
  if (!name) return;
  if (castList(project()).some(c => c.char === name)) { toast('Такой персонаж уже есть'); return; }
  sch.cast.push({ id: uid(), char: name, actor: '', phone: '', busy: [], makeupMin: 0, costumeMin: 0, carMin: 0 });
  store.touch(); rerender('.cr-addchar');
});
