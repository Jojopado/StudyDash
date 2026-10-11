// 拖曳排序：按住每列左邊的 ⋮⋮ 上下拖，放開就存新的順序。
// 用 pointer 事件（手機觸控和滑鼠都能用）；列上要有 data-drag-id，同一個 data-drag-group 之間才能換位置。
// 拖曳中不重畫畫面（app.js 用 isDragging() 擋住），放開後由 onDrop 存檔再重畫。

let drag = null;
export const isDragging = () => !!drag;

const handlers = {}; // list 名稱 → (id, beforeId, afterId) => void
export function onDrop(list, fn) { handlers[list] = fn; }

export const handle = () => '<span class="drag-handle" data-action="noop" aria-label="拖曳排序" title="按住拖曳排序">⋮⋮</span>';

function rowsOf(d) {
  return [...d.box.querySelectorAll(`[data-drag-id][data-drag-group="${CSS.escape(d.group)}"]`)];
}

function start(ev) {
  const h = ev.target.closest('.drag-handle');
  if (!h || ev.button > 0) return;
  const row = h.closest('[data-drag-id]');
  const box = row?.closest('[data-drag-list]');
  if (!row || !box) return;
  ev.preventDefault();
  drag = { row, box, list: box.dataset.dragList, group: row.dataset.dragGroup || '', y0: ev.clientY, y: ev.clientY, target: null, pid: ev.pointerId, sy: window.scrollY };
  h.setPointerCapture?.(ev.pointerId);
  row.classList.add('dragging');
  document.body.classList.add('is-dragging');
  scrollLoop();
}

function move(ev) {
  if (!drag || ev.pointerId !== drag.pid) return;
  ev.preventDefault();
  drag.y = ev.clientY;
  update();
}

function update() {
  const d = drag;
  d.row.style.transform = `translateY(${d.y - d.y0 + (window.scrollY - d.sy)}px)`;
  const rows = rowsOf(d).filter(r => r !== d.row);
  let before = null; // 放在哪一列的前面（null = 最後面）
  for (const r of rows) {
    const b = r.getBoundingClientRect();
    if (d.y < b.top + b.height / 2) { before = r; break; }
  }
  for (const r of rows) r.classList.remove('drop-before', 'drop-after');
  if (before) before.classList.add('drop-before');
  else if (rows.length) rows[rows.length - 1].classList.add('drop-after');
  d.target = before;
}

// 拖到畫面上下邊緣時自動捲動
function scrollLoop() {
  if (!drag) return;
  const edge = 70, y = drag.y;
  const v = y < edge ? -(edge - y) / 4 : y > innerHeight - edge ? (y - (innerHeight - edge)) / 4 : 0;
  if (v) { window.scrollBy(0, v); update(); }
  requestAnimationFrame(scrollLoop);
}

function end(ev) {
  if (!drag || ev.pointerId !== drag.pid) return;
  const d = drag;
  drag = null;
  document.body.classList.remove('is-dragging');
  d.row.classList.remove('dragging');
  d.row.style.transform = '';
  const rows = rowsOf(d);
  rows.forEach(r => r.classList.remove('drop-before', 'drop-after'));
  if (ev.type === 'pointercancel' || Math.abs(d.y - d.y0) < 4) { window.dispatchEvent(new Event('drag-end')); return; }
  const rest = rows.filter(r => r !== d.row);
  const i = d.target ? rest.indexOf(d.target) : rest.length;
  const beforeId = rest[i - 1]?.dataset.dragId || null; // 新位置上面那列
  const afterId = rest[i]?.dataset.dragId || null;      // 新位置下面那列
  const old = rows.indexOf(d.row);
  const moved = (rows[old - 1]?.dataset.dragId || null) !== beforeId;
  if (moved) handlers[d.list]?.(d.row.dataset.dragId, beforeId, afterId);
  window.dispatchEvent(new Event('drag-end'));
}

// 依「上下兩列的排序值」算出新的排序值（放中間）
export function between(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return b - 1000;
  if (b == null) return a + 1000;
  return (a + b) / 2;
}

document.addEventListener('pointerdown', start);
document.addEventListener('pointermove', move, { passive: false });
document.addEventListener('pointerup', end);
document.addEventListener('pointercancel', end);
