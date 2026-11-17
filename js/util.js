// Small helpers shared by all modules.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => HTML_ESC[c]);
}

// crypto.randomUUID only exists in secure contexts (https, localhost).
// On the local network (http://192.168…) we fall back to time + random.
export function uid() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch (_) { /* fall through */ }
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Lowercase, no accents, ß -> ss, only letters and digits separated by single spaces.
export function norm(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const thisYear = () => new Date().getFullYear();

// Current date as a fractional year, e.g. 2026.88 in mid-November.
export function yearFrac() {
  const d = new Date();
  const start = new Date(d.getFullYear(), 0, 1);
  const next = new Date(d.getFullYear() + 1, 0, 1);
  return d.getFullYear() + (d - start) / (next - start);
}

export function fmtEuro(n) {
  return new Intl.NumberFormat('de-AT', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n);
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('de-AT', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Short vibration on phones that support it (Android). iPhones ignore it.
export function buzz(ms = 10) {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  try { navigator.vibrate?.(ms); } catch (_) { /* ignore */ }
}

export function toInt(value) {
  const m = String(value ?? '').match(/-?\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

export function toNum(value) {
  if (value === '' || value == null) return null;
  const n = parseFloat(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

// "21" -> 2021, "98" -> 1998, "2019" -> 2019
export function toYear(value) {
  let n = toInt(value);
  if (n == null) return null;
  if (n >= 0 && n <= 99) {
    const cut = (thisYear() + 1) % 100;
    n += n <= cut ? 2000 : 1900;
  }
  return n;
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
