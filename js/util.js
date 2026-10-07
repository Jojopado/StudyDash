export const TYPES = {
  exam:     { label: '考試',    color: '#f87171' },
  report:   { label: '報告',    color: '#fbbf24' },
  homework: { label: '作業',    color: '#c084fc' },
  study:    { label: '自學',    color: '#4ade80' },
  meeting:  { label: 'Meeting', color: '#60a5fa' },
  other:    { label: '其他',    color: '#94a3b8' },
};
// 首頁倒數區只顯示這些「有期限」的類型
export const DEADLINE_TYPES = ['exam', 'report', 'homework'];

export const TOPIC_COLORS = ['#4ade80', '#60a5fa', '#c084fc', '#fbbf24', '#f87171', '#2dd4bf', '#f472b6', '#94a3b8'];

export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export const today = () => ymd(new Date());
export function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
export function daysUntil(s) { return Math.round((parseYmd(s) - parseYmd(today())) / 86400000); }

export function fmtDate(s, withWeekday = true) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}` + (withWeekday ? `（${WEEKDAYS[d.getDay()]}）` : '');
}

export function countdown(s) {
  const n = daysUntil(s);
  if (n < 0) return { text: `逾期 ${-n} 天`, cls: 'late' };
  if (n === 0) return { text: '今天', cls: 'hot' };
  if (n === 1) return { text: '明天', cls: 'hot' };
  if (n <= 3) return { text: `剩 ${n} 天`, cls: 'hot' };
  if (n <= 7) return { text: `剩 ${n} 天`, cls: 'warm' };
  return { text: `剩 ${n} 天`, cls: '' };
}

export const byDateTime = (a, b) =>
  a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
