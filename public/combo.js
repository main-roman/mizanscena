// Поле со списком, где список всегда полный: у заполненного поля браузер показывает в подсказках только
// совпадающее с уже вписанным, а здесь щелчок открывает все варианты, и вписанное можно сразу сменить.
// Подключение: <input data-combo="id-datalist">. Пока печатают — список сужается по вписанному.
import { esc } from './store.js';

let box = null, cur = null, items = [], hi = -1, startValue = '';

function options(input) {
  const dl = document.getElementById(input.dataset.combo);
  return dl ? [...dl.options].map(o => o.value).filter(Boolean) : [];
}
function show(input, all) {
  const v = input.value.trim().toLowerCase();
  const list = options(input);
  items = all || !v ? list : list.filter(x => x.toLowerCase().includes(v));
  if (!items.length) return hide();
  if (!box) {
    box = document.createElement('div');
    box.className = 'combo-box';
    box.setAttribute('role', 'listbox');
    box.addEventListener('pointerdown', e => e.preventDefault()); // фокус остаётся в поле
    box.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) pick(+b.dataset.i); });
    document.body.append(box);
  }
  cur = input;
  hi = items.findIndex(x => x.toLowerCase() === v);
  box.innerHTML = items.map((x, i) => `<button type="button" data-i="${i}" class="${i === hi ? 'on' : ''}" role="option">${esc(x)}</button>`).join('');
  const r = input.getBoundingClientRect(), h = Math.min(280, items.length * 30 + 8), below = innerHeight - r.bottom > h + 8;
  Object.assign(box.style, { left: Math.max(8, Math.min(r.left, innerWidth - Math.max(r.width, 200) - 8)) + 'px', top: (below ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px', minWidth: Math.max(r.width, 200) + 'px' });
  box.classList.add('on');
  box.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
function hide() { if (box) box.classList.remove('on'); cur = null; hi = -1; }
function pick(i) {
  const input = cur, v = items[i];
  if (!input || v == null) return;
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  hide();
}
const mark = () => { if (!box) return; [...box.children].forEach((b, k) => b.classList.toggle('on', k === hi)); box.children[hi]?.scrollIntoView({ block: 'nearest' }); };

document.addEventListener('focusin', e => { const i = e.target; if (i.matches && i.matches('input[data-combo]')) { startValue = i.value; show(i, true); } });
document.addEventListener('click', e => { const i = e.target; if (i.matches && i.matches('input[data-combo]') && (!box || !box.classList.contains('on'))) show(i, true); });
document.addEventListener('input', e => { const i = e.target; if (i.matches && i.matches('input[data-combo]') && i === document.activeElement) show(i, i.value === startValue); });
document.addEventListener('focusout', e => { if (e.target === cur) hide(); });
document.addEventListener('keydown', e => {
  if (!cur || e.target !== cur || !box || !box.classList.contains('on')) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(items.length - 1, hi + 1); mark(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, hi - 1); mark(); }
  else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); pick(hi); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
}, true);
addEventListener('scroll', e => { if (cur && !(box && box.contains(e.target))) hide(); }, true);
addEventListener('resize', hide);
