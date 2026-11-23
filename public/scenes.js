// Сцены: список с разбором и страница одной сцены, где собрано всё о ней:
// текст, персонажи и графы разбора, локация с её реквизитом, кадры и планы Shot Designer.
import { store, $, uid, esc, toast, numbering } from './store.js';
import { srcOf } from './storage.js';
import { planSVG } from './shapes.js';
import { createPlan } from './plan.js';
import { CATS, sceneInfo, eighthsText, applyAnalysis, locProps as locPropsOf, locationFromScene } from './breakdown.js';

// Выбор готового плана Shot Designer для сцены. В подписи видно, к какой сцене план привязан сейчас.
export function planSelect(p, sid, info = sceneInfo(p), extra = '') {
  const free = p.plans.filter(x => x.sceneId !== sid);
  if (!free.length) return '';
  const label = x => { const t = info.find(q => q.id === x.sceneId); return `${x.name}${t ? ` · сейчас сцена ${t.n}` : ' · без сцены'}`; };
  return `<select class="loc-link plan-link" data-act="link-plan" data-scene="${sid}"${extra} aria-label="Привязать готовый план"><option value="">Привязать готовый план…</option>
    ${free.filter(x => !x.sceneId).map(x => `<option value="${x.id}">${esc(label(x))}</option>`).join('')}
    ${free.filter(x => x.sceneId).map(x => `<option value="${x.id}">${esc(label(x))}</option>`).join('')}</select>`;
}

const X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const project = () => store.project;
let openId = '';

const items = (p, sid) => p.breakdown.filter(x => x.sceneId === sid && !x.off);
const locsOf = (p, sid) => p.locations.filter(l => l.sceneIds.includes(sid));

// ---------- все сцены ----------

export function renderScenes() {
  const p = project(), base = `#/p/${p.id}`, info = sceneInfo(p);
  const total = info.reduce((a, s) => a + s.eighths, 0);
  const rows = info.map(s => {
    const found = items(p, s.id), l = locsOf(p, s.id);
    const counts = Object.keys(CATS).filter(c => c !== 'cast').map(c => [c, found.filter(x => x.cat === c).length]).filter(([, n]) => n);
    return `<tr data-go="${s.id}">
      <td class="sl-n"><a href="${base}/scene/${s.id}">${s.n}</a></td>
      <td><span class="ie ie-${s.ie === 'НАТ' ? 'ext' : s.ie === 'ИНТ' ? 'int' : 'mix'}">${esc(s.ie || '—')}</span></td>
      <td class="sl-place"><a href="${base}/scene/${s.id}">${esc(s.place || s.text || 'Без названия')}</a></td>
      <td>${esc(s.time)}</td><td>${esc(s.day)}</td>
      <td class="num">${eighthsText(s.eighths)}</td><td class="num">${esc(s.dur)}</td>
      <td class="sl-cast">${esc([...s.chars, ...found.filter(x => x.cat === 'cast').map(x => x.text.toUpperCase())].join(', '))}</td>
      <td class="sl-found">${counts.map(([c, n]) => `<span class="cat-dot cat-${c}" title="${CATS[c]}">${CATS[c]} ${n}</span>`).join('')}</td>
      <td>${l.map(x => `<button class="linkbtn" data-loc-open="${x.id}">${esc(x.name)}</button>`).join(', ')}</td></tr>`;
  }).join('');
  $('#view-scenes').innerHTML = `<div class="page page-wide">
    <header class="page-head"><h1>Сцены и разбор</h1>${info.length ? '<button class="act main" data-act="analyze-all">Разобрать все сцены</button>' : ''}</header>
    <p class="page-hint">${info.length ? `Сцен: ${info.length}, всего ${eighthsText(total)} стр. Длина в восьмых страницы. Персонажи берутся из сценария сами. Кнопка «Разобрать» ищет в тексте реквизит, костюм, транспорт, животных, массовку, грим, трюки, эффекты и звук. Найденное можно убрать или дополнить; глубже разберёт подключённый ИИ-помощник.` : 'Сцены появятся, когда в сценарии будут строки «Время и место».'}</p>
    ${info.length ? `<div class="sl-wrap"><table class="sl"><thead><tr><th>№</th><th>Инт/Нат</th><th>Место</th><th>Время</th><th>День</th><th>Длина</th><th>Хрон.</th><th>Персонажи</th><th>Разбор</th><th>Локация</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
  </div>`;
}

$('#view-scenes').addEventListener('click', e => {
  if (e.target.closest('[data-act="analyze-all"]')) {
    const p = project(), n = applyAnalysis(p, sceneInfo(p).map(s => s.id), uid);
    store.touch(); renderScenes();
    toast(n ? `Найдено и добавлено: ${n}` : 'Нового не нашлось');
    return;
  }
  const tr = e.target.closest('tr[data-go]');
  if (tr && !e.target.closest('a, button')) location.hash = `#/p/${project().id}/scene/${tr.dataset.go}`;
});

