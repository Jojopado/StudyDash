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
