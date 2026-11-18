// Поле значения: надпись слева, справа окошко с числом и стрелками ◀ ▶.
// Стрелку можно нажать (шаг) или зажать и вести мышь влево-вправо: медленное движение меняет значение
// совсем понемногу, широкий взмах сильно. Число можно вписать руками.

export function scrubField(key, label, value, { step = 0.05, min = '', max = '' } = {}) {
  return `<div class="field spinrow"><span>${label}</span><div class="spin" data-step="${step}" data-min="${min}" data-max="${max}">
    <button type="button" class="spin-arrow" data-dir="-1" tabindex="-1" aria-label="Меньше" title="Нажмите или зажмите и ведите влево-вправо">◀</button>
    <input type="number" data-key="${key}" value="${value}" step="${step}"${min !== '' ? ` min="${min}"` : ''}${max !== '' ? ` max="${max}"` : ''} aria-label="${label}">
    <button type="button" class="spin-arrow" data-dir="1" tabindex="-1" aria-label="Больше" title="Нажмите или зажмите и ведите влево-вправо">▶</button>
  </div></div>`;
}

const decimals = step => (String(step).split('.')[1] || '').length;

document.addEventListener('pointerdown', e => {
  const arrow = e.target.closest('.spin-arrow');
  if (!arrow || e.button > 0) return;
  const spin = arrow.parentElement, input = spin.querySelector('input');
  const step = +spin.dataset.step || 1, places = Math.min(4, decimals(step) + 1);
  const min = spin.dataset.min === '' ? -Infinity : +spin.dataset.min;
  const max = spin.dataset.max === '' ? Infinity : +spin.dataset.max;
  let val = parseFloat(input.value) || 0, lastX = e.clientX, moved = 0;
  e.preventDefault();
  try { arrow.setPointerCapture(e.pointerId); } catch { /* синтетическое событие */ }
  spin.classList.add('on');
  const show = () => {
    const text = String(+val.toFixed(places));
    if (input.value !== text) { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); }
  };
  const move = ev => {
    const dx = ev.clientX - lastX;
    if (!dx) return;
    lastX = ev.clientX;
    moved += Math.abs(dx);
    const v = Math.abs(dx);
    // кривая чувствительности: 1 пиксель ≈ 0,05 шага, 5 пикселей ≈ 0,6 шага, 20 пикселей ≈ 9 шагов
    const gain = 0.04 * v + 0.02 * v * v;
    val = Math.min(max, Math.max(min, val + Math.sign(dx) * gain * step));
    show();
  };
  const up = () => {
    arrow.removeEventListener('pointermove', move);
    spin.classList.remove('on');
    if (moved < 3) { val = Math.min(max, Math.max(min, (parseFloat(input.value) || 0) + step * +arrow.dataset.dir)); show(); }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  arrow.addEventListener('pointermove', move);
  arrow.addEventListener('pointerup', up, { once: true });
  arrow.addEventListener('pointercancel', up, { once: true });
});

// Окно с текстом и полем: замена prompt(), которого в программе (Electron) нет.
// readonly: показать готовый текст с кнопкой «Скопировать». Возвращает введённое или null, если закрыли.
export function ask(title, { text = '', value = '', placeholder = '', readonly = false, ok = 'Готово' } = {}) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'ask';
    d.innerHTML = `<form method="dialog">
      <h3></h3>${text ? '<p class="ask-text"></p>' : ''}
      <textarea rows="${readonly ? 4 : 2}" spellcheck="false"${readonly ? ' readonly' : ''}></textarea>
      <div class="ask-row">${readonly ? '<button type="button" class="act" data-copy>Скопировать</button>' : '<button type="button" class="act" data-cancel>Отмена</button>'}<button class="act main" value="ok"></button></div>
    </form>`;
    d.querySelector('h3').textContent = title;
    if (text) d.querySelector('.ask-text').textContent = text;
    const area = d.querySelector('textarea');
    area.value = value;
    area.placeholder = placeholder;
    d.querySelector('[value="ok"]').textContent = ok;
    const copy = d.querySelector('[data-copy]');
    if (copy) copy.onclick = async () => {
      try { await navigator.clipboard.writeText(area.value); } catch { area.select(); document.execCommand('copy'); }
      copy.textContent = 'Скопировано';
    };
    const cancel = d.querySelector('[data-cancel]');
    if (cancel) cancel.onclick = () => d.close('');
    area.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !readonly) { e.preventDefault(); d.close('ok'); } });
    d.addEventListener('close', () => {
      resolve(d.returnValue === 'ok' ? area.value : null);
      d.classList.add('out');
      setTimeout(() => d.remove(), 200);
    });
    document.body.append(d);
    d.showModal();
    if (readonly) area.select(); else area.focus();
  });
}
