// 課表：節次時間、「二5-6, 四2-4」這種寫法的解析，以及某天有哪些課
import { parseYmd, esc } from './util.js';

// 虎科節次（第 5 節之後是下午）
export const PERIODS = {
  1: ['08:10', '09:00'], 2: ['09:10', '10:00'], 3: ['10:10', '11:00'], 4: ['11:10', '12:00'],
  5: ['13:20', '14:10'], 6: ['14:20', '15:10'], 7: ['15:20', '16:10'], 8: ['16:20', '17:10'],
  9: ['17:20', '18:10'], 10: ['18:30', '19:20'], 11: ['19:25', '20:15'], 12: ['20:20', '21:10'], 13: ['21:15', '22:05'],
};

const DAY_CH = '日一二三四五六';

// 「二5-6, 四2-4」→ [{ day: 2, from: 5, to: 6 }, …]；看不懂的部分丟掉
export function parseSlots(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/([日一二三四五六])\s*(\d{1,2})(?:\s*[-~～－]\s*(\d{1,2}))?/g)) {
    const from = +m[2], to = +(m[3] || m[2]);
    if (PERIODS[from] && PERIODS[to] && to >= from) out.push({ day: DAY_CH.indexOf(m[1]), from, to });
  }
  return out;
}

export const fmtSlots = slots =>
  (slots || []).map(s => `${DAY_CH[s.day]}${s.from}${s.to > s.from ? `-${s.to}` : ''}`).join(', ');

export const slotTime = s => `${PERIODS[s.from][0]}–${PERIODS[s.to][1]}`;

// 某天（YYYY-MM-DD）的課，依時間排好
export function classesOn(ds, courses) {
  const day = parseYmd(ds).getDay();
  const out = [];
  for (const c of courses || []) {
    if ((c.start && ds < c.start) || (c.end && ds > c.end)) continue;
    for (const s of c.slots || []) if (s.day === day) out.push({ c, s, time: PERIODS[s.from][0] });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

export function classRow({ c, s }) {
  return `<div class="ev cls" data-action="edit-course" data-id="${c.id}">
    <span class="cls-time">${PERIODS[s.from][0]}<br>${PERIODS[s.to][1]}</span>
    <span class="bar" style="background:${esc(c.color)}"></span>
    <div class="main"><div class="title">${esc(c.name)}</div><div class="meta">${[c.room, c.teacher].filter(Boolean).map(esc).join(' · ')}</div></div>
  </div>`;
}

export const courseById = (courses, id) => (courses || []).find(c => c.id === id);

// 「二 13:20–15:10、四 09:10–12:00」：節次換成實際時間
export const fmtSlotTimes = slots =>
  (slots || []).map(s => `${DAY_CH[s.day]} ${slotTime(s)}`).join('、');

// 週課表：一列一節（左邊標上課時間），課程依節次跨列
export function timetable(courses) {
  const slots = (courses || []).flatMap(c => (c.slots || []).map(s => ({ c, s })));
  if (!slots.length) return '';
  const days = [1, 2, 3, 4, 5].concat([6, 0].filter(d => slots.some(x => x.s.day === d)));
  const first = Math.min(...slots.map(x => x.s.from));
  const last = Math.max(...slots.map(x => x.s.to));
  const rowOf = p => p - first + 2;
  let cells = `<div class="tt-corner"></div>${days.map((d, i) => `<div class="tt-day" style="grid-column:${i + 2}">${DAY_CH[d]}</div>`).join('')}`;
  for (let p = first; p <= last; p++) {
    cells += `<div class="tt-time" style="grid-row:${rowOf(p)}"><b>${p}</b><span>${PERIODS[p][0]}</span><span>${PERIODS[p][1]}</span></div>`;
    for (let i = 0; i < days.length; i++) cells += `<div class="tt-cell" style="grid-row:${rowOf(p)};grid-column:${i + 2}"></div>`;
  }
  for (const { c, s } of slots) {
    const col = days.indexOf(s.day) + 2;
    cells += `<div class="tt-class" data-action="edit-course" data-id="${c.id}" title="${esc(c.name)} ${slotTime(s)}"
      style="grid-column:${col};grid-row:${rowOf(s.from)} / ${rowOf(s.to) + 1};background:${esc(c.color)}22;border-color:${esc(c.color)}">
      <b>${esc(c.name)}</b><span>${slotTime(s)}</span>${c.room ? `<span>${esc(c.room)}</span>` : ''}</div>`;
  }
  return `<div class="tt" style="grid-template-columns:46px repeat(${days.length}, 1fr);grid-template-rows:auto repeat(${last - first + 1}, minmax(44px, auto))">${cells}</div>`;
}
