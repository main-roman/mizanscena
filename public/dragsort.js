// Перетаскивание мышью без встроенного drag-and-drop браузера: пока элемент «в руке»,
// страница листается колёсиком, а у верхнего и нижнего края окна прокручивается сама.
//
// pointerDrag(root, {
//   pick(e)            -> { el, data } | null  — что берём (el — то, что поедет за мышью);
//   move(data, x, y)   — подсветить, куда встанет;
//   drop(data, x, y)   — положить;
//   end(data)          — снять подсветку (и после drop, и после отмены);
//   scroller           — что прокручивать (по умолчанию root).
// })

const EDGE = 80;      // насколько близко к краю начинается автопрокрутка, px
const SPEED = 24;     // самая быстрая автопрокрутка за кадр, px
const START = 6;
let quietUntil = 0;
addEventListener('click', e => { if (performance.now() < quietUntil) { e.stopPropagation(); e.preventDefault(); } }, true);      // на сколько сдвинуть мышь, чтобы это стало перетаскиванием, а не щелчком

export function pointerDrag(root, opt) {
  const scroller = opt.scroller || root;
  let cur = null; // { data, el, ghost, dx, dy, x, y, started, sx, sy, raf }

  const place = () => {
    if (!cur || !cur.ghost) return;
    cur.ghost.style.transform = `translate(${cur.x - cur.dx}px, ${cur.y - cur.dy}px) rotate(.6deg)`;
  };

  // автопрокрутка у края: чем ближе к краю, тем быстрее
  const tick = () => {
    if (!cur || !cur.started) return;
    const r = scroller.getBoundingClientRect();
    let v = 0;
    if (cur.y < r.top + EDGE) v = -SPEED * Math.min(1, (r.top + EDGE - cur.y) / EDGE);
    else if (cur.y > r.bottom - EDGE) v = SPEED * Math.min(1, (cur.y - (r.bottom - EDGE)) / EDGE);
    if (v) { scroller.scrollTop += v; opt.move(cur.data, cur.x, cur.y); }
  };

  const begin = () => {
    const r = cur.el.getBoundingClientRect();
    cur.dx = cur.sx - r.left; cur.dy = cur.sy - r.top;
    const g = cur.el.cloneNode(true);
    g.classList.add('drag-ghost');
    g.removeAttribute('id');
    Object.assign(g.style, { width: r.width + 'px', left: '0', top: '0' });
    document.body.append(g);
    cur.ghost = g;
    cur.el.classList.add('drag-src');
    document.body.classList.add('dragging-now');
    cur.started = true;
    place();
    cur.timer = setInterval(tick, 16); // таймер, а не кадры анимации: едет, даже если окно не перерисовывается
  };

  const finish = ok => {
    if (!cur) return;
    const c = cur;
    cur = null;
    clearInterval(c.timer);
    removeEventListener('pointermove', onMove, true);
    removeEventListener('pointerup', onUp, true);
    removeEventListener('keydown', onKey, true);
    scroller.removeEventListener('scroll', onScroll);
    if (!c.started) return;
    c.ghost.remove();
    c.el.classList.remove('drag-src');
    document.body.classList.remove('dragging-now');
    // щелчок, который браузер пришлёт сразу после отпускания, — не щелчок, а конец перетаскивания
    quietUntil = performance.now() + 250;
    if (ok) opt.drop(c.data, c.x, c.y);
    opt.end && opt.end(c.data);
  };

  const onMove = e => {
    if (!cur) return;
    cur.x = e.clientX; cur.y = e.clientY;
    if (!cur.started) {
      if (Math.hypot(cur.x - cur.sx, cur.y - cur.sy) < START) return;
      begin();
    }
    e.preventDefault();
    place();
    opt.move(cur.data, cur.x, cur.y);
  };
  const onUp = () => finish(true);
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } };
  // листают колёсиком — то, что под мышью, поменялось
  const onScroll = () => { if (cur && cur.started) opt.move(cur.data, cur.x, cur.y); };

  root.addEventListener('pointerdown', e => {
    if (e.button !== 0 || cur) return;
    const got = opt.pick(e);
    if (!got) return;
    cur = { ...got, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, started: false };
    addEventListener('pointermove', onMove, true);
    addEventListener('pointerup', onUp, true);
    addEventListener('keydown', onKey, true);
    scroller.addEventListener('scroll', onScroll, { passive: true });
  });
}