// ---------- одна сцена ----------

export function mountScene(id) { openId = id; renderScene(); }

export function renderScene() {
  const p = project(), base = `#/p/${p.id}`, info = sceneInfo(p), i = info.findIndex(s => s.id === openId), s = info[i];
  if (!s) return;
  const nums = numbering(p), found = items(p, s.id), locs = locsOf(p, s.id);
  const plans = p.plans.filter(x => x.sceneId === s.id), shots = p.shots.filter(x => x.sceneId === s.id);
  const chip = x => `<span class="bd-chip${x.auto ? ' auto' : ''}" data-item="${x.id}" title="${x.auto ? 'Записано автоматически (словарём программы или ИИ-помощником), проверьте. Щёлкните, чтобы исправить' : 'Щёлкните, чтобы исправить'}"><span class="bd-t" data-act="edit-item" role="button" tabindex="0">${esc(x.text)}</span><button class="bd-x" data-act="del-item" aria-label="Убрать">${X}</button></span>`;
  const cat = c => `<div class="bd-cat cat-${c}" data-cat="${c}"><h4>${CATS[c]}</h4><div class="bd-chips">
      ${c === 'cast' ? s.chars.map(n => `<span class="bd-chip script" title="${s.speaking.has(n) ? 'Говорит в сцене' : 'Упомянут в действии'}">${esc(n)}${s.speaking.has(n) ? '' : ' <i>без слов</i>'}</span>`).join('') : ''}
      ${found.filter(x => x.cat === c).map(chip).join('')}
      ${c === 'props' ? locPropsOf(p, s.id).filter(x => !found.some(f => f.text.toLowerCase() === x.text.toLowerCase())).map(x => `<a class="bd-chip from-loc" href="${base}/loc/${x.loc.id}" title="Из постановочного реквизита локации «${esc(x.loc.name)}». Править в локации">${esc(x.text)}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg></a>`).join('') : ''}
      <input class="bd-add" type="text" placeholder="+ добавить" aria-label="Добавить: ${CATS[c]}"></div></div>`;
  const body = s.blocks.filter(b => b.text.trim()).map(b => `<div data-type="${b.type}">${esc(b.text)}</div>`).join('');
  const freeLocs = p.locations.filter(l => !l.sceneIds.includes(s.id));
  const locProps = l => l.props.filter(x => x.sceneId === s.id && x.text.trim());

  $('#view-scene').innerHTML = `<div class="page page-wide scn">
    <header class="scn-head">
      <a class="ico" ${i > 0 ? `href="${base}/scene/${info[i - 1].id}"` : 'aria-disabled="true"'} title="Предыдущая сцена" aria-label="Предыдущая сцена"><svg viewBox="0 0 24 24"><path d="M14 6l-6 6 6 6"/></svg></a>
      <a class="ico" ${i < info.length - 1 ? `href="${base}/scene/${info[i + 1].id}"` : 'aria-disabled="true"'} title="Следующая сцена" aria-label="Следующая сцена"><svg viewBox="0 0 24 24"><path d="M10 6l6 6-6 6"/></svg></a>
      <h1><span>Сцена ${s.n}</span> ${esc(s.place || s.text)}</h1>
      <a class="act" href="${base}/script/${s.id}">Править текст</a>
      <button class="act main" data-act="analyze">Разобрать сцену</button>
    </header>
    <p class="scn-meta">${[s.ie && `<span class="ie ie-${s.ie === 'НАТ' ? 'ext' : s.ie === 'ИНТ' ? 'int' : 'mix'}">${esc(s.ie)}</span>`, s.time, s.day, `${eighthsText(s.eighths)} стр.`, s.dur && `хрон. ${esc(s.dur)}`].filter(Boolean).map(x => `<span>${x}</span>`).join('')}</p>

    <div class="scn-grid">
      <section class="scn-text"><div class="sheet scn-sheet"><div data-type="scene">${esc(s.text)}</div>${body}</div></section>
      <section class="scn-bd">
        <h2>Разбор</h2>
        <div class="bd">${Object.keys(CATS).map(cat).join('')}</div>
        <p class="page-hint">Пунктирная рамка: найдено в тексте автоматически, проверьте. Убранное повторный разбор не вернёт.</p>
      </section>
    </div>

    <div class="scn-cols">
      <section><h2>Локация</h2>
        ${locs.map(l => `<div class="scn-loc"><button class="scn-loc-card" data-loc-open="${l.id}" title="Показать локацию рядом">
            <span class="thumb loc-thumb">${l.photos[0] ? `<img src="${esc(srcOf(l.photos[0].src))}" alt="" loading="lazy">` : ''}</span><b>${esc(l.name)}</b></button>
            ${locProps(l).length ? `<p class="sub">Реквизит локации для этой сцены</p><ul class="sp-props">${locProps(l).map(x => `<li${x.ready ? ' class="ready"' : ''}>${esc(x.text)}</li>`).join('')}</ul>` : ''}
            <a class="linkbtn" href="${base}/loc/${l.id}">Открыть локацию</a></div>`).join('') || '<p class="empty">Сцена пока не привязана к локации.</p>'}
        ${freeLocs.length ? `<select class="loc-link" data-act="link-loc"><option value="">Привязать к локации…</option>${freeLocs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>` : ''}
        <button class="act scn-new-loc" data-act="new-loc" title="Название из шапки, сцены с тем же местом и реквизит из их разбора заполнятся сами">Создать локацию из разбора</button>
      </section>
      <section><h2>Кадры <span>${shots.length || ''}</span></h2>
        ${shots.length ? `<ol class="scn-shots">${shots.map(x => `<li><b>${nums.get(x.id)}</b>${x.frame ? `<img src="${esc(srcOf(x.frame))}" alt="" loading="lazy">` : '<span class="scn-noframe"></span>'}<span><i>${esc(x.size)}${x.move && x.move !== 'Статика' ? ', ' + esc(x.move.toLowerCase()) : ''}</i>${esc(x.content) || '<span class="empty">без описания</span>'}</span></li>`).join('')}</ol>` : '<p class="empty">Кадров пока нет.</p>'}
        <a class="act" href="${base}/director">Режиссёрский сценарий</a>
      </section>
      <section><h2>Shot Designer</h2>
        <div class="loc-plans">${plans.map(x => `<button class="plan-tile" data-plan-open="${x.id}" title="Показать рядом"><span class="thumb">${planSVG(x, { pad: 0.8 })}</span><span class="tile-name">${esc(x.name)}</span></button>`).join('')}
          <button class="plan-tile plan-new" data-act="new-plan"><span class="thumb">${PLUS}</span><span class="tile-name">Новый план</span></button></div>
        ${planSelect(p, s.id, info)}
        ${plans.length ? '<p class="tile-hint">Правая кнопка по плану: отвязать или удалить</p>' : ''}
      </section>
    </div>
  </div>`;
}

const view = $('#view-scene');
// Исправить запись разбора: щелчок по тексту превращает его в поле. Enter или щелчок мимо сохраняют, Escape отменяет.
// Исправленное считается проверенным человеком и теряет пунктир.
function editItem(t) {
  const chip = t.closest('[data-item]'), x = project().breakdown.find(q => q.id === chip.dataset.item);
  if (!x || chip.classList.contains('editing')) return;
  chip.classList.add('editing');
  const inp = document.createElement('input');
  inp.className = 'bd-edit';
  inp.value = x.text;
  inp.setAttribute('aria-label', 'Исправить запись');
  const fit = () => { inp.style.width = Math.min(420, Math.max(60, inp.value.length * 7.4 + 18)) + 'px'; };
  fit();
  t.replaceWith(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    const text = inp.value.trim();
    if (save && text !== x.text) {
      if (!text) { if (x.auto) { x.off = true; delete x.offBy; } else project().breakdown = project().breakdown.filter(q => q !== x); }
      else { x.text = text; x.auto = false; }
      store.touch();
    } else if (save && x.auto) { x.auto = false; store.touch(); } // Enter без правки: «проверено»
    renderScene();
  };
  inp.addEventListener('input', fit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
}

view.addEventListener('click', e => {
  const t = e.target.closest('[data-act="edit-item"]');
  if (t) { editItem(t); return; }
  const p = project(), b = e.target.closest('button[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'analyze') {
    const n = applyAnalysis(p, [openId], uid);
    store.touch(); renderScene();
    toast(n ? `Найдено и добавлено: ${n}` : 'Нового не нашлось');
  }
  if (act === 'del-item') {
    const x = p.breakdown.find(q => q.id === b.closest('[data-item]').dataset.item);
    if (!x) return;
    // найденное автоматически помечаем убранным, чтобы повторный разбор его не вернул
    if (x.auto) { x.off = true; delete x.offBy; } else p.breakdown = p.breakdown.filter(q => q !== x);
    store.touch(); renderScene();
  }
  if (act === 'new-loc') {
    const l = locationFromScene(p, openId, uid);
    if (!l) return;
    store.touch();
    toast(`Локация создана: сцен ${l.sceneIds.length}, реквизита ${l.props.length}`);
    location.hash = `#/p/${p.id}/loc/${l.id}`;
  }
  if (act === 'new-plan') {
    const s = sceneInfo(p).find(x => x.id === openId), l = locsOf(p, openId)[0];
    location.hash = `#/p/${p.id}/plan/${createPlan({ name: `${s.place || 'План'} (сц. ${s.n})`, objects: [], sceneId: openId, locationId: l ? l.id : '' })}`;
  }
});
view.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act="edit-item"]')) { e.preventDefault(); editItem(e.target); return; }
  if (e.key !== 'Enter' || !e.target.matches('.bd-add')) return;
  const text = e.target.value.trim(), c = e.target.closest('[data-cat]').dataset.cat;
  if (!text) return;
  const p = project(), old = p.breakdown.find(x => x.sceneId === openId && x.cat === c && x.text.toLowerCase() === text.toLowerCase());
  if (old) old.off = false; else p.breakdown.push({ id: uid(), sceneId: openId, cat: c, text, auto: false, off: false });
  store.touch(); renderScene();
  $(`.bd-cat[data-cat="${c}"] .bd-add`, view).focus();
});
view.addEventListener('change', e => {
  if (e.target.dataset.act === 'link-plan' && e.target.value) {
    const p = project(), pl = p.plans.find(x => x.id === e.target.value);
    if (pl) {
      pl.sceneId = openId;
      const l = locsOf(p, openId)[0];
      if (l && !pl.locationId) pl.locationId = l.id;
      store.touch(); renderScene(); toast(`План «${pl.name}» привязан к сцене`);
    }
    return;
  }
  if (e.target.dataset.act !== 'link-loc' || !e.target.value) return;
  const l = project().locations.find(x => x.id === e.target.value);
  if (l) { l.sceneIds.push(openId); store.touch(); renderScene(); }
});
