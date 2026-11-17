// Weinkeller – screens, flows and wiring.

import { $, $$, esc, uid, norm, thisYear, fmtEuro, fmtDate, debounce, buzz, toInt, toNum, toYear, plural } from './util.js';
import { icon } from './icons.js';
import * as db from './db.js';
import { fileToImage, imageToDataUrl } from './image.js';
import {
  COLORS, STATUS, status, windowBar, vivinoUrl, wineSearcherUrl, GRAPES, grapesOf, normCountry, FLAGS,
  rankForFood, pairingReason, matchKey, bottleSvg, tileClass, flagOf, tasteOf, cleanTaste,
  typeKeys, sweetOptions, sweetLabel, PLACE_KINDS, hasGrid, slotLabel, slotKeys, validSlot, pairingOf, cleanPairing,
} from './wine.js';
import { XP, levelInfo, computeStats, ACHIEVEMENTS, newlyUnlocked, confetti } from './game.js';
import { aiReady, isMock, readLabel, askSommelier, settings, saveSettings, testKey, freeVisionModels, modelLabel, AUTO_MODELS } from './ai.js';

/* ---------- constants ---------- */
const TABS = [
  { id: 'keller', label: 'Keller', icon: 'wine' },
  { id: 'sammlung', label: 'Sammlung', icon: 'trophy' },
  { id: 'scan', fab: true },
  { id: 'sommelier', label: 'Sommelier', icon: 'sparkles' },
  { id: 'mehr', label: 'Mehr', icon: 'sliders' },
];
// Filter chips follow the type setting ("Mehr Arten" adds Orange, Perlwein, Likörwein).
const filters = () => [
  { id: 'alle', label: 'Alle' }, { id: 'trinkreif', label: '🍷 Trinkreif' },
  ...typeKeys(!!settings().moreTypes).map(k => ({ id: k, label: COLORS[k].label })),
  { id: 'leer', label: 'Ausgetrunken' },
];
const VIEWS = ['list', 'grid', 'places'];
const SORTS = [
  { id: 'neu', label: 'Neueste' }, { id: 'reife', label: 'Trinkreife' },
  { id: 'winzer', label: 'Winzer A–Z' }, { id: 'jahrgang', label: 'Jahrgang' },
];
const FOODS = [
  ['🍖', 'Schnitzel'], ['🍝', 'Pasta'], ['🐟', 'Fisch'], ['🥩', 'Steak'], ['🧀', 'Käse'], ['🍕', 'Pizza'],
  ['🍛', 'Asiatisch'], ['🥗', 'Salat'], ['🥨', 'Jause'], ['🍰', 'Dessert'], ['🥂', 'Anstoßen'],
];
const URGENCY = { bald: 0, drueber: 1, jetzt: 2, offen: 3, lagern: 4 };
const READY = ['jetzt', 'bald', 'drueber'];
const SORTERS = {
  neu: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
  reife: (a, b) => URGENCY[status(a)] - URGENCY[status(b)] || (a.drinkTo || 9999) - (b.drinkTo || 9999),
  winzer: (a, b) => (a.producer || a.name || '').localeCompare(b.producer || b.name || '', 'de'),
  jahrgang: (a, b) => (a.vintage || 9999) - (b.vintage || 9999),
};

/* ---------- state ---------- */
const state = {
  wines: [],
  events: [],
  game: { xp: 0, unlocked: {}, scans: 0, sommelier: 0 },
  tab: 'keller',
  view: (() => { try { const v = localStorage.getItem('wk.view'); return VIEWS.includes(v) ? v : 'list'; } catch (_) { return 'list'; } })(),
  places: [],
  pendingSlot: null,
  placeDraft: null,
  placing: null,
  query: '',
  filter: 'alle',
  sort: 'neu',
  highlight: null,
  draft: null,
  drink: null,
  somm: null,
  sommFood: '',
  keyStatus: null,
  confirmFn: null,
};
let pickTarget = 'new';
let deferredPrompt = null;

/* ---------- small helpers ---------- */
const effectsOn = () => settings().effects !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches;
const safePhoto = p => (typeof p === 'string' && p.startsWith('data:image/') ? esc(p) : '');
const byId = id => state.wines.find(w => w.id === id);
const inStock = () => state.wines.filter(w => w.qty > 0);
const saveGame = () => db.setMeta('game', state.game).catch(() => {});
const wineTitle = w => w.producer || w.name || w.grape || 'Unbekannter Wein';

/* ---------- storage places ("Lager") ---------- */
const placeById = id => (id && state.places.find(p => p.id === id)) || null;
const kindOf = p => PLACE_KINDS[p?.kind] || PLACE_KINDS.sonst;
const savePlaces = () => db.setMeta('places', state.places).catch(() => {});

// Which wine lies in which slot of a place (opened-up wines with 0 bottles take no space).
function occupancy(place, exceptId = null) {
  const map = new Map();
  for (const w of state.wines) {
    if (w.placeId !== place.id || w.id === exceptId || w.qty <= 0) continue;
    for (const k of w.slots || []) if (validSlot(place, k)) map.set(k, w);
  }
  return map;
}

// Keeps valid free slots and fills up to qty with the next free ones (row by row).
function autoSlots(place, exceptId, current, qty) {
  if (!hasGrid(place)) return [];
  const occ = occupancy(place, exceptId);
  const keep = (current || []).filter(k => validSlot(place, k) && !occ.has(k)).slice(0, qty);
  const free = slotKeys(place).filter(k => !occ.has(k) && !keep.includes(k));
  return keep.concat(free.slice(0, Math.max(0, qty - keep.length)));
}

// A rack as seen from the front: every bottle is a coloured circle.
// modes: view (tap bottle = details, tap empty = add), pick (choose slots), mine (show one wine), preview.
function rackHtml(place, { mode = 'view', wineId = null, picked = [], color = '', match = null, size = '' } = {}) {
  const occ = occupancy(place, mode === 'pick' ? wineId : null);
  const cells = ['<span class="rl"></span>'];
  for (let c = 1; c <= place.cols; c++) cells.push(`<span class="rl">${c}</span>`);
  for (let r = 1; r <= place.rows; r++) {
    cells.push(`<span class="rl">${String.fromCharCode(64 + r)}</span>`);
    for (let c = 1; c <= place.cols; c++) {
      const key = `${r}-${c}`;
      const name = slotLabel(key);
      const w = occ.get(key);
      const t = w ? `t-${COLORS[w.color] ? w.color : 'none'}` : '';
      if (mode === 'pick') {
        if (picked.includes(key)) cells.push(`<button type="button" class="slot full t-${COLORS[color] ? color : 'none'} pick" data-slottoggle="${key}" aria-label="${name}: gewählt"></button>`);
        else if (w) cells.push(`<span class="slot full ${t} other" title="${esc(wineTitle(w))}"></span>`);
        else cells.push(`<button type="button" class="slot" data-slottoggle="${key}" aria-label="${name}: frei"></button>`);
      } else if (mode === 'mine' || mode === 'preview') {
        const cls = mode === 'mine' && w ? (w.id === wineId ? ' mine' : ' dim') : '';
        cells.push(`<span class="slot${w ? ` full ${t}${cls}` : ''}"></span>`);
      } else if (w) {
        const cls = match ? (match.has(w.id) ? ' match' : ' dim') : '';
        cells.push(`<button type="button" class="slot full ${t}${cls}" data-open="${w.id}" aria-label="${name}: ${esc(wineTitle(w))}${w.vintage ? ` ${w.vintage}` : ''}"></button>`);
      } else {
        cells.push(`<button type="button" class="slot" data-slotfree="${place.id}|${key}" aria-label="${name}: frei"></button>`);
      }
    }
  }
  return `<div class="rack rack-${place.kind} ${size}" style="--cols:${place.cols}">${cells.join('')}</div>`;
}

// A box or other place without fixed slots: just the bottles, one circle each.
function crateHtml(place, { match = null } = {}) {
  const dots = state.wines.filter(w => w.placeId === place.id && w.qty > 0)
    .flatMap(w => Array.from({ length: Math.min(w.qty, 36) }, () => w));
  if (!dots.length) return '<div class="crate empty">Noch leer. Wähl dieses Lager beim Eintragen eines Weins.</div>';
  return `<div class="crate">${dots.map(w => {
    const cls = match ? (match.has(w.id) ? ' match' : ' dim') : '';
    return `<button type="button" class="slot full t-${COLORS[w.color] ? w.color : 'none'}${cls}" data-open="${w.id}" aria-label="${esc(wineTitle(w))}"></button>`;
  }).join('')}</div>`;
}

function celebrate(kind = 'small') {
  if (!effectsOn()) return;
  if (kind === 'big') {
    confetti({ x: 0.12, y: 0.78, angle: -62, spread: 32, count: 110, power: 1.15 });
    confetti({ x: 0.88, y: 0.78, angle: -118, spread: 32, count: 110, power: 1.15 });
  } else {
    confetti({ x: 0.5, y: 0.62, spread: 62, count: 120 });
  }
}

const THUMB_SIZE = { thumb: 66, 'mini-img': 62, 'dup-img': 40 };
function thumb(w, cls = 'thumb') {
  const p = safePhoto(w.photo);
  return p
    ? `<img class="${cls}" src="${p}" alt="" loading="lazy" decoding="async">`
    : `<span class="${cls} ${tileClass(w)}" aria-hidden="true">${bottleSvg(w, THUMB_SIZE[cls] || 60)}</span>`;
}

// Animated numbers on the home screen (from the last shown value to the new one).
const shownNumbers = {};
function countUp() {
  $$('[data-count]').forEach(el => {
    const key = el.dataset.count;
    const to = Number(el.dataset.v) || 0;
    const from = shownNumbers[key] ?? 0;
    shownNumbers[key] = to;
    if (from === to || !effectsOn()) { el.textContent = to; return; }
    const start = performance.now();
    const step = now => {
      const p = Math.min(1, (now - start) / 700);
      el.textContent = Math.round(from + (to - from) * (1 - (1 - p) ** 3));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(() => { el.textContent = to; }, 900);
  });
}

// "+35 XP" flying up from the level chip.
function xpFloat(points) {
  if (!points || !effectsOn()) return;
  const chip = $('.level-chip');
  const r = chip && !document.body.classList.contains('has-sheet') ? chip.getBoundingClientRect() : null;
  const el = document.createElement('div');
  el.className = 'xp-float';
  el.textContent = `+${points} XP`;
  el.style.left = `${r ? r.left + r.width / 2 : window.innerWidth / 2}px`;
  el.style.top = `${r ? r.bottom + 6 : 70}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

function ring(progress, size, label) {
  const r = 15.5;
  const c = 2 * Math.PI * r;
  const p = Math.max(0.02, Math.min(1, progress));
  return `<svg class="ring" viewBox="0 0 36 36" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="18" cy="18" r="${r}" fill="none" stroke="currentColor" stroke-opacity=".16" stroke-width="3.4"/>
    <circle cx="18" cy="18" r="${r}" fill="none" stroke="var(--gold)" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="${(c * p).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 18 18)"/>
    <text x="18" y="22.6" text-anchor="middle" font-size="12.5" font-weight="800" fill="currentColor">${label}</text>
  </svg>`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Gute Nacht 🌙';
  if (h < 11) return 'Guten Morgen ☀️';
  if (h < 17) return 'Servus 👋';
  if (h < 22) return 'Guten Abend 🍷';
  return 'Gute Nacht 🌙';
}

function topbar(title, sub, actions = '') {
  return `<header class="topbar"><div class="tb-text"><h1>${title}</h1><div class="sub">${sub}</div></div>${actions ? `<div class="tb-actions">${actions}</div>` : ''}</header>`;
}

function levelChip() {
  const lv = levelInfo(state.game.xp);
  return `<button class="level-chip" data-tab="sammlung" aria-label="Level ${lv.level}, ${esc(lv.name)}, ${state.game.xp} XP">${ring(lv.progress, 34, lv.level)}<span><b>${state.game.xp} XP</b><small>${esc(lv.name)}</small></span></button>`;
}

/* ---------- toasts & popups ---------- */
function toast(message, { action, onAction, ms = action ? 7000 : 4200 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="t-msg">${esc(message)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  const hide = () => { if (!el.isConnected) return; el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  if (action) el.querySelector('button').addEventListener('click', () => { hide(); onAction?.(); });
  $('#toasts').appendChild(el);
  const all = $$('.toast');
  if (all.length > 2) all[0].remove();
  setTimeout(hide, ms);
}

const popQueue = [];
let popBusy = false;
function popup(html) {
  popQueue.push(html);
  if (!popBusy) nextPopup();
}
function nextPopup() {
  const html = popQueue.shift();
  if (!html) { popBusy = false; return; }
  popBusy = true;
  const el = document.createElement('div');
  el.className = 'popup';
  el.innerHTML = html;
  $('#popups').appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => { el.remove(); nextPopup(); }, 300);
  }, 3300);
}

/* ---------- game progress ---------- */
async function progress(xpGain = 0) {
  const before = levelInfo(state.game.xp).level;
  state.game.xp += xpGain;
  const stats = computeStats(state.wines, state.events, state.game);
  const fresh = newlyUnlocked(stats, state.game.unlocked);
  for (const a of fresh) {
    state.game.unlocked[a.id] = Date.now();
    state.game.xp += XP.achievement;
  }
  const after = levelInfo(state.game.xp);
  await saveGame();
  fresh.forEach(a => popup(`<div class="badge-ico">${a.emoji}</div><div><small>Erfolg freigeschaltet</small><b>${esc(a.title)}</b><span>${esc(a.desc)} · +${XP.achievement} XP</span></div>`));
  if (after.level > before) {
    popup(`<div class="badge-ico lvl">${after.level}</div><div><small>Level aufgestiegen</small><b>${esc(after.name)}</b><span>Du bist jetzt Level ${after.level}</span></div>`);
  }
  if (fresh.length || after.level > before) setTimeout(() => celebrate('big'), 350);
  const chip = $('.level-chip');
  if (chip) chip.outerHTML = levelChip();
  const total = xpGain + fresh.length * XP.achievement;
  xpFloat(total);
  return { total, fresh, levelUp: after.level > before };
}

/* ---------- sheets (bottom panels) ---------- */
const sheets = [];
let ignorePops = 0;

function openSheet(id, html, { onClose, cls = '', wrapCls = '', swipe = true } = {}) {
  const existing = sheets.find(s => s.id === id);
  if (existing) {
    existing.el.querySelector('.sheet').innerHTML = html;
    return existing.el;
  }
  const wrap = document.createElement('div');
  wrap.className = `sheet-wrap ${wrapCls}`;
  wrap.dataset.sheet = id;
  wrap.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"></div><div class="sheet ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  $('#sheets').appendChild(wrap);
  sheets.push({ id, el: wrap, onClose });
  document.body.classList.add('has-sheet');
  const sheet = wrap.querySelector('.sheet');
  // Once the slide-in is done, drop the animation so dragging can move the sheet.
  sheet.addEventListener('animationend', () => { if (!wrap.classList.contains('closing')) sheet.style.animation = 'none'; }, { once: true });
  if (swipe) enableSwipe(wrap, id);
  try { history.pushState({ wk: true, sheet: id }, ''); } catch (_) { /* ignore */ }
  return wrap;
}

// Pull a sheet down by its handle, header or picture to close it.
function enableSwipe(wrap, id) {
  const sheet = wrap.querySelector('.sheet');
  const backdrop = wrap.querySelector('.sheet-backdrop');
  let y0 = 0;
  let dy = 0;
  let t0 = 0;
  let active = false;
  sheet.addEventListener('touchstart', e => {
    const t = e.target;
    if (!t.closest('.grab, .sheet-head, .hero') || t.closest('button, input, textarea, select, a')) return;
    active = true;
    y0 = e.touches[0].clientY;
    dy = 0;
    t0 = Date.now();
    sheet.style.transition = 'none';
  }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (!active) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
    backdrop.style.opacity = String(Math.max(0.15, 1 - dy / 420));
    if (dy > 4 && e.cancelable) e.preventDefault();
  }, { passive: false });
  const end = () => {
    if (!active) return;
    active = false;
    const speed = dy / Math.max(1, Date.now() - t0);
    if (dy > 120 || (dy > 50 && speed > 0.5)) { closeSheet(id); return; }
    sheet.style.transition = 'transform .28s cubic-bezier(.2, .9, .3, 1)';
    sheet.style.transform = '';
    backdrop.style.opacity = '';
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
}

function removeSheet(id) {
  const idx = id ? sheets.findIndex(s => s.id === id) : sheets.length - 1;
  if (idx < 0) return false;
  const [s] = sheets.splice(idx, 1);
  const panel = s.el.querySelector('.sheet');
  if (panel) { panel.style.animation = ''; panel.style.transition = ''; }
  s.el.classList.add('closing');
  setTimeout(() => s.el.remove(), 230);
  if (!sheets.length) document.body.classList.remove('has-sheet');
  s.onClose?.();
  return true;
}

function closeSheet(...ids) {
  const list = ids.filter(Boolean);
  if (!list.length && sheets.length) list.push(sheets[sheets.length - 1].id);
  let removed = 0;
  for (const id of list) if (removeSheet(id)) removed++;
  if (removed && history.state?.wk) {
    ignorePops++;
    history.go(-removed);
  }
}

const closeAllSheets = () => closeSheet(...sheets.map(s => s.id));
const sheetEl = id => sheets.find(s => s.id === id)?.el || null;

window.addEventListener('popstate', () => {
  if (ignorePops) { ignorePops--; return; }
  if (sheets.length) removeSheet();
});

/* ---------- tab bar & rendering ---------- */
function renderTabbar() {
  $('#tabbar').innerHTML = `<div class="inner">${TABS.map(t => (t.fab
    ? `<button class="fab" data-action="scan" aria-label="Etikett fotografieren">${icon('camera')}</button>`
    : `<button class="tab" data-tab="${t.id}"${state.tab === t.id ? ' aria-current="page"' : ''}>${icon(t.icon)}<span>${t.label}</span></button>`)).join('')}</div>`;
}

function render() {
  $$('#tabbar .tab').forEach(b => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const views = { keller: viewKeller, sammlung: viewSammlung, sommelier: viewSommelier, mehr: viewMehr };
  $('#view').innerHTML = (views[state.tab] || viewKeller)();
  if (state.tab === 'keller') { renderList(); countUp(); }
  if (state.tab === 'mehr') loadModels();
}

function goTab(id, after) {
  if (sheets.length) closeAllSheets();
  if (state.tab === id) {
    if (after) { render(); after(); } else window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  state.tab = id;
  const swap = () => { render(); window.scrollTo(0, 0); after?.(); };
  if (document.startViewTransition && effectsOn()) {
    const vt = document.startViewTransition(swap);
    // A quick second tap skips the running transition; that is fine, not an error.
    [vt.ready, vt.finished, vt.updateCallbackDone].forEach(p => p?.catch(() => {}));
  } else {
    swap();
  }
}

/* ---------- Keller ---------- */
function viewKeller() {
  const actions = `<button class="icon-btn" data-action="manual" aria-label="Wein ohne Foto eintragen">${icon('plus')}</button>${levelChip()}`;
  if (!state.wines.length) return topbar('Weinkeller', greeting(), actions) + emptyState();
  const stock = inStock();
  const bottles = stock.reduce((a, w) => a + w.qty, 0);
  const ready = stock.filter(w => READY.includes(status(w))).reduce((a, w) => a + w.qty, 0);
  const soon = stock.filter(w => ['bald', 'drueber'].includes(status(w))).sort(SORTERS.reife);
  const num = (key, v) => `<span class="num" data-count="${key}" data-v="${v}">${shownNumbers[key] ?? 0}</span>`;
  return `${topbar('Weinkeller', greeting(), actions)}
    <div class="stats">
      <div class="stat">${num('bottles', bottles)}<span class="lbl">${bottles === 1 ? 'Flasche' : 'Flaschen'}</span></div>
      <div class="stat">${num('wines', stock.length)}<span class="lbl">${stock.length === 1 ? 'Wein' : 'Weine'}</span></div>
      <div class="stat">${num('ready', ready)}<span class="lbl">trinkreif</span></div>
    </div>
    ${typeBar(stock, bottles)}
    ${soon.length ? todayCard(soon) : ''}
    ${stock.length ? `<form class="somm-bar" id="somm-bar" autocomplete="off">
      <span class="somm-ico" aria-hidden="true">🤵</span>
      <input id="quick-food" type="text" placeholder="Was gibt’s heute zu essen?" enterkeyhint="go" aria-label="Was gibt es heute zu essen? Der Sommelier wählt einen Wein.">
      <button type="submit" class="somm-go" aria-label="Wein vorschlagen">${icon('send')}</button>
    </form>` : ''}
    <div class="search-row">
      <div class="search">${icon('search')}<input id="q" type="search" placeholder="Winzer, Rebsorte, Jahrgang …" value="${esc(state.query)}" autocomplete="off" enterkeyhint="search" aria-label="Keller durchsuchen"></div>
      <div class="viewseg" role="group" aria-label="Ansicht">
        ${[['list', 'list', 'Liste'], ['grid', 'grid', 'Galerie'], ['places', 'rack', 'Lager']].map(([v, ic, label]) => `<button data-view="${v}" aria-pressed="${state.view === v}" aria-label="${label}" title="${label}">${icon(ic)}</button>`).join('')}
      </div>
    </div>
    <div class="chips" role="toolbar" aria-label="Filter">
      ${filters().map(f => `<button class="chip" data-filter="${f.id}" aria-pressed="${state.filter === f.id}">${f.label}</button>`).join('')}
      <label class="chip sort">${icon('sort')}<select id="sort" aria-label="Sortieren">${SORTS.map(s => `<option value="${s.id}"${state.sort === s.id ? ' selected' : ''}>${s.label}</option>`).join('')}</select></label>
    </div>
    <div id="list" class="list"></div>`;
}

function emptyState() {
  return `<section class="empty">
    <div class="art">🍷</div>
    <h2>Dein Keller wartet</h2>
    <p>Fotografier ein Etikett. Die KI liest Winzer, Rebsorte und Jahrgang, du bestätigst nur.</p>
    <div class="steps3">
      <div><b>1</b><span>Gratis-KI einrichten (2 Minuten)</span></div>
      <div><b>2</b><span>Etikett fotografieren</span></div>
      <div><b>3</b><span>Kurz prüfen, speichern, Konfetti 🎉</span></div>
    </div>
    <button class="btn primary block" data-action="scan">${icon('camera')} Erstes Etikett scannen</button>
    <div class="row-btns center">
      <button class="btn ghost small" data-action="gallery">${icon('image')} Aus der Galerie</button>
      <button class="btn ghost small" data-action="manual">${icon('plus')} Ohne Foto</button>
    </div>
    ${aiReady() ? '' : `<div class="callout info" style="margin-top:16px;text-align:left">${icon('sparkles')}<span><b>Tipp:</b> Richte zuerst die Gratis-KI ein, dann füllt sich alles von selbst. <button class="link" data-action="goto-ai">So geht’s</button></span></div>`}
    <p class="small muted" style="margin:14px 0 0">Erst mal schauen? <button class="link" data-action="demo">Mit Beispielweinen ausprobieren</button></p>
  </section>`;
}

// Colour mix of the cellar as one bar; tapping a part filters the list.
function typeBar(stock, total) {
  if (!total) return '';
  const parts = Object.keys(COLORS)
    .map(k => [k, stock.filter(w => w.color === k).reduce((a, w) => a + w.qty, 0)])
    .filter(([, n]) => n);
  const rest = total - parts.reduce((a, [, n]) => a + n, 0);
  if (!parts.length) return '';
  return `<div class="typebar">
    <div class="tb-bar">${parts.map(([k, n]) => `<button class="tb-seg" data-filter="${k}" style="flex:${n};background:${COLORS[k].dot}" aria-label="${COLORS[k].label}: ${n} Flaschen"></button>`).join('')}${rest ? `<span class="tb-seg" style="flex:${rest}"></span>` : ''}</div>
    <div class="tb-legend">${parts.map(([k, n]) => `<span><i class="cdot" style="background:${COLORS[k].dot}"></i>${COLORS[k].label} <b>${n}</b></span>`).join('')}</div>
  </div>`;
}

// Name parts as the shops show them: producer small on top, wine or grape big, then grape and origin.
function nameParts(w) {
  const title = w.name || w.grape || w.producer || 'Unbekannter Wein';
  const kicker = w.producer && title !== w.producer ? w.producer : '';
  const origin = [flagOf(w), w.region || w.country].filter(Boolean).join(' ');
  const sub = [w.name && w.grape ? w.grape : '', origin].filter(Boolean).join(' · ');
  return { title, kicker, sub };
}

function todayCard(soon) {
  return `<section class="today" aria-label="Bald trinken">
    <div class="today-head"><b>⏰ Heute dran</b><small>${soon.length === 1 ? 'Dieser Wein sollte' : `Diese ${soon.length} Weine sollten`} bald getrunken werden</small></div>
    <div class="today-row">${soon.slice(0, 8).map(w => `<button class="mini" data-open="${w.id}">${thumb(w, 'mini-img')}<b>${esc(wineTitle(w))}</b><span>${w.vintage || 'o. J.'} · ${STATUS[status(w)].label}</span></button>`).join('')}</div>
  </section>`;
}

function card(w, i = 0) {
  const st = status(w);
  const { title, kicker, sub } = nameParts(w);
  return `<button class="card${state.highlight === w.id ? ' flash' : ''}" data-open="${w.id}" style="animation-delay:${Math.min(i, 12) * 22}ms">
    ${thumb(w)}
    <span class="meta">
      ${kicker ? `<span class="kicker">${esc(kicker)}</span>` : ''}
      <span class="producer">${esc(title)}</span>
      ${sub ? `<span class="line2">${esc(sub)}</span>` : ''}
      <span class="tags">
        ${w.vintage ? `<span class="pill">${w.vintage}</span>` : ''}
        ${st !== 'offen' ? `<span class="pill st st-${st}">${STATUS[st].label}</span>` : (w.color ? `<span class="pill"><i class="cdot" style="background:${COLORS[w.color].dot}"></i>${COLORS[w.color].label}</span>` : '')}
      </span>
    </span>
    <span class="qty"><b>${w.qty}</b><span>${w.qty === 1 ? 'Flasche' : 'Flaschen'}</span>${w.demo ? '<em class="demo-tag">Beispiel</em>' : ''}</span>
  </button>`;
}

function renderList() {
  const el = $('#list');
  if (!el) return;
  const words = norm(state.query).split(' ').filter(Boolean);
  let list = state.wines.filter(w => (state.filter === 'leer' ? w.qty <= 0 : w.qty > 0));
  if (COLORS[state.filter]) list = list.filter(w => w.color === state.filter);
  if (state.filter === 'trinkreif') list = list.filter(w => READY.includes(status(w)));
  if (words.length) {
    list = list.filter(w => {
      const place = placeById(w.placeId);
      const hay = norm([w.producer, w.name, w.grape, w.vintage, w.region, w.country, w.location, w.notes, w.sweetness, place?.name, ...grapesOf(w)].join(' '));
      return words.every(x => hay.includes(x));
    });
  }
  list.sort(SORTERS[state.sort] || SORTERS.neu);
  if (state.view === 'places') {
    // In the storage view a search or filter makes the matching bottles light up.
    const active = words.length || state.filter !== 'alle';
    el.className = 'places';
    el.innerHTML = placesHtml(active ? new Set(list.map(w => w.id)) : null);
    return;
  }
  const grid = state.view === 'grid' && list.length;
  el.className = grid ? 'shelf' : 'list';
  el.innerHTML = list.length
    ? list.map(grid ? shelfCard : card).join('')
    : `<div class="none">${words.length || state.filter !== 'alle' ? 'Nichts gefunden. 🔍' : 'Keine Flaschen im Keller.'}</div>`;
  const hit = el.querySelector('.flash');
  if (hit) hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// Storage view: one card per place with its rack or box.
function placesHtml(match) {
  if (!state.places.length) {
    return `<section class="places-empty">
      <div class="art">🗄️</div>
      <h3>Wo liegen deine Weine?</h3>
      <p class="muted">Leg ein Lager an, dann siehst du jede Flasche an ihrem Platz.</p>
      <div class="kind-row">${Object.entries(PLACE_KINDS).map(([key, k]) => `<button class="kind-chip" data-newplace="${key}"><span>${k.emoji}</span>${k.label}</button>`).join('')}</div>
    </section>`;
  }
  const loose = inStock().filter(w => !placeById(w.placeId)).length;
  return state.places.map(p => {
    const bottles = state.wines.filter(w => w.placeId === p.id && w.qty > 0).reduce((a, w) => a + w.qty, 0);
    const sub = hasGrid(p) ? `${occupancy(p).size} von ${p.rows * p.cols} Plätzen belegt` : plural(bottles, 'Flasche', 'Flaschen');
    return `<section class="place-card">
      <div class="place-head"><span class="place-emoji">${kindOf(p).emoji}</span><span class="place-text"><b>${esc(p.name)}</b><small>${sub}</small></span><button class="icon-btn flat" data-editplace="${p.id}" aria-label="${esc(p.name)} bearbeiten">${icon('edit')}</button></div>
      ${hasGrid(p) ? rackHtml(p, { match }) : crateHtml(p, { match })}
    </section>`;
  }).join('') + `<div class="places-foot">${loose ? `<span class="muted small">${plural(loose, 'Wein', 'Weine')} ohne Lager, siehe Liste.</span>` : '<span></span>'}<button class="btn ghost small" data-action="new-place">${icon('plus')} Lager</button></div>`;
}

// Shelf view: big bottle or label photo per wine, two or three per row.
function shelfCard(w, i = 0) {
  const st = status(w);
  const { title, kicker } = nameParts(w);
  const photo = safePhoto(w.photo);
  return `<button class="shelf-card${state.highlight === w.id ? ' flash' : ''}" data-open="${w.id}" style="animation-delay:${Math.min(i, 12) * 22}ms">
    <span class="shelf-tile ${photo ? '' : tileClass(w)}">
      ${photo ? `<img src="${photo}" alt="" loading="lazy" decoding="async">` : bottleSvg(w, 122)}
      ${w.vintage && photo ? `<span class="shelf-vintage">${w.vintage}</span>` : ''}
      <span class="shelf-qty">×${w.qty}</span>
      ${w.demo ? '<span class="shelf-demo">Beispiel</span>' : ''}
    </span>
    <span class="shelf-meta">
      ${kicker ? `<span class="kicker">${esc(kicker)}</span>` : ''}
      <span class="shelf-title">${esc(title)}</span>
      ${st !== 'offen' ? `<span class="shelf-status st-${st}">${STATUS[st].label}</span>` : ''}
    </span>
  </button>`;
}

/* ---------- add & edit ---------- */
const emptyWine = () => ({
  producer: '', name: '', grape: '', vintage: '', color: '', sweetness: '', region: '', country: '',
  drinkFrom: '', drinkTo: '', location: '', price: '', qty: 1, notes: '', photo: '', placeId: '', slots: [],
});

function openForm(wine = null, { photo = '' } = {}) {
  const isNew = !wine;
  const data = wine ? { ...emptyWine(), ...wine, slots: [...(wine.slots || [])] } : { ...emptyWine(), photo };
  if (isNew) {
    // Low friction: a tapped empty slot, otherwise the last used place with the next free slot.
    // A slot tapped in the storage view counts for ten minutes (scan or type the wine).
    const pending = state.pendingSlot && Date.now() - state.pendingSlot.t < 600000 ? state.pendingSlot : null;
    state.pendingSlot = null;
    const p = placeById(pending?.placeId) || placeById(settings().lastPlace);
    if (p) {
      data.placeId = p.id;
      data.slots = pending && pending.placeId === p.id ? [pending.key] : autoSlots(p, null, [], 1);
    }
  }
  state.draft = {
    token: uid(), id: wine?.id || null, isNew, orig: wine ? { ...wine } : null, data,
    touched: new Set(), unsure: [], scanned: !!wine?.scanned, aiModel: wine?.aiModel || '', aiImage: null, rackOpen: false,
  };
  openSheet('form', formHtml(), { cls: 'tall', onClose: () => { state.draft = null; } });
}

function sweetHtml(d) {
  if (!settings().moreTypes) return '';
  const opts = sweetOptions(d.color);
  return `<div class="field"><span>Geschmacksrichtung</span><div class="seg" role="radiogroup" aria-label="Geschmacksrichtung">${opts.map(v => `<button type="button" class="seg-btn" role="radio" data-sweet="${v}" aria-checked="${d.sweetness === v}">${sweetLabel(v)}</button>`).join('')}</div></div>`;
}

// Storage in the form: one tap picks the place, free slots are suggested automatically.
function placeSection(d) {
  if (!state.places.length) {
    return `${field('location', 'Lagerort', d.location, { list: 'dl-locations', placeholder: 'Regal 2, Fach 3' })}
      ${locationChips(d.location)}
      <p class="small muted place-hint">Tipp: <button type="button" class="link" data-action="new-place">Lager mit Plan anlegen</button>, etwa einen Weinkühlschrank.</p>`;
  }
  return `<div class="field"><span>Lager</span><div class="seg" role="radiogroup" aria-label="Lager">${state.places.map(p => `<button type="button" class="seg-btn" role="radio" data-place="${p.id}" aria-checked="${d.placeId === p.id}">${kindOf(p).emoji} ${esc(p.name)}</button>`).join('')}<button type="button" class="seg-btn add" data-action="new-place" aria-label="Neues Lager anlegen">${icon('plus')}</button></div></div>
    <div id="form-slots">${formSlotsHtml(d)}</div>`;
}

function formSlotsHtml(d) {
  const p = placeById(d.placeId);
  if (!p || !hasGrid(p)) return '';
  const picked = d.slots || [];
  const open = state.draft?.rackOpen;
  return `<div class="slot-line">${icon('pin')}<span>${picked.length ? `Platz ${picked.map(slotLabel).join(', ')}` : 'Noch kein fester Platz'}</span><button type="button" class="link" data-action="toggle-rack">${open ? 'Fertig' : 'Ändern'}</button></div>
    ${open ? `${rackHtml(p, { mode: 'pick', wineId: state.draft.id, picked, color: d.color, size: 'rack-compact' })}
      <div class="slot-tools"><button type="button" class="link" data-action="auto-slots">Automatisch</button><button type="button" class="link" data-action="clear-slots">Ohne festen Platz</button></div>` : ''}`;
}

function refreshFormSlots() {
  const el = $('#form-slots');
  if (el && state.draft) el.innerHTML = formSlotsHtml(state.draft.data);
}

function field(key, label, value, o = {}) {
  const attrs = [
    `id="f-${key}"`, `data-field="${key}"`, 'autocomplete="off"',
    o.textarea ? '' : `type="${o.type || 'text'}"`,
    o.inputmode ? `inputmode="${o.inputmode}"` : '',
    o.list ? `list="${o.list}"` : '',
    o.placeholder != null ? `placeholder="${esc(o.placeholder)}"` : '',
    o.cap ? `autocapitalize="${o.cap}"` : '',
    o.maxlength ? `maxlength="${o.maxlength}"` : '',
  ].filter(Boolean).join(' ');
  const input = o.textarea ? `<textarea ${attrs} rows="3">${esc(value)}</textarea>` : `<input ${attrs} value="${esc(value ?? '')}">`;
  return `<label class="field${o.big ? ' big' : ''}" data-f="${key}"><span>${label}</span>${input}</label>`;
}

function stepper(key, value) {
  return `<div class="stepper" data-stepper="${key}"><button type="button" data-step="-1" aria-label="Weniger">${icon('minus')}</button><output id="s-${key}">${value}</output><button type="button" data-step="1" aria-label="Mehr">${icon('plus')}</button></div>`;
}

function datalists() {
  const uniq = arr => [...new Set(arr.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b, 'de'));
  const opts = arr => uniq(arr).map(v => `<option value="${esc(v)}"></option>`).join('');
  return `<datalist id="dl-producers">${opts(state.wines.map(w => w.producer))}</datalist>
    <datalist id="dl-grapes">${opts([...GRAPES.map(g => g.name), ...state.wines.map(w => w.grape)])}</datalist>
    <datalist id="dl-regions">${opts(state.wines.map(w => w.region))}</datalist>
    <datalist id="dl-countries">${opts([...Object.keys(FLAGS), ...state.wines.map(w => w.country)])}</datalist>
    <datalist id="dl-locations">${opts(state.wines.map(w => w.location))}</datalist>`;
}

// The most used storage places as one-tap chips under the field.
function locationChips(current) {
  const counts = new Map();
  for (const w of state.wines) if (w.location) counts.set(w.location, (counts.get(w.location) || 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l]) => l);
  if (!top.length) return '';
  return `<div class="loc-chips" aria-label="Schnellwahl Lagerort">${top.map(l => `<button type="button" class="chip" data-loc="${esc(l)}" aria-pressed="${l === current}">${icon('pin')}${esc(l)}</button>`).join('')}</div>`;
}

function photoBlock(d) {
  const p = safePhoto(d.photo);
  if (p) return `<div class="photo" id="photo"><img src="${p}" alt="Foto des Etiketts"></div>`;
  return `<div class="photo empty" id="photo"><p>Mit Foto liest die KI das Etikett für dich.</p><div class="row-btns center" style="margin:0"><button type="button" class="btn small" data-action="form-camera">${icon('camera')} Foto</button><button type="button" class="btn small ghost" data-action="form-gallery">${icon('image')} Galerie</button></div></div>`;
}

function formHtml() {
  const d = state.draft.data;
  const isNew = state.draft.isNew;
  return `<div class="grab"></div>
    <div class="sheet-head"><h2>${isNew ? 'Neuer Wein' : 'Wein bearbeiten'}</h2><button class="icon-btn flat" data-action="close-sheet" aria-label="Schließen">${icon('x')}</button></div>
    <div class="sheet-body">
      ${photoBlock(d)}
      <div id="scan-msg"></div>
      <div id="dup"></div>
      ${field('producer', 'Winzer', d.producer, { big: true, list: 'dl-producers', placeholder: 'z. B. Weingut Hirsch', cap: 'words' })}
      ${field('grape', 'Rebsorte', d.grape, { big: true, list: 'dl-grapes', placeholder: 'z. B. Grüner Veltliner', cap: 'words' })}
      <div class="row2">
        ${field('vintage', 'Jahrgang', d.vintage ?? '', { big: true, inputmode: 'numeric', placeholder: String(thisYear() - 2), maxlength: 4 })}
        <div class="field"><span>Flaschen</span>${stepper('qty', d.qty ?? 1)}</div>
      </div>
      <div class="field"><span>Art</span><div class="seg" role="radiogroup" aria-label="Art">${typeKeys(!!settings().moreTypes, d.color).map(k => `<button type="button" class="seg-btn" role="radio" data-color="${k}" aria-checked="${d.color === k}"><i class="cdot" style="background:${COLORS[k].dot}"></i>${COLORS[k].label}</button>`).join('')}</div></div>
      <div id="sweet-field">${sweetHtml(d)}</div>
      ${placeSection(d)}
      <details class="more"${isNew ? '' : ' open'}><summary>Mehr Details ${icon('chevron')}</summary>
        ${state.places.length ? field('location', 'Notiz zum Ort', d.location, { list: 'dl-locations', placeholder: 'z. B. hinten links' }) : ''}
        ${field('name', 'Wein, Lage oder Cuvée', d.name, { placeholder: 'z. B. Ried Heiligenstein', cap: 'words' })}
        <div class="row2">${field('region', 'Region', d.region, { list: 'dl-regions', cap: 'words' })}${field('country', 'Land', d.country, { list: 'dl-countries', cap: 'words' })}</div>
        <div class="row2">${field('drinkFrom', 'Trinken ab', d.drinkFrom ?? '', { inputmode: 'numeric', maxlength: 4, placeholder: 'Jahr' })}${field('drinkTo', 'Trinken bis', d.drinkTo ?? '', { inputmode: 'numeric', maxlength: 4, placeholder: 'Jahr' })}</div>
        ${field('price', 'Preis pro Flasche in €', d.price ?? '', { inputmode: 'decimal', placeholder: '0,00' })}
        ${field('notes', 'Notiz', d.notes, { textarea: true, placeholder: 'Wo gekauft, Anlass, erster Eindruck …' })}
      </details>
      ${datalists()}
    </div>
    <div class="sheet-foot"><button class="btn primary block" data-action="save-wine">${isNew ? '🍷 In den Keller' : 'Speichern'}</button></div>`;
}

function readDraft() {
  const d = state.draft.data;
  const s = v => String(v ?? '').trim();
  let vintage = toYear(d.vintage);
  if (vintage && (vintage < 1900 || vintage > thisYear() + 1)) vintage = null;
  let from = toYear(d.drinkFrom);
  let to = toYear(d.drinkTo);
  if (from && (from < 1900 || from > 2100)) from = null;
  if (to && (to < 1900 || to > 2100)) to = null;
  if (from && to && from > to) [from, to] = [to, from];
  return {
    producer: s(d.producer), name: s(d.name), grape: s(d.grape), vintage, color: d.color || '',
    region: s(d.region), country: normCountry(s(d.country)), drinkFrom: from, drinkTo: to,
    location: s(d.location), price: toNum(d.price), qty: Math.max(0, toInt(d.qty) ?? 1), notes: s(d.notes),
    photo: typeof d.photo === 'string' && d.photo.startsWith('data:image/') ? d.photo : '',
    taste: cleanTaste(d.taste),
    sweetness: sweetOptions(d.color).includes(d.sweetness) ? d.sweetness : '',
    pairing: cleanPairing(d.pairing),
    ...placeOf(d),
  };
}

// Place and slots as they will be stored: only existing places, free and valid slots, never more than bottles.
function placeOf(d) {
  const p = placeById(d.placeId);
  if (!p) return { placeId: '', slots: [] };
  const qty = Math.max(0, toInt(d.qty) ?? 1);
  const occ = occupancy(p, state.draft?.id || d.id || null);
  const slots = hasGrid(p) ? (d.slots || []).filter(k => validSlot(p, k) && !occ.has(k)).slice(0, qty) : [];
  return { placeId: p.id, slots };
}

const dupCheck = debounce(() => {
  const d = state.draft;
  const el = $('#dup');
  if (!d || !d.isNew || !el) return;
  const data = readDraft();
  const key = matchKey(data);
  const hit = data.producer && state.wines.find(w => !w.demo && matchKey(w) === key);
  el.innerHTML = hit
    ? `<div class="callout dup">${thumb(hit, 'dup-img')}<div><b>Schon im Keller</b><span>${esc(wineTitle(hit))} ${hit.vintage || ''} · ${plural(hit.qty, 'Flasche', 'Flaschen')}</span></div><button type="button" class="btn small primary" data-action="merge" data-id="${hit.id}">+${data.qty || 1} dazu</button></div>`
    : '';
}, 250);

async function saveWine() {
  const d = state.draft;
  if (!d) return;
  const data = readDraft();
  if (!data.producer && !data.name && !data.grape) {
    const f = $('[data-f="producer"]');
    f?.classList.remove('shake');
    void f?.offsetWidth;
    f?.classList.add('shake');
    $('#f-producer')?.focus();
    toast('Trag mindestens den Winzer ein.');
    return;
  }
  const now = Date.now();
  if (d.isNew) {
    const wine = { id: uid(), createdAt: now, updatedAt: now, scanned: d.scanned, aiModel: d.aiModel, ...data };
    if (!wine.qty) wine.qty = 1;
    state.wines.unshift(wine);
    try { await db.put('wines', wine); } catch (_) { toast('Speichern hat nicht geklappt.'); }
    if (d.scanned) state.game.scans = (state.game.scans || 0) + 1;
    if (wine.placeId) saveSettings({ lastPlace: wine.placeId });
    const xp = XP.addWine + (d.scanned ? XP.scan : 0) + (wine.location || wine.placeId ? XP.location : 0) + (wine.drinkFrom || wine.drinkTo ? XP.window : 0);
    closeSheet('form');
    state.tab = 'keller';
    state.filter = 'alle';
    state.query = '';
    state.highlight = wine.id;
    render();
    buzz(25);
    celebrate('small');
    const res = await progress(xp);
    toast(`Im Keller! +${res.total} XP`, { action: 'Nächstes Etikett', onAction: () => openCamera('new') });
    setTimeout(() => { state.highlight = null; }, 2500);
  } else {
    const wine = byId(d.id);
    if (!wine) { closeSheet('form'); return; }
    const orig = d.orig || {};
    Object.assign(wine, data, { updatedAt: now });
    try { await db.put('wines', wine); } catch (_) { toast('Speichern hat nicht geklappt.'); }
    closeSheet('form');
    render();
    refreshDetail(wine.id);
    if (wine.placeId) saveSettings({ lastPlace: wine.placeId });
    const xp = wine.demo ? 0 : (!orig.location && !orig.placeId && (wine.location || wine.placeId) ? XP.location : 0) + (!orig.drinkFrom && !orig.drinkTo && (wine.drinkFrom || wine.drinkTo) ? XP.window : 0);
    const res = await progress(xp);
    toast(res.total ? `Gespeichert · +${res.total} XP` : 'Gespeichert');
  }
}

async function mergeInto(id) {
  const d = state.draft;
  const wine = byId(id);
  if (!d || !wine) return;
  const add = Math.max(1, toInt(d.data.qty) || 1);
  const scanned = d.scanned;
  wine.qty += add;
  wine.updatedAt = Date.now();
  if (!wine.photo && d.data.photo) wine.photo = d.data.photo;
  const place = placeById(wine.placeId);
  if (hasGrid(place)) wine.slots = autoSlots(place, wine.id, wine.slots, wine.qty);
  try { await db.put('wines', wine); } catch (_) { toast('Speichern hat nicht geklappt.'); }
  if (scanned) state.game.scans = (state.game.scans || 0) + 1;
  closeSheet('form');
  state.tab = 'keller';
  state.highlight = wine.id;
  render();
  buzz(20);
  celebrate('small');
  const res = await progress(XP.restock + (scanned ? XP.scan : 0));
  toast(`+${add} ${add === 1 ? 'Flasche' : 'Flaschen'} · jetzt ${wine.qty} · +${res.total} XP`);
  setTimeout(() => { state.highlight = null; }, 2500);
}

/* ---------- scanning ---------- */
function startScan(source = 'camera') {
  const input = source === 'gallery' ? $('#file-gallery') : $('#file-camera');
  input.value = '';
  input.click();
}

// In-app camera with a label frame and scan line. Needs https or localhost;
// otherwise (or if access is denied) the phone's normal camera opens instead.
const cam = { stream: null };

function openCamera(target = 'new') {
  pickTarget = target;
  const md = navigator.mediaDevices;
  if (!window.isSecureContext || !md || typeof md.getUserMedia !== 'function') { startScan('camera'); return; }
  const wrap = openSheet('camera', camHtml(), { wrapCls: 'cam-wrap', cls: 'cam-sheet', swipe: false, onClose: stopCamera });
  const video = wrap.querySelector('video');
  md.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
    .then(stream => {
      if (!sheetEl('camera')) { stream.getTracks().forEach(t => t.stop()); return; }
      cam.stream = stream;
      video.srcObject = stream;
      video.play().catch(() => {});
    })
    .catch(err => {
      const off = wrap.querySelector('.cam-off');
      if (!off) return;
      off.hidden = false;
      off.querySelector('p').textContent = err && err.name === 'NotAllowedError'
        ? 'Die App darf die Kamera nicht benutzen. Nimm die normale Kamera oder ein Foto aus der Galerie.'
        : 'Hier ist keine Kamera verfügbar. Nimm die normale Kamera oder ein Foto aus der Galerie.';
      wrap.querySelector('.cam-frame')?.classList.add('off');
    });
}

function camHtml() {
  return `<div class="cam">
    <video playsinline autoplay muted></video>
    <div class="cam-mask" aria-hidden="true"><div class="cam-frame"><i class="cc tl"></i><i class="cc tr"></i><i class="cc bl"></i><i class="cc br"></i><span class="cam-line"></span></div></div>
    <div class="cam-top"><button class="cam-btn" data-action="close-sheet" aria-label="Kamera schließen">${icon('x')}</button><span class="cam-hint">Etikett in den Rahmen</span><span class="cam-spacer"></span></div>
    <div class="cam-off" hidden><p></p><button class="btn primary small" data-action="cam-native">${icon('camera')} Normale Kamera</button></div>
    <div class="cam-bottom">
      <button class="cam-btn" data-action="cam-gallery" aria-label="Foto aus der Galerie">${icon('image')}</button>
      <button class="cam-shutter" data-action="cam-shoot" aria-label="Foto aufnehmen"><span></span></button>
      <button class="cam-btn" data-action="cam-manual" aria-label="Ohne Foto eintragen">${icon('edit')}</button>
    </div>
    <div class="cam-flash"></div>
  </div>`;
}

function stopCamera() {
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  cam.stream = null;
}

// Takes the picture and keeps the area inside the frame (plus a small margin).
function shoot() {
  const wrap = sheetEl('camera');
  const video = wrap?.querySelector('video');
  if (!video || !video.videoWidth) return;
  const frame = wrap.querySelector('.cam-frame').getBoundingClientRect();
  const box = video.getBoundingClientRect();
  const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
  const offX = box.left + (box.width - video.videoWidth * scale) / 2;
  const offY = box.top + (box.height - video.videoHeight * scale) / 2;
  const fw = frame.width / scale;
  const fh = frame.height / scale;
  let sw = fw * 1.16;
  let sh = fh * 1.16;
  let sx = Math.max(0, (frame.left - offX) / scale - (sw - fw) / 2);
  let sy = Math.max(0, (frame.top - offY) / scale - (sh - fh) / 2);
  sw = Math.min(video.videoWidth - sx, sw);
  sh = Math.min(video.videoHeight - sy, sh);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  canvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  wrap.querySelector('.cam-flash')?.classList.add('on');
  buzz(20);
  setTimeout(() => { closeSheet('camera'); useImage(canvas); }, 170);
}

function useImage(img) {
  const photo = imageToDataUrl(img, 560, 0.8);
  const big = imageToDataUrl(img, 1280, 0.85);
  if (pickTarget === 'form' && state.draft) {
    state.draft.data.photo = photo;
    const ph = $('#photo');
    if (ph) ph.outerHTML = photoBlock(state.draft.data);
  } else {
    openForm(null, { photo });
  }
  pickTarget = 'new';
  if (!aiReady()) { showScanMsg('nokey'); return; }
  runAi(big);
}

async function onPhotoPicked(file) {
  if (!file) return;
  let img;
  try { img = await fileToImage(file); } catch (e) { toast(e.message); return; }
  if (sheetEl('camera')) closeSheet('camera');
  useImage(img);
}

async function runAi(image) {
  const d = state.draft;
  if (!d) return;
  d.aiImage = image;
  const token = d.token;
  showScanMsg('');
  setScanning(true);
  try {
    const r = await readLabel(image);
    if (!state.draft || state.draft.token !== token) return;
    applyAi(r);
    state.draft.scanned = true;
    state.draft.aiModel = r.model;
    setScanning(false);
    showScanMsg('ok', r);
    buzz(15);
  } catch (e) {
    if (e.code === 'auth') saveSettings({ keyOk: false });
    if (!state.draft || state.draft.token !== token) return;
    setScanning(false);
    showScanMsg('err', e);
  }
}

function setScanning(on) {
  const ph = $('#photo');
  if (ph) {
    ph.classList.toggle('scanning', on);
    ph.querySelector('.scan-label')?.remove();
    if (on) ph.insertAdjacentHTML('beforeend', '<div class="scan-label"><span class="spinner"></span>KI liest das Etikett …</div>');
  }
  $$('[data-sheet="form"] .field.big').forEach(f => f.classList.toggle('loading', on));
}

// Fills the form field by field, so the reading "appears" like typing.
const FILL_ORDER = ['producer', 'grape', 'vintage', 'color', 'name', 'region', 'country', 'drinkFrom', 'drinkTo'];
function applyAi(r) {
  const d = state.draft;
  if (!d) return;
  const token = d.token;
  const step = effectsOn() ? 120 : 0;
  const entries = Object.entries(r.fields)
    .filter(([key, value]) => value != null && value !== '' && !(d.touched.has(key) && String(d.data[key] ?? '').trim()))
    .sort((a, b) => FILL_ORDER.indexOf(a[0]) - FILL_ORDER.indexOf(b[0]));
  entries.forEach(([key, value], i) => {
    d.data[key] = value;
    setTimeout(() => {
      if (!state.draft || state.draft.token !== token) return;
      if (key === 'color') {
        $$('[data-color]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.color === value)));
        return;
      }
      const input = $(`#f-${key}`);
      if (!input) return;
      input.value = value;
      const f = input.closest('.field');
      f.classList.remove('filled');
      void f.offsetWidth;
      f.classList.add('filled');
      buzz(4);
    }, i * step);
  });
  d.unsure = r.unsure;
  setTimeout(() => {
    if (!state.draft || state.draft.token !== token) return;
    r.unsure.forEach(k => $(`[data-sheet="form"] .field[data-f="${k}"]`)?.classList.add('unsure'));
    dupCheck();
  }, entries.length * step);
}

function showScanMsg(kind, x) {
  const el = $('#scan-msg');
  if (!el) return;
  if (kind === 'nokey') {
    el.innerHTML = `<div class="callout info">${icon('sparkles')}<span><b>Ohne KI tippst du selbst.</b> Mit der Gratis-KI füllen sich die Felder von allein. <button type="button" class="link" data-action="goto-ai">KI einrichten</button></span></div>`;
  } else if (kind === 'ok') {
    const f = x.fields;
    const extra = [f.region, f.country, f.drinkFrom && f.drinkTo ? `Trinkfenster ${f.drinkFrom}–${f.drinkTo}` : ''].filter(Boolean).join(' · ');
    const labels = { producer: 'Winzer', name: 'Wein', grape: 'Rebsorte', vintage: 'Jahrgang', region: 'Region', country: 'Land', color: 'Art', drinkFrom: 'Trinken ab', drinkTo: 'Trinken bis' };
    const unsure = x.unsure.map(k => labels[k]).filter(Boolean);
    if (x.unsure.some(k => ['name', 'region', 'country', 'drinkFrom', 'drinkTo'].includes(k))) {
      const det = $('[data-sheet="form"] details.more');
      if (det) det.open = true;
    }
    el.innerHTML = `<div class="callout good">${icon('check')}<span><b>Gelesen!</b> ${unsure.length ? `Bitte prüfen: ${esc(unsure.join(', '))}.` : 'Kurz prüfen, dann speichern.'}${extra ? `<br><small>Auch erkannt: ${esc(extra)}</small>` : ''}</span></div>`;
  } else if (kind === 'err') {
    let actions = '';
    if (x.code === 'auth' || x.code === 'nokey' || x.code === 'credits') actions = '<button type="button" class="link" data-action="goto-ai">Zu den KI-Einstellungen</button>';
    else if (x.code === 'nolabel') actions = '<button type="button" class="link" data-action="form-camera">Neues Foto</button>';
    else if (x.code !== 'limit') actions = '<button type="button" class="link" data-action="retry-ai">Nochmal versuchen</button>';
    el.innerHTML = `<div class="callout warn"><span>${esc(x.message)} ${actions}</span></div>`;
  } else {
    el.innerHTML = '';
  }
}

/* ---------- detail ---------- */
function openDetail(id) {
  const w = byId(id);
  if (!w) return;
  openSheet('detail', detailHtml(w), { cls: 'tall' });
}

function refreshDetail(id) {
  const el = sheetEl('detail');
  if (!el) return;
  const w = byId(id);
  if (!w) { closeSheet('detail'); return; }
  const body = el.querySelector('.sheet-body');
  const top = body ? body.scrollTop : 0;
  el.querySelector('.sheet').innerHTML = detailHtml(w);
  const next = el.querySelector('.sheet-body');
  if (next) next.scrollTop = top;
}

function detailHtml(w) {
  const st = status(w);
  const evs = state.events.filter(e => e.wineId === w.id).sort((a, b) => b.date - a.date);
  const rows = [
    w.location && [placeById(w.placeId) ? '📝 Notiz zum Ort' : '📍 Lagerort', esc(w.location)],
    w.price != null && w.price !== '' && ['💶 Preis', fmtEuro(Number(w.price))],
    w.region && ['🗺️ Region', esc(w.region)],
    w.country && ['🌍 Land', `${FLAGS[w.country] || ''} ${esc(w.country)}`],
    ['🗓️ Eingetragen', fmtDate(w.createdAt)],
    w.scanned && ['🤖 Gelesen von', esc(modelLabel(w.aiModel) || 'KI')],
  ].filter(Boolean);
  const origin = w.region || w.country;
  const tags = [
    ...grapesOf(w).map(g => `<button class="pill pill-link" data-search="${esc(g)}" aria-label="Alle Weine mit ${esc(g)} zeigen">🍇 ${esc(g)}</button>`),
    origin ? `<button class="pill pill-link" data-search="${esc(origin)}" aria-label="Alle Weine aus ${esc(origin)} zeigen">${flagOf(w) || '📍'} ${esc(origin)}</button>` : '',
    w.color ? `<span class="pill"><i class="cdot" style="background:${COLORS[w.color].dot}"></i>${COLORS[w.color].label}</span>` : '',
    w.sweetness ? `<span class="pill">${esc(sweetLabel(w.sweetness))}</span>` : '',
    w.demo ? '<span class="pill demo">Beispiel</span>' : '',
  ].join('');
  const np = nameParts(w);
  // Grapes and origin are in the chips below, so the line under the name stays short.
  const sub = w.vintage ? `Jahrgang ${w.vintage}` : 'ohne Jahrgang';
  const photo = safePhoto(w.photo);
  return `<div class="sheet-body">
    <div class="hero ${photo ? 'has-photo' : tileClass(w)}">${photo ? `<img src="${photo}" alt="Etikett">` : `<div class="hero-bottle">${bottleSvg(w, 188)}</div>`}
      <span class="hero-grab" aria-hidden="true"></span>
      <button class="icon-btn" data-action="close-sheet" aria-label="Schließen">${icon('x')}</button></div>
    <div class="detail-title">${np.kicker ? `<span class="kicker">${esc(np.kicker)}</span>` : ''}<h2>${esc(np.title)}</h2><p>${esc(sub)}</p></div>
    ${tags ? `<div class="tags">${tags}</div>` : ''}
    <div class="stock-row">
      <div class="stock"><b>${w.qty}</b><span>${w.qty === 1 ? 'Flasche' : 'Flaschen'} im Keller</span></div>
      <button class="btn ghost small" data-action="qty" data-id="${w.id}" data-d="1">${icon('plus')} 1 dazugekauft</button>
    </div>
    ${w.qty > 0 ? `<button class="btn primary block open-btn" data-action="open-bottle" data-id="${w.id}">🍷 Flasche öffnen</button>` : '<p class="muted center small" style="margin:4px 0 12px">Ausgetrunken. Mit „1 dazugekauft“ kommt er zurück in den Keller.</p>'}
    ${whereCard(w)}
    ${w.drinkFrom || w.drinkTo
      ? `<div class="tw"><div class="tw-top"><b>Trinkfenster</b><span class="pill st st-${st}">${STATUS[st].label}</span></div>${windowBar(w)}</div>`
      : `<button class="tw add" data-action="edit" data-id="${w.id}">${icon('plus')} Trinkfenster eintragen</button>`}
    ${tasteCard(w)}
    ${pairingCard(w)}
    <div class="ext-links">
      <a class="ext" href="${esc(vivinoUrl(w))}" target="_blank" rel="noopener">${icon('star')}<span>Bewertungen<small>auf Vivino</small></span></a>
      <a class="ext" href="${esc(wineSearcherUrl(w))}" target="_blank" rel="noopener">${icon('tag')}<span>Preise vergleichen<small>auf Wine-Searcher</small></span></a>
    </div>
    <div class="kv">${rows.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('')}</div>
    ${w.notes ? `<div class="note-box"><b>Notiz</b><p>${esc(w.notes)}</p></div>` : ''}
    ${evs.length ? `<h3 class="section-title">Geöffnet <small>${evs.length}×</small></h3><div class="events">${evs.map(evHtml).join('')}</div>` : ''}
    <div class="row-btns end" style="margin-top:18px">
      <button class="btn ghost small" data-action="edit" data-id="${w.id}">${icon('edit')} Bearbeiten</button>
      <button class="btn ghost small danger" data-action="delete" data-id="${w.id}">${icon('trash')} Löschen</button>
    </div>
  </div>`;
}

// Taste bars like the big wine apps: a marker between two words per row.
const TASTE_ROWS = [['body', 'Leicht', 'Kräftig'], ['tannin', 'Sanft', 'Tanninreich'], ['sweet', 'Trocken', 'Süß'], ['acid', 'Mild', 'Säurebetont']];
function tasteCard(w) {
  const t = tasteOf(w);
  if (!t) return '';
  const rows = TASTE_ROWS.filter(([k]) => t.values[k] != null).map(([k, lo, hi]) => {
    const pos = 15 + ((t.values[k] - 1) / 4) * 70;
    return `<div class="taste-row"><span>${lo}</span><span class="taste-track" role="img" aria-label="${lo} bis ${hi}: ${t.values[k]} von 5"><i style="left:${pos.toFixed(1)}%"></i></span><span>${hi}</span></div>`;
  }).join('');
  const source = t.source === 'ai' ? 'Schätzung der KI' : `typisch für ${esc(t.label)}`;
  return `<div class="taste"><div class="taste-top"><b>Geschmack</b><small>${source}</small></div>${rows}</div>`;
}

// Dishes for this wine; a tap asks the sommelier with that dish.
function pairingCard(w) {
  const p = pairingOf(w);
  if (!p.dishes.length) return '';
  return `<div class="pairing"><div class="taste-top"><b>Passt zu</b><small>${p.source === 'ai' ? 'Vorschlag der KI' : `typisch für ${esc(p.label)}`}</small></div>
    <div class="pair-chips">${p.dishes.map(d => `<button class="pair-chip" data-foodgo="${esc(d)}" aria-label="Sommelier fragen: ${esc(d)}">🍽️ ${esc(d)}</button>`).join('')}</div></div>`;
}

// Short, calm animation when a bottle is opened: a glass fills with the wine's colour.
function pourAnim(color) {
  if (!effectsOn()) return;
  const fill = COLORS[color]?.dot || '#8e1b3a';
  const el = document.createElement('div');
  el.className = 'pour';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg viewBox="0 0 120 150" width="96" height="120">
    <defs><clipPath id="pour-clip"><path d="M32 18h56c0 42-8 64-28 68-20-4-28-26-28-68z"/></clipPath></defs>
    <g clip-path="url(#pour-clip)"><rect class="pour-wine" x="20" y="18" width="80" height="70" fill="${fill}"/></g>
    <path d="M32 18h56c0 42-8 64-28 68-20-4-28-26-28-68z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M60 86v38M42 126h36" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" fill="none"/>
  </svg><span>Prost!</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

// "Wo liegt er?": the place, the slot names and a small plan with this wine's bottles lit up.
function whereCard(w) {
  const p = placeById(w.placeId);
  if (!p) {
    return state.places.length && w.qty > 0
      ? `<button class="tw add" data-action="open-placement" data-id="${w.id}">${icon('pin')} Ins Lager legen</button>`
      : '';
  }
  const slots = (w.slots || []).filter(k => validSlot(p, k));
  const label = slots.length ? `Platz ${slots.map(slotLabel).join(', ')}` : (hasGrid(p) ? 'Noch ohne festen Platz' : plural(w.qty, 'Flasche', 'Flaschen'));
  const others = state.places.filter(o => o.id !== p.id);
  return `<div class="where">
    <div class="where-top"><span class="place-emoji">${kindOf(p).emoji}</span><span class="place-text"><b>${esc(p.name)}</b><small>${label}</small></span><button class="link" data-action="open-placement" data-id="${w.id}">Ändern</button></div>
    ${hasGrid(p) && w.qty > 0 ? rackHtml(p, { mode: 'mine', wineId: w.id, size: 'rack-mini' }) : ''}
    ${others.length && w.qty > 0 ? `<div class="move-row"><span>Umziehen</span>${others.map(o => `<button class="chip" data-moveto="${o.id}" data-id="${w.id}">${kindOf(o).emoji} ${esc(o.name)}</button>`).join('')}</div>` : ''}
  </div>`;
}

function evHtml(e) {
  const stars = e.rating ? `<span class="ev-stars" aria-label="${e.rating} von 5 Sternen">${'★'.repeat(e.rating)}${'☆'.repeat(5 - e.rating)}</span>` : '';
  const count = e.count > 1 ? `<span>${e.count} Flaschen</span>` : '';
  return `<div class="ev"><div class="ev-top"><span>${fmtDate(e.date)}</span>${count}${stars}${e.inWindow ? '<span class="pill st st-jetzt">im Trinkfenster</span>' : ''}</div>${e.note ? `<p>${esc(e.note)}</p>` : ''}</div>`;
}

// Bottles that leave the cellar free their slots; new bottles get the next free slots.
function syncSlots(w) {
  const p = placeById(w.placeId);
  if (!hasGrid(p)) { w.slots = []; return; }
  const valid = (w.slots || []).filter(k => validSlot(p, k));
  w.slots = valid.length > w.qty ? valid.slice(0, w.qty) : valid;
}

async function changeQty(id, delta) {
  const w = byId(id);
  if (!w) return;
  const next = Math.max(0, Math.min(999, w.qty + delta));
  if (next === w.qty) return;
  w.qty = next;
  w.updatedAt = Date.now();
  const p = placeById(w.placeId);
  if (delta > 0 && hasGrid(p)) w.slots = autoSlots(p, w.id, w.slots, w.qty);
  else syncSlots(w);
  try { await db.put('wines', w); } catch (_) { toast('Speichern hat nicht geklappt.'); }
  buzz(8);
  render();
  refreshDetail(id);
  if (delta > 0) progress(0);
}

/* ---------- opening a bottle ---------- */
function openBottle(id) {
  const w = byId(id);
  if (!w || w.qty <= 0) return;
  const st = status(w);
  const inWindow = st === 'jetzt' || st === 'bald';
  state.drink = { id, rating: 0, inWindow, count: 1 };
  let hint = '';
  if (inWindow) hint = '<div class="callout good">🎯 <span><b>Perfektes Timing!</b> Der Wein ist gerade im Trinkfenster.</span></div>';
  else if (st === 'lagern') hint = '<div class="callout warn"><span>Eigentlich ist er noch jung. Trotzdem gut, wenn er schmeckt!</span></div>';
  else if (st === 'drueber') hint = '<div class="callout warn"><span>Höchste Zeit, gut, dass du ihn jetzt öffnest.</span></div>';
  openSheet('drink', `<div class="grab"></div>
    <div class="sheet-head"><h2>Prost! 🥂</h2><button class="icon-btn flat" data-action="close-sheet" aria-label="Schließen">${icon('x')}</button></div>
    <div class="sheet-body">
      <p class="muted center" style="margin:0 0 12px">${esc(wineTitle(w))}${w.vintage ? ` · ${w.vintage}` : ''}</p>
      ${w.qty > 1 ? `<div class="drink-count"><span>Wie viele Flaschen?</span><div class="stepper"><button type="button" data-dcount="-1" aria-label="Eine weniger">${icon('minus')}</button><output id="drink-n">1</output><button type="button" data-dcount="1" aria-label="Eine mehr">${icon('plus')}</button></div><small>von ${w.qty}</small></div>` : ''}
      ${hint}
      <div class="stars" role="group" aria-label="Bewertung">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}" aria-label="${n} von 5 Sternen">★</button>`).join('')}</div>
      <label class="field"><span>Wie war er?</span><textarea id="drink-note" rows="3" placeholder="Duft, Geschmack, zu welchem Essen …"></textarea></label>
      <p class="small muted center" style="margin:0">Notizen bringen +${XP.note} XP und machen dich zur feinen Zunge.</p>
    </div>
    <div class="sheet-foot"><button class="btn ghost" data-action="drink-confirm" data-skip="1">Ohne Notiz</button><button class="btn primary" data-action="drink-confirm">Speichern</button></div>`);
}

async function confirmDrink(skip) {
  const dr = state.drink;
  const w = dr && byId(dr.id);
  if (!w) return;
  const note = skip ? '' : ($('#drink-note')?.value || '').trim();
  const rating = skip ? 0 : dr.rating;
  const before = { ...w, slots: [...(w.slots || [])] };
  const count = Math.max(1, Math.min(w.qty, dr.count || 1));
  w.qty = Math.max(0, w.qty - count);
  w.updatedAt = Date.now();
  syncSlots(w);
  const ev = { id: uid(), wineId: w.id, type: 'open', date: Date.now(), rating, note, inWindow: dr.inWindow, count };
  state.events.push(ev);
  try { await Promise.all([db.put('wines', w), db.put('events', ev)]); } catch (_) { toast('Speichern hat nicht geklappt.'); }
  state.drink = null;
  closeSheet('drink');
  render();
  refreshDetail(w.id);
  // Timing points only once per wine, so the game never rewards opening more bottles.
  const firstTiming = dr.inWindow && !state.events.some(e => e.wineId === w.id && e.inWindow && e.id !== ev.id);
  const base = w.demo ? 0 : (note ? XP.note : 0) + (rating ? XP.rating : 0) + (firstTiming ? XP.timing : 0);
  pourAnim(w.color);
  if (dr.inWindow) setTimeout(() => celebrate('small'), 900);
  const res = await progress(base);
  const left = w.qty
    ? `${count > 1 ? `${count} geöffnet · ` : ''}Noch ${plural(w.qty, 'Flasche', 'Flaschen')} übrig`
    : (count > 1 ? `${count} geöffnet, das waren die letzten` : 'Das war die letzte Flasche');
  toast(`${left}${res.total ? ` · +${res.total} XP` : ''}`, { action: 'Rückgängig', onAction: () => undoDrink(before, ev, base) });
}

async function undoDrink(before, ev, xp) {
  const w = byId(before.id);
  if (!w) return;
  Object.assign(w, before);
  state.events = state.events.filter(e => e.id !== ev.id);
  state.game.xp = Math.max(0, state.game.xp - xp);
  try { await Promise.all([db.put('wines', w), db.del('events', ev.id), saveGame()]); } catch (_) { /* ignore */ }
  render();
  refreshDetail(w.id);
  toast('Rückgängig gemacht');
}

/* ---------- storage sheets ---------- */
// "Wo liegt er?": pick the place and tap the slots. Changes are saved right away.
function openPlacement(id) {
  const w = byId(id);
  if (!w) return;
  state.placing = id;
  openSheet('place', placementHtml(w), { onClose: () => { state.placing = null; } });
}

function placementHtml(w) {
  const p = placeById(w.placeId);
  return `<div class="grab"></div>
    <div class="sheet-head"><h2>Wo liegt er?</h2><button class="icon-btn flat" data-action="close-sheet" aria-label="Schließen">${icon('x')}</button></div>
    <div class="sheet-body">
      <p class="muted" style="margin:0 0 12px">${esc(nameParts(w).title)}${w.vintage ? ` · ${w.vintage}` : ''} · ${plural(w.qty, 'Flasche', 'Flaschen')}</p>
      <div class="seg" role="radiogroup" aria-label="Lager" style="margin-bottom:14px">${state.places.map(pl => `<button type="button" class="seg-btn" role="radio" data-pplace="${pl.id}" aria-checked="${w.placeId === pl.id}">${kindOf(pl).emoji} ${esc(pl.name)}</button>`).join('')}<button type="button" class="seg-btn add" data-action="new-place" aria-label="Neues Lager anlegen">${icon('plus')}</button></div>
      ${hasGrid(p) ? `<p class="small muted" style="margin:0 0 10px">Tippe auf die Plätze, wo die Flaschen liegen. Gold = dieser Wein.</p>
        ${rackHtml(p, { mode: 'pick', wineId: w.id, picked: w.slots || [], color: w.color })}
        <div class="slot-tools"><button type="button" class="link" data-action="auto-slots">Automatisch</button><button type="button" class="link" data-action="clear-slots">Ohne festen Platz</button></div>`
      : p ? '<p class="small muted">Hier gibt es keine festen Plätze, die Flaschen werden einfach gezählt.</p>' : ''}
    </div>
    <div class="sheet-foot"><button class="btn primary block" data-action="close-sheet">Fertig</button></div>`;
}

async function updatePlacedWine(w) {
  w.updatedAt = Date.now();
  try { await db.put('wines', w); } catch (_) { toast('Speichern hat nicht geklappt.'); }
  if (w.placeId) saveSettings({ lastPlace: w.placeId });
  const sheet = sheetEl('place');
  if (sheet) sheet.querySelector('.sheet').innerHTML = placementHtml(w);
  refreshDetail(w.id);
  render();
}

// A tapped empty slot: scan a new bottle into it, or move a wine without a slot there.
function openSlotSheet(placeId, key) {
  const p = placeById(placeId);
  if (!p) return;
  state.slotTarget = { placeId, key };
  const waiting = inStock().filter(w => (w.placeId === placeId && (w.slots || []).length < w.qty) || !placeById(w.placeId));
  openSheet('slot', `<div class="grab"></div>
    <div class="sheet-head"><h2>${kindOf(p).emoji} Platz ${slotLabel(key)} ist frei</h2><button class="icon-btn flat" data-action="close-sheet" aria-label="Schließen">${icon('x')}</button></div>
    <div class="sheet-body">
      <button class="btn primary block" data-action="slot-scan">${icon('camera')} Etikett scannen und hierher legen</button>
      ${waiting.length ? `<h3 class="section-title">Oder einen Wein ohne Platz <small>${waiting.length}</small></h3>
        <div class="list">${waiting.slice(0, 30).map(w => `<button class="card" data-slotwine="${w.id}">${thumb(w)}<span class="meta">${nameParts(w).kicker ? `<span class="kicker">${esc(nameParts(w).kicker)}</span>` : ''}<span class="producer">${esc(nameParts(w).title)}</span><span class="line2">${w.vintage || 'o. J.'} · ${plural(w.qty, 'Flasche', 'Flaschen')}</span></span></button>`).join('')}</div>` : ''}
    </div>`);
}

async function putWineInSlot(id) {
  const t = state.slotTarget;
  const w = byId(id);
  const p = t && placeById(t.placeId);
  if (!w || !p) return;
  if (w.placeId !== p.id) { w.placeId = p.id; w.slots = []; }
  w.slots = [...(w.slots || []).filter(k => validSlot(p, k)), t.key];
  if (w.slots.length > w.qty) w.qty = w.slots.length;
  closeSheet('slot');
  await updatePlacedWine(w);
  buzz(15);
  toast(`${nameParts(w).title} liegt jetzt auf ${slotLabel(t.key)}`);
}

// New or edited place: type, name and (for racks) rows and slots per row.
function openPlaceEditor(id = null, kind = 'kuehlschrank', fromSheet = '') {
  const p = placeById(id);
  const k = PLACE_KINDS[p ? p.kind : kind] || PLACE_KINDS.kuehlschrank;
  state.placeDraft = p
    ? { ...p, isNew: false, nameTouched: true, fromSheet }
    : { id: uid(), name: k.label, kind: PLACE_KINDS[kind] ? kind : 'kuehlschrank', rows: k.rows, cols: k.cols, isNew: true, nameTouched: false, fromSheet };
  openSheet('place-edit', placeEditorHtml());
}

function placeEditorHtml() {
  const d = state.placeDraft;
  const grid = (PLACE_KINDS[d.kind] || {}).rows > 0;
  const preview = { ...d, rows: grid ? d.rows : 0, cols: grid ? d.cols : 0 };
  const step = (key, v, label) => `<div class="field"><span>${label}</span><div class="stepper"><button type="button" data-pstep="${key}" data-d="-1" aria-label="${label}: weniger">${icon('minus')}</button><output id="ps-${key}">${v}</output><button type="button" data-pstep="${key}" data-d="1" aria-label="${label}: mehr">${icon('plus')}</button></div></div>`;
  return `<div class="grab"></div>
    <div class="sheet-head"><h2>${d.isNew ? 'Neues Lager' : 'Lager bearbeiten'}</h2><button class="icon-btn flat" data-action="close-sheet" aria-label="Schließen">${icon('x')}</button></div>
    <div class="sheet-body">
      <div class="kind-row">${Object.entries(PLACE_KINDS).map(([key, k]) => `<button type="button" class="kind-chip" data-kind="${key}" aria-pressed="${d.kind === key}"><span>${k.emoji}</span>${k.label}</button>`).join('')}</div>
      <label class="field"><span>Name</span><input id="pl-name" type="text" value="${esc(d.name)}" maxlength="40" autocomplete="off"></label>
      ${grid ? `<div class="row2">${step('rows', d.rows, 'Reihen')}${step('cols', d.cols, 'Plätze pro Reihe')}</div>
        <div id="pl-preview">${rackHtml(preview, { mode: 'preview', size: 'rack-compact' })}</div>`
      : `<p class="small muted">${esc(PLACE_KINDS[d.kind].desc)}. Die Flaschen werden einfach gezählt.</p>`}
    </div>
    <div class="sheet-foot">${d.isNew ? '' : `<button class="btn ghost danger" data-action="place-delete" aria-label="Lager löschen">${icon('trash')}</button>`}<button class="btn primary" data-action="place-save">${d.isNew ? 'Lager anlegen' : 'Speichern'}</button></div>`;
}

async function savePlace() {
  const d = state.placeDraft;
  if (!d) return;
  const grid = (PLACE_KINDS[d.kind] || {}).rows > 0;
  const place = {
    id: d.id, kind: d.kind, name: (d.name || '').trim().slice(0, 40) || PLACE_KINDS[d.kind].label,
    rows: grid ? Math.max(1, Math.min(20, d.rows)) : 0, cols: grid ? Math.max(1, Math.min(12, d.cols)) : 0,
    createdAt: d.createdAt || Date.now(), demo: !!d.demo,
  };
  const idx = state.places.findIndex(p => p.id === place.id);
  if (idx >= 0) state.places[idx] = place; else state.places.push(place);
  // A smaller rack drops slots that no longer exist.
  const touched = state.wines.filter(w => w.placeId === place.id);
  touched.forEach(syncSlots);
  await savePlaces();
  try { await db.putMany('wines', touched); } catch (_) { /* ignore */ }
  const from = d.fromSheet;
  state.placeDraft = null;
  closeSheet('place-edit');
  if (d.isNew) {
    saveSettings({ lastPlace: place.id });
    // Coming from the wine form or "Wo liegt er?": put the wine straight into the new place.
    if (from === 'form' && state.draft) {
      state.draft.data.placeId = place.id;
      state.draft.data.slots = autoSlots(place, state.draft.id, [], Math.max(1, toInt(state.draft.data.qty) || 1));
      const body = sheetEl('form')?.querySelector('.sheet-body');
      const top = body ? body.scrollTop : 0;
      openSheet('form', formHtml());
      const next = sheetEl('form')?.querySelector('.sheet-body');
      if (next) next.scrollTop = top;
    } else if (from === 'place' && state.placing) {
      const w = byId(state.placing);
      if (w) { w.placeId = place.id; w.slots = autoSlots(place, w.id, [], w.qty); await updatePlacedWine(w); }
    }
  }
  render();
  toast(d.isNew ? `${place.name} angelegt` : 'Lager gespeichert');
}

function deletePlace() {
  const d = state.placeDraft;
  const p = d && placeById(d.id);
  if (!p) return;
  const n = state.wines.filter(w => w.placeId === p.id && w.qty > 0).length;
  confirmSheet({
    emoji: '🗄️', title: `${p.name} löschen?`,
    text: n ? `Die ${plural(n, 'Wein bleibt', 'Weine bleiben')} im Keller, nur ohne Lager.` : 'Das Lager ist leer.',
    ok: 'Löschen', danger: true,
    onOk: async () => {
      state.places = state.places.filter(x => x.id !== p.id);
      const touched = state.wines.filter(w => w.placeId === p.id);
      touched.forEach(w => { w.placeId = ''; w.slots = []; });
      if (settings().lastPlace === p.id) saveSettings({ lastPlace: '' });
      await savePlaces();
      try { await db.putMany('wines', touched); } catch (_) { /* ignore */ }
      closeSheet('place-edit');
      render();
      toast('Lager gelöscht');
    },
  });
}

/* ---------- confirm & delete ---------- */
function confirmSheet({ emoji = '⚠️', title, text, ok = 'OK', danger = false, onOk }) {
  state.confirmFn = onOk;
  openSheet('confirm', `<div class="grab"></div>
    <div class="sheet-body confirm"><div class="big-emoji">${emoji}</div><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p></div>
    <div class="sheet-foot"><button class="btn ghost" data-action="close-sheet">Abbrechen</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-action="confirm-ok">${esc(ok)}</button></div>`);
}

function askDelete(id) {
  const w = byId(id);
  if (!w) return;
  confirmSheet({
    emoji: '🗑️', title: `${wineTitle(w)} löschen?`, text: 'Der Wein und seine Notizen verschwinden aus dem Keller.',
    ok: 'Löschen', danger: true, onOk: () => deleteWine(id),
  });
}

async function deleteWine(id) {
  const w = byId(id);
  if (!w) return;
  const evs = state.events.filter(e => e.wineId === id);
  state.wines = state.wines.filter(x => x.id !== id);
  state.events = state.events.filter(e => e.wineId !== id);
  try { await db.del('wines', id); await db.delMany('events', evs.map(e => e.id)); } catch (_) { /* ignore */ }
  closeSheet('detail');
  render();
  toast('Gelöscht', {
    action: 'Rückgängig',
    onAction: async () => {
      state.wines.unshift(w);
      state.events.push(...evs);
      try { await db.put('wines', w); await db.putMany('events', evs); } catch (_) { /* ignore */ }
      render();
    },
  });
}

/* ---------- Sammlung ---------- */
function viewSammlung() {
  const lv = levelInfo(state.game.xp);
  const s = computeStats(state.wines, state.events, state.game);
  const unlocked = ACHIEVEMENTS.filter(a => state.game.unlocked[a.id]).length;
  const albumHave = GRAPES.filter(g => s.grapes.get(g.name)).length;
  const extra = [...s.grapes.keys()].filter(g => !GRAPES.some(x => x.name === g));
  const countries = [...s.countries].sort((a, b) => b[1] - a[1]);
  const stats = [
    ['Flaschen im Keller', s.bottles],
    ['Weine eingetragen', s.wineCount],
    s.value > 0 && ['Kellerwert', fmtEuro(Math.round(s.value))],
    ['Ältester Jahrgang', s.oldest || '—'],
    ['Lieblingsrebsorte', s.favorite ? esc(s.favorite) : '—'],
    ['Verkostungsnotizen', s.notes],
    ['Gescannte Etiketten', s.scans],
  ].filter(Boolean);
  return `${topbar('Sammlung', 'Level, Erfolge, Rebsorten und Länder')}
    <section class="level-card">${ring(lv.progress, 86, lv.level)}
      <div class="lv-text"><small>Level ${lv.level}</small><b>${esc(lv.name)}</b>
        <div class="xpbar"><i style="width:${(lv.progress * 100).toFixed(1)}%"></i></div>
        <span>${lv.next ? `${state.game.xp} von ${lv.next} XP · noch ${lv.next - state.game.xp} bis Level ${lv.level + 1}` : `${state.game.xp} XP · höchstes Level!`}</span>
      </div>
    </section>
    <h2 class="section-title">Erfolge <small>${unlocked} von ${ACHIEVEMENTS.length}</small></h2>
    <div class="badges">${ACHIEVEMENTS.map(a => badge(a, s)).join('')}</div>
    <h2 class="section-title">Rebsorten-Album <small>${albumHave} von ${GRAPES.length}</small></h2>
    <div class="album">${GRAPES.map(g => {
      const n = s.grapes.get(g.name) || 0;
      return `<div class="sticker${n ? ` have ${g.type}` : ''}"><span class="g">🍇</span><span>${esc(g.name)}</span>${n ? `<span class="n">${plural(n, 'Wein', 'Weine')}</span>` : ''}</div>`;
    }).join('')}</div>
    ${extra.length ? `<p class="small muted">Außerdem gesammelt: ${esc(extra.join(', '))}</p>` : ''}
    <h2 class="section-title">Länder <small>${countries.length}</small></h2>
    ${countries.length
      ? `<div class="flags">${countries.map(([c, n]) => `<span class="flag">${FLAGS[c] || '🏳️'} ${esc(c)} <b>${n}</b></span>`).join('')}</div>`
      : '<p class="muted small">Noch keine Länder. Jeder Wein mit Herkunft zählt.</p>'}
    <h2 class="section-title">Zahlen</h2>
    <div class="kv">${stats.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('')}</div>
    <p class="small muted center" style="margin-top:16px">Punkte gibt es fürs Sammeln, Notieren und gutes Timing, nicht fürs Vieltrinken. 🍇</p>`;
}

function badge(a, s) {
  const when = state.game.unlocked[a.id];
  const v = Math.min(a.val(s), a.goal);
  const extra = when
    ? `<span class="b-when">✓ ${fmtDate(when)}</span>`
    : a.goal > 1 ? `<div class="prog"><i style="width:${((v / a.goal) * 100).toFixed(0)}%"></i></div><span class="b-when">${v} / ${a.goal}</span>` : '';
  return `<div class="badge ${when ? 'done' : 'locked'}"><div class="b-ico">${a.emoji}</div><span class="b-name">${esc(a.title)}</span><span class="b-desc">${esc(a.desc)}</span>${extra}</div>`;
}

/* ---------- Sommelier ---------- */
function viewSommelier() {
  const stock = inStock();
  const soon = stock.filter(w => ['bald', 'drueber'].includes(status(w))).sort(SORTERS.reife);
  return `${topbar('Sommelier', 'Was trinken wir heute?')}
    <section class="somm">
      <label class="field"><span>Was gibt’s zu essen?</span><input id="food" type="text" placeholder="z. B. Schnitzel, Pasta, Käse …" value="${esc(state.sommFood)}" enterkeyhint="go" autocomplete="off"></label>
      <div class="chips wrap">${FOODS.map(([e, f]) => `<button class="chip" data-food="${esc(f)}">${e} ${esc(f)}</button>`).join('')}</div>
      <button class="btn primary block" data-action="ask-somm"${stock.length ? '' : ' disabled'}>${icon('sparkles')} Vorschlag holen</button>
      <p class="small muted center" style="margin:10px 0 0">${stock.length ? (aiReady() ? 'Die KI wählt aus deinem eigenen Keller.' : 'Ohne KI wählt die App nach einfachen Regeln. Mit KI wird’s persönlicher.') : 'Trag zuerst ein paar Weine ein.'}</p>
    </section>
    <div id="somm-out">${state.somm ? sommResult(state.somm) : ''}</div>
    ${soon.length ? `<h2 class="section-title">Bald trinken <small>${soon.length}</small></h2><div class="list">${soon.slice(0, 6).map(card).join('')}</div>` : ''}`;
}

function sommResult(r) {
  const picks = r.picks.filter(p => byId(p.w.id));
  if (!picks.length) return '';
  return `<h2 class="section-title">${r.ai ? '🤵 Mein Vorschlag' : '🍷 Vorschlag'} <small>zu ${esc(r.food)}</small></h2>
    ${r.note ? `<p class="small muted">${esc(r.note)}</p>` : ''}
    <div class="list">${picks.map((p, i) => `<button class="card pick" data-open="${p.w.id}" style="animation-delay:${i * 70}ms">${thumb(p.w)}<span class="meta"><span class="producer">${i === 0 ? '🥇 ' : ''}${esc(wineTitle(p.w))}</span><span class="line2">${esc([p.w.grape, p.w.vintage].filter(Boolean).join(' · '))}</span><span class="why">${esc(p.why)}</span></span></button>`).join('')}</div>
    ${r.tipp ? `<div class="callout info" style="margin-top:12px">💡 <span>${esc(r.tipp)}</span></div>` : ''}`;
}

async function askSomm() {
  const input = $('#food');
  const food = (input?.value || '').trim() || 'einfach so';
  state.sommFood = food === 'einfach so' ? '' : food;
  const out = $('#somm-out');
  const stock = inStock();
  if (!stock.length || !out) return;
  out.innerHTML = '<div class="thinking"><span class="dots"><i></i><i></i><i></i></span> Der Sommelier schaut in deinen Keller …</div>';
  let result = null;
  let aiErr = null;
  if (aiReady()) {
    try {
      const r = await askSommelier(food, stock);
      const picks = r.picks.map(p => ({ w: byId(p.id), why: p.grund })).filter(p => p.w);
      if (picks.length) result = { food, ai: true, picks, tipp: r.tipp };
    } catch (e) { aiErr = e; }
  }
  if (!result) {
    const ranked = rankForFood(stock, food);
    result = {
      food, ai: false, tipp: '',
      picks: ranked.map(p => ({ w: p.w, why: pairingReason(p, food) })),
      note: aiErr ? `${aiErr.message} Deshalb ein Vorschlag nach einfachen Regeln.` : '',
    };
  }
  state.somm = result;
  if ($('#somm-out')) $('#somm-out').innerHTML = sommResult(result);
  state.game.sommelier = (state.game.sommelier || 0) + 1;
  buzz(15);
  progress(XP.sommelier);
}

/* ---------- Mehr (settings) ---------- */
function viewMehr() {
  const s = settings();
  const ks = state.keyStatus;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const hasDemo = state.wines.some(w => w.demo);
  return `${topbar('Mehr', 'KI, Daten und Einstellungen')}
    <section class="panel">
      <h2 class="panel-title">${icon('sparkles')} Gratis-KI ${s.apiKey ? (s.keyOk === false ? '<span class="pill st st-drueber">Schlüssel prüfen</span>' : '<span class="pill st st-jetzt">aktiv</span>') : ''}${isMock() ? '<span class="pill demo">Demo-Modus</span>' : ''}</h2>
      <p class="muted">Die KI liest deine Etiketten und spielt Sommelier. Sie läuft über OpenRouter und kostet nichts.</p>
      <ol class="howto">
        <li>Bei <a href="https://openrouter.ai" target="_blank" rel="noopener">openrouter.ai</a> ein Gratis-Konto anlegen.</li>
        <li>Unter <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener">Keys</a> einen Schlüssel erstellen.</li>
        <li>Hier einfügen und testen.</li>
      </ol>
      <label class="field"><span>Schlüssel</span><span class="input-row"><input id="api-key" type="password" placeholder="sk-or-…" value="${esc(s.apiKey)}" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" class="icon-btn flat" data-action="toggle-key" aria-label="Schlüssel zeigen oder verbergen">${icon('eye')}</button></span></label>
      <label class="field"><span>Modell</span><select id="model"><option value="auto">Automatisch (empfohlen)</option>${s.model && s.model !== 'auto' ? `<option value="${esc(s.model)}" selected>${esc(modelLabel(s.model))}</option>` : ''}</select></label>
      <div class="row-btns"><button class="btn primary small" data-action="save-key">${icon('check')} Speichern und testen</button>${s.apiKey ? '<button class="btn ghost small" data-action="remove-key">Entfernen</button>' : ''}</div>
      <div id="key-status" class="key-status">${ks ? `<span class="${ks.ok ? 'ok' : 'err'}">${esc(ks.text)}</span>` : ''}</div>
      <p class="small muted">Gratis heißt: 50 Anfragen pro Tag. Wer bei OpenRouter einmal 10 $ Guthaben kauft, bekommt 1.000 pro Tag. Der Schlüssel bleibt nur auf diesem Gerät.</p>
    </section>
    <section class="panel">
      <h2 class="panel-title">${icon('rack')} Lager</h2>
      <p class="muted">Weinkühlschrank, Kellerregal, Kiste: Leg an, wo deine Flaschen liegen. Mit Plan siehst du jeden Platz.</p>
      ${state.places.length ? `<div class="place-list">${state.places.map(p => `<button class="place-row" data-editplace="${p.id}"><span class="place-emoji">${kindOf(p).emoji}</span><span class="place-text"><b>${esc(p.name)}</b><small>${hasGrid(p) ? `${p.rows} Reihen × ${p.cols} Plätze` : kindOf(p).label}</small></span>${icon('edit')}</button>`).join('')}</div>` : ''}
      <div class="row-btns"><button class="btn small" data-action="new-place">${icon('plus')} Lager anlegen</button></div>
    </section>
    <section class="panel">
      <label class="switch"><span><b>Mehr Weinarten</b><small>Orange, Perlwein, Likörwein und die Geschmacksrichtung: trocken, halbtrocken, lieblich, süß, bei Sekt brut und Co.</small></span><input type="checkbox" id="more-types"${s.moreTypes ? ' checked' : ''}></label>
    </section>
    <section class="panel">
      <label class="switch"><span><b>Konfetti und Effekte</b><small>Feiern beim Speichern und bei Erfolgen</small></span><input type="checkbox" id="effects"${s.effects !== false ? ' checked' : ''}></label>
    </section>
    <section class="panel">
      <h2 class="panel-title">${icon('download')} Deine Daten</h2>
      <p class="muted">Dein Keller liegt nur auf diesem Gerät. Mach ab und zu eine Sicherung.</p>
      <div class="row-btns"><button class="btn small" data-action="backup">${icon('download')} Sicherung speichern</button><button class="btn small" data-action="restore">${icon('upload')} Sicherung laden</button></div>
      <div class="row-btns">${hasDemo ? '<button class="btn ghost small" data-action="remove-demo">Beispielweine entfernen</button>' : (!state.wines.length ? '<button class="btn ghost small" data-action="demo">Beispielweine laden</button>' : '')}<button class="btn ghost small danger" data-action="wipe">${icon('trash')} Alles löschen</button></div>
    </section>
    <section class="panel">
      <h2 class="panel-title">${icon('phone')} Als App aufs Handy</h2>
      ${standalone ? '<p class="muted">Läuft schon als App. 🎉</p>' : `${deferredPrompt ? '<div class="row-btns" style="margin:4px 0 8px"><button class="btn primary small" data-action="install">App installieren</button></div>' : ''}
        <p class="small muted"><b>iPhone:</b> In Safari auf „Teilen“ tippen, dann „Zum Home-Bildschirm“.<br><b>Android:</b> Im Chrome-Menü „App installieren“ wählen.</p>`}
    </section>
    <p class="small muted center">Weinkeller · Version 0.1 · ${plural(state.wines.length, 'Wein', 'Weine')} auf diesem Gerät</p>`;
}

async function loadModels() {
  const sel = $('#model');
  if (!sel) return;
  try {
    const rank = id => { const i = AUTO_MODELS.indexOf(id); return i < 0 ? 99 : i; };
    const list = (await freeVisionModels()).slice().sort((a, b) => rank(a.id) - rank(b.id));
    const current = settings().model || 'auto';
    if (!$('#model')) return;
    sel.innerHTML = '<option value="auto">Automatisch (empfohlen)</option>' + list.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    if (current !== 'auto' && !list.some(m => m.id === current)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(current)}">${esc(modelLabel(current))}</option>`);
    sel.value = current;
  } catch (_) { /* offline: keep the default */ }
}

async function saveKey() {
  const key = ($('#api-key')?.value || '').trim();
  const model = $('#model')?.value || 'auto';
  saveSettings({ apiKey: key, model, keyOk: null });
  if (!key) { state.keyStatus = null; render(); return; }
  const st = $('#key-status');
  if (st) st.innerHTML = '<span class="muted">Teste den Schlüssel …</span>';
  try {
    const info = await testKey(key);
    const tier = info.is_free_tier === false ? 'Mit Guthaben: 1.000 Gratis-Anfragen pro Tag.' : 'Gratis: 50 Anfragen pro Tag.';
    state.keyStatus = { ok: true, text: `✓ Schlüssel funktioniert. ${tier}` };
    saveSettings({ keyOk: true });
    celebrate('small');
  } catch (e) {
    state.keyStatus = { ok: false, text: `✗ ${e.message}` };
    if (e.code === 'auth') saveSettings({ keyOk: false });
  }
  render();
}

/* ---------- backup, demo, wipe ---------- */
async function backup() {
  try {
    const data = await db.exportAll();
    const name = `weinkeller-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Weinkeller-Sicherung' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('Sicherung gespeichert');
  } catch (_) {
    toast('Die Sicherung hat nicht geklappt.');
  }
}

function cleanWine(w) {
  const s = v => (v == null ? '' : String(v).slice(0, 300));
  const n = v => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : null);
  return {
    id: s(w.id), createdAt: n(w.createdAt) || Date.now(), updatedAt: n(w.updatedAt) || Date.now(),
    producer: s(w.producer), name: s(w.name), grape: s(w.grape), vintage: n(w.vintage), color: COLORS[w.color] ? w.color : '',
    region: s(w.region), country: s(w.country), drinkFrom: n(w.drinkFrom), drinkTo: n(w.drinkTo), location: s(w.location),
    price: n(w.price), qty: Math.max(0, Math.round(n(w.qty) || 0)), notes: String(w.notes ?? '').slice(0, 4000),
    photo: typeof w.photo === 'string' && w.photo.startsWith('data:image/') ? w.photo : '',
    scanned: !!w.scanned, aiModel: s(w.aiModel), demo: !!w.demo, taste: cleanTaste(w.taste),
    sweetness: s(w.sweetness).slice(0, 20), placeId: s(w.placeId).slice(0, 60), pairing: cleanPairing(w.pairing),
    slots: (Array.isArray(w.slots) ? w.slots : []).map(String).filter(k => /^\d{1,2}-\d{1,2}$/.test(k)).slice(0, 240),
  };
}

function cleanPlaces(list) {
  return (Array.isArray(list) ? list : []).filter(p => p && p.id && PLACE_KINDS[p.kind]).slice(0, 30).map(p => {
    const grid = PLACE_KINDS[p.kind].rows > 0;
    return {
      id: String(p.id).slice(0, 60), kind: p.kind, name: String(p.name || PLACE_KINDS[p.kind].label).slice(0, 40),
      rows: grid ? Math.max(1, Math.min(20, Math.round(Number(p.rows) || 1))) : 0,
      cols: grid ? Math.max(1, Math.min(12, Math.round(Number(p.cols) || 1))) : 0,
      createdAt: Number(p.createdAt) || Date.now(), demo: !!p.demo,
    };
  });
}

async function restore(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (_) { toast('Das ist keine gültige Sicherung.'); return; }
  if (!data || data.app !== 'weinkeller' || !Array.isArray(data.wines)) { toast('Das ist keine Weinkeller-Sicherung.'); return; }
  const clean = {
    wines: data.wines.filter(w => w && w.id).map(cleanWine),
    events: (Array.isArray(data.events) ? data.events : []).filter(e => e && e.id && e.wineId).map(e => ({
      id: String(e.id), wineId: String(e.wineId), type: 'open', date: Number(e.date) || Date.now(),
      rating: Math.max(0, Math.min(5, Math.round(Number(e.rating) || 0))), note: String(e.note ?? '').slice(0, 4000), inWindow: !!e.inWindow,
      count: Math.max(1, Math.min(99, Math.round(Number(e.count) || 1))),
    })),
    meta: (Array.isArray(data.meta) ? data.meta : []).filter(m => m && (m.key === 'game' || m.key === 'places'))
      .map(m => (m.key === 'places' ? { key: 'places', value: cleanPlaces(m.value) } : m)),
  };
  const apply = async () => {
    try {
      await db.importAll(clean);
      await loadAll();
      render();
      toast(`${plural(clean.wines.length, 'Wein', 'Weine')} geladen`);
      celebrate('small');
    } catch (_) { toast('Laden hat nicht geklappt.'); }
  };
  if (state.wines.length) {
    confirmSheet({ emoji: '📦', title: 'Sicherung laden?', text: `Die Sicherung mit ${plural(clean.wines.length, 'Wein', 'Weinen')} ersetzt deinen aktuellen Keller.`, ok: 'Laden', onOk: apply });
  } else {
    apply();
  }
}

// Sample places: index 0 fridge (6 x 6), 1 cellar rack (5 x 8), 2 box without slots.
const DEMO_PLACES = [
  ['Weinkühlschrank', 'kuehlschrank', 6, 6],
  ['Kellerregal', 'keller', 5, 8],
  ['Kiste im Abstellraum', 'kiste', 0, 0],
];
// producer, name, grape, vintage, type, sweetness, region, country, from, to, bottles, place index, first slot (row-col), price
const DEMO = [
  ['Weingut Sonnleiten', 'Ried Kellerberg', 'Grüner Veltliner', 2022, 'weiss', 'trocken', 'Wachau', 'Österreich', 2024, 2030, 3, 0, '1-1', 24],
  ['Weingut Hofstätter', '', 'Blaufränkisch', 2019, 'rot', 'trocken', 'Mittelburgenland', 'Österreich', 2023, 2031, 2, 1, '1-1', 32],
  ['Domaine des Trois Chênes', 'Chablis Premier Cru', 'Chardonnay', 2020, 'weiss', 'trocken', 'Burgund', 'Frankreich', 2022, 2027, 1, 0, '1-4', 38],
  ['Tenuta Colle Alto', 'Chianti Classico Riserva', 'Sangiovese', 2018, 'rot', 'trocken', 'Toskana', 'Italien', 2022, 2030, 2, 1, '1-3', 29],
  ['Sektkellerei Morgentau', 'Brut Reserve', 'Chardonnay, Pinot Noir', null, 'schaum', 'brut', 'Niederösterreich', 'Österreich', null, null, 4, 0, '2-1', 19],
  ['Bodega Las Piedras', 'Gran Reserva', 'Malbec', 2023, 'rot', 'trocken', 'Mendoza', 'Argentinien', 2027, 2035, 6, 2, '', 21],
  ['Weingut Kranzl', '', 'Zweigelt', 2017, 'rot', 'trocken', 'Carnuntum', 'Österreich', 2019, 2024, 1, 1, '2-1', 14],
];

async function loadDemo() {
  const now = Date.now();
  const places = DEMO_PLACES.map(([name, kind, rows, cols], i) => ({ id: uid(), name, kind, rows, cols, createdAt: now + i, demo: true }));
  const wines = DEMO.map(([producer, name, grape, vintage, color, sweetness, region, country, drinkFrom, drinkTo, qty, pi, first, price], i) => {
    const place = places[pi];
    let slots = [];
    if (first && hasGrid(place)) {
      const [r, c] = first.split('-').map(Number);
      slots = Array.from({ length: qty }, (_, k) => `${r}-${c + k}`).filter(k => validSlot(place, k));
    }
    return {
      id: uid(), createdAt: now - i * 60000, updatedAt: now, producer, name, grape, vintage, color, sweetness, region, country,
      drinkFrom, drinkTo, qty, location: '', price, notes: '', photo: '', scanned: false, aiModel: '', demo: true,
      placeId: place.id, slots,
    };
  });
  state.places.push(...places);
  state.wines.push(...wines);
  try { await db.putMany('wines', wines); await savePlaces(); } catch (_) { /* ignore */ }
  state.tab = 'keller';
  render();
  celebrate('small');
  toast('7 Beispielweine und 3 Lager geladen. Sie zählen nicht für Erfolge.', { ms: 5200 });
}

async function removeDemo() {
  const ids = state.wines.filter(w => w.demo).map(w => w.id);
  const evIds = state.events.filter(e => ids.includes(e.wineId)).map(e => e.id);
  const demoPlaces = state.places.filter(p => p.demo).map(p => p.id);
  state.wines = state.wines.filter(w => !w.demo);
  state.events = state.events.filter(e => !ids.includes(e.wineId));
  state.places = state.places.filter(p => !p.demo);
  const moved = state.wines.filter(w => demoPlaces.includes(w.placeId));
  moved.forEach(w => { w.placeId = ''; w.slots = []; });
  if (demoPlaces.includes(settings().lastPlace)) saveSettings({ lastPlace: '' });
  try { await db.delMany('wines', ids); await db.delMany('events', evIds); await db.putMany('wines', moved); await savePlaces(); } catch (_) { /* ignore */ }
  render();
  toast('Beispielweine und Beispiel-Lager entfernt');
}

async function wipe() {
  try { await db.clearAll(); } catch (_) { /* ignore */ }
  state.wines = [];
  state.events = [];
  state.places = [];
  state.game = { xp: 0, unlocked: {}, scans: 0, sommelier: 0 };
  state.somm = null;
  saveSettings({ lastPlace: '' });
  render();
  toast('Keller geleert. Neuer Anfang!');
}

/* ---------- events ---------- */
// Clicks for views, places, slots, sweetness and the bottle count. Returns true when handled.
function onStorageClick(t) {
  const ds = t.dataset;
  if (ds.view) {
    if (!VIEWS.includes(ds.view) || ds.view === state.view) return true;
    state.view = ds.view;
    try { localStorage.setItem('wk.view', state.view); } catch (_) { /* ignore */ }
    $$('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
    buzz(6);
    if (document.startViewTransition && effectsOn()) {
      const vt = document.startViewTransition(renderList);
      [vt.ready, vt.finished, vt.updateCallbackDone].forEach(p => p?.catch(() => {}));
    } else renderList();
    return true;
  }
  if (ds.sweet && state.draft) {
    const d = state.draft.data;
    d.sweetness = d.sweetness === ds.sweet ? '' : ds.sweet;
    state.draft.touched.add('sweetness');
    $$('[data-sweet]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.sweet === d.sweetness)));
    buzz(6);
    return true;
  }
  if (ds.dcount && state.drink) {
    const w = byId(state.drink.id);
    state.drink.count = Math.max(1, Math.min(w ? w.qty : 1, (state.drink.count || 1) + Number(ds.dcount)));
    const out = $('#drink-n');
    if (out) out.textContent = state.drink.count;
    buzz(6);
    return true;
  }
  if (ds.place && state.draft) {
    // Form: tap a place; racks get free slots straight away, tap again to remove the place.
    const d = state.draft.data;
    const p = placeById(ds.place);
    if (!p || d.placeId === p.id) { d.placeId = ''; d.slots = []; }
    else { d.placeId = p.id; d.slots = autoSlots(p, state.draft.id, [], Math.max(1, toInt(d.qty) || 1)); }
    $$('[data-place]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.place === d.placeId)));
    refreshFormSlots();
    buzz(6);
    return true;
  }
  if (ds.pplace && state.placing) {
    const w = byId(state.placing);
    const p = placeById(ds.pplace);
    if (!w) return true;
    if (!p || w.placeId === p.id) { w.placeId = ''; w.slots = []; }
    else { w.placeId = p.id; w.slots = autoSlots(p, w.id, [], w.qty); }
    buzz(6);
    updatePlacedWine(w);
    return true;
  }
  if (ds.slottoggle) {
    const inForm = !!t.closest('[data-sheet="form"]');
    const target = inForm ? state.draft?.data : byId(state.placing);
    if (!target) return true;
    const slots = [...(target.slots || [])];
    const i = slots.indexOf(ds.slottoggle);
    if (i >= 0) slots.splice(i, 1); else slots.push(ds.slottoggle);
    target.slots = slots;
    // Placing more bottles than counted means there are more bottles.
    const qty = toInt(target.qty) || 0;
    if (slots.length > qty) {
      target.qty = slots.length;
      if (inForm) { const out = $('#s-qty'); if (out) out.textContent = target.qty; }
    }
    buzz(6);
    if (inForm) refreshFormSlots(); else updatePlacedWine(target);
    return true;
  }
  if (ds.slotfree) {
    const [placeId, key] = ds.slotfree.split('|');
    openSlotSheet(placeId, key);
    return true;
  }
  if (ds.slotwine) { putWineInSlot(ds.slotwine); return true; }
  if (ds.foodgo) {
    state.sommFood = ds.foodgo;
    goTab('sommelier', () => askSomm());
    return true;
  }
  if (ds.moveto) {
    // One tap moves all bottles of the wine; racks get the next free slots.
    const w = byId(ds.id);
    const p = placeById(ds.moveto);
    if (!w || !p) return true;
    w.placeId = p.id;
    w.slots = autoSlots(p, w.id, [], w.qty);
    buzz(12);
    updatePlacedWine(w);
    toast(`Liegt jetzt: ${p.name}${w.slots.length ? ` · ${w.slots.map(slotLabel).join(', ')}` : ''}`);
    return true;
  }
  if (ds.editplace) { openPlaceEditor(ds.editplace); return true; }
  if (ds.newplace) { openPlaceEditor(null, ds.newplace); return true; }
  if (ds.kind && state.placeDraft) {
    const d = state.placeDraft;
    const k = PLACE_KINDS[ds.kind];
    if (!k) return true;
    d.kind = ds.kind;
    // New places take the template size until the size was changed by hand.
    if (k.rows && (!d.sizeTouched || !d.rows || !d.cols) && d.isNew) { d.rows = k.rows; d.cols = k.cols; }
    else if (k.rows && (!d.rows || !d.cols)) { d.rows = k.rows; d.cols = k.cols; }
    if (!d.nameTouched) d.name = k.label;
    openSheet('place-edit', placeEditorHtml());
    buzz(6);
    return true;
  }
  if (ds.pstep && state.placeDraft) {
    const d = state.placeDraft;
    const max = ds.pstep === 'rows' ? 20 : 12;
    d[ds.pstep] = Math.max(1, Math.min(max, (d[ds.pstep] || 1) + Number(t.dataset.d)));
    d.sizeTouched = true;
    const out = $(`#ps-${ds.pstep}`);
    if (out) out.textContent = d[ds.pstep];
    const pv = $('#pl-preview');
    if (pv) pv.innerHTML = rackHtml(d, { mode: 'preview', size: 'rack-compact' });
    buzz(4);
    return true;
  }
  const a = ds.action;
  if (!a) return false;
  if (a === 'new-place') {
    const from = t.closest('[data-sheet="form"]') ? 'form' : t.closest('[data-sheet="place"]') ? 'place' : '';
    openPlaceEditor(null, 'kuehlschrank', from);
    return true;
  }
  if (a === 'place-save') { savePlace(); return true; }
  if (a === 'place-delete') { deletePlace(); return true; }
  if (a === 'open-placement') { openPlacement(ds.id); return true; }
  if (a === 'toggle-rack' && state.draft) { state.draft.rackOpen = !state.draft.rackOpen; refreshFormSlots(); return true; }
  if (a === 'auto-slots' || a === 'clear-slots') {
    const inForm = !!t.closest('[data-sheet="form"]');
    const target = inForm ? state.draft?.data : byId(state.placing);
    const p = target && placeById(target.placeId);
    if (!target || !p) return true;
    target.slots = a === 'auto-slots' ? autoSlots(p, inForm ? state.draft.id : target.id, [], Math.max(1, toInt(target.qty) || 1)) : [];
    buzz(6);
    if (inForm) refreshFormSlots(); else updatePlacedWine(target);
    return true;
  }
  if (a === 'slot-scan' && state.slotTarget) {
    state.pendingSlot = { ...state.slotTarget, t: Date.now() };
    closeSheet('slot');
    openCamera('new');
    return true;
  }
  return false;
}

function onClick(e) {
  const t = e.target.closest('[data-action],[data-tab],[data-open],[data-filter],[data-color],[data-step],[data-star],[data-food],[data-loc],[data-search],[data-view],[data-place],[data-pplace],[data-slottoggle],[data-slotfree],[data-slotwine],[data-editplace],[data-newplace],[data-kind],[data-pstep],[data-sweet],[data-dcount],[data-foodgo],[data-moveto]');
  if (!t) return;
  if (t.dataset.tab) { goTab(t.dataset.tab); return; }
  if (t.dataset.open) { openDetail(t.dataset.open); return; }
  if (onStorageClick(t)) return;
  if (t.dataset.search) {
    // Tapping a grape or region in the detail view shows all wines that match it.
    state.query = t.dataset.search;
    state.filter = 'alle';
    goTab('keller', () => { const q = $('#q'); if (q) q.value = state.query; renderList(); });
    return;
  }
  if (t.dataset.loc != null && state.draft) {
    const input = $('#f-location');
    state.draft.data.location = t.dataset.loc;
    state.draft.touched.add('location');
    if (input) input.value = t.dataset.loc;
    $$('[data-loc]').forEach(b => b.setAttribute('aria-pressed', String(b === t)));
    buzz(6);
    return;
  }
  if (t.dataset.filter) {
    state.filter = t.dataset.filter;
    $$('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === t)));
    renderList();
    return;
  }
  if (t.dataset.color && state.draft) {
    const d = state.draft.data;
    const c = d.color === t.dataset.color ? '' : t.dataset.color;
    d.color = c;
    state.draft.touched.add('color');
    $$('[data-color]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.color === c)));
    if (d.sweetness && !sweetOptions(c).includes(d.sweetness)) d.sweetness = '';
    const sf = $('#sweet-field');
    if (sf) sf.innerHTML = sweetHtml(d);
    refreshFormSlots();
    buzz(6);
    return;
  }
  if (t.dataset.step && state.draft) {
    const key = t.closest('[data-stepper]')?.dataset.stepper;
    if (!key) return;
    const min = state.draft.isNew ? 1 : 0;
    const v = Math.max(min, Math.min(999, (toInt(state.draft.data[key]) ?? 1) + Number(t.dataset.step)));
    state.draft.data[key] = v;
    const out = $(`#s-${key}`);
    if (out) out.textContent = v;
    if (key === 'qty') {
      // More bottles get the next free slots, fewer bottles give slots back.
      const d = state.draft.data;
      const p = placeById(d.placeId);
      if (hasGrid(p)) d.slots = v > (d.slots || []).length ? autoSlots(p, state.draft.id, d.slots, v) : (d.slots || []).slice(0, v);
      refreshFormSlots();
    }
    buzz(6);
    dupCheck();
    return;
  }
  if (t.dataset.star && state.drink) {
    const n = Number(t.dataset.star);
    state.drink.rating = state.drink.rating === n ? 0 : n;
    $$('[data-star]').forEach(b => b.classList.toggle('on', Number(b.dataset.star) <= state.drink.rating));
    buzz(8);
    return;
  }
  if (t.dataset.food) {
    const input = $('#food');
    if (input) input.value = t.dataset.food;
    askSomm();
    return;
  }
  const id = t.dataset.id;
  switch (t.dataset.action) {
    case 'scan': openCamera('new'); break;
    case 'gallery': pickTarget = 'new'; startScan('gallery'); break;
    case 'manual': openForm(); break;
    case 'form-camera': openCamera('form'); break;
    case 'form-gallery': pickTarget = 'form'; startScan('gallery'); break;
    case 'cam-shoot': shoot(); break;
    case 'cam-gallery': startScan('gallery'); break;
    case 'cam-native': startScan('camera'); break;
    case 'cam-manual': {
      const intoForm = pickTarget === 'form';
      closeSheet('camera');
      if (!intoForm) setTimeout(() => openForm(), 180);
      break;
    }
    case 'close-sheet': closeSheet(t.closest('.sheet-wrap')?.dataset.sheet); break;
    case 'save-wine': saveWine(); break;
    case 'merge': mergeInto(id); break;
    case 'retry-ai': if (state.draft?.aiImage) runAi(state.draft.aiImage); break;
    case 'goto-ai': goTab('mehr'); setTimeout(() => $('#api-key')?.focus(), 350); break;
    case 'edit': openForm(byId(id)); break;
    case 'delete': askDelete(id); break;
    case 'qty': changeQty(id, Number(t.dataset.d)); break;
    case 'open-bottle': openBottle(id); break;
    case 'drink-confirm': confirmDrink(!!t.dataset.skip); break;
    case 'confirm-ok': { const fn = state.confirmFn; state.confirmFn = null; closeSheet('confirm'); fn?.(); break; }
    case 'ask-somm': askSomm(); break;
    case 'save-key': saveKey(); break;
    case 'remove-key': saveSettings({ apiKey: '', keyOk: null }); state.keyStatus = null; render(); toast('Schlüssel entfernt'); break;
    case 'toggle-key': { const k = $('#api-key'); if (k) k.type = k.type === 'password' ? 'text' : 'password'; break; }
    case 'toggle-view': {
      state.view = state.view === 'grid' ? 'list' : 'grid';
      try { localStorage.setItem('wk.view', state.view); } catch (_) { /* ignore */ }
      t.innerHTML = icon(state.view === 'grid' ? 'list' : 'grid');
      t.setAttribute('aria-label', state.view === 'grid' ? 'Als Liste zeigen' : 'Als Regal zeigen');
      buzz(6);
      if (document.startViewTransition && effectsOn()) {
        const vt = document.startViewTransition(renderList);
        [vt.ready, vt.finished, vt.updateCallbackDone].forEach(p => p?.catch(() => {}));
      } else renderList();
      break;
    }
    case 'backup': backup(); break;
    case 'restore': $('#file-backup').value = ''; $('#file-backup').click(); break;
    case 'demo': loadDemo(); break;
    case 'remove-demo': removeDemo(); break;
    case 'wipe': confirmSheet({ emoji: '🧨', title: 'Alles löschen?', text: 'Alle Weine, Notizen und Erfolge auf diesem Gerät werden gelöscht. Das lässt sich nicht rückgängig machen.', ok: 'Alles löschen', danger: true, onOk: wipe }); break;
    case 'install':
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.finally(() => { deferredPrompt = null; render(); });
      }
      break;
    default: break;
  }
}

function bind() {
  document.addEventListener('click', onClick);
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'q') { state.query = t.value; renderList(); return; }
    if (t.id === 'pl-name' && state.placeDraft) { state.placeDraft.name = t.value; state.placeDraft.nameTouched = true; return; }
    const key = t.dataset?.field;
    if (key && state.draft) {
      state.draft.touched.add(key);
      state.draft.data[key] = t.value;
      t.closest('.field')?.classList.remove('unsure', 'shake');
      if (['producer', 'name', 'grape', 'vintage'].includes(key)) dupCheck();
    }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'sort') { state.sort = t.value; renderList(); }
    if (t.id === 'effects') { saveSettings({ effects: t.checked }); if (t.checked) celebrate('small'); }
    if (t.id === 'model') saveSettings({ model: t.value });
    if (t.id === 'more-types') {
      saveSettings({ moreTypes: t.checked });
      if (!t.checked && COLORS[state.filter]?.extra) state.filter = 'alle';
      toast(t.checked ? 'Mehr Arten und Geschmacksrichtung sind an' : 'Nur noch die Grund-Arten');
    }
  });
  document.addEventListener('submit', e => {
    if (e.target.id !== 'somm-bar') return;
    e.preventDefault();
    const input = $('#quick-food');
    const food = (input?.value || '').trim();
    if (!food) { input?.focus(); return; }
    input.blur();
    state.sommFood = food;
    goTab('sommelier', () => askSomm());
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sheets.length) { closeSheet(); return; }
    if (e.key === 'Enter' && e.target.id === 'food') { e.preventDefault(); askSomm(); }
    if (e.key === 'Enter' && e.target.id === 'q') e.target.blur();
  });
  $('#file-camera').addEventListener('change', e => onPhotoPicked(e.target.files?.[0]));
  $('#file-gallery').addEventListener('change', e => onPhotoPicked(e.target.files?.[0]));
  $('#file-backup').addEventListener('change', e => { const f = e.target.files?.[0]; if (f) restore(f); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && sheetEl('camera')) closeSheet('camera');
  });
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (state.tab === 'mehr') render();
  });
}

/* ---------- start ---------- */
async function loadAll() {
  const [wines, events, game, places] = await Promise.all([db.getAll('wines'), db.getAll('events'), db.getMeta('game', null), db.getMeta('places', [])]);
  state.wines = wines.sort(SORTERS.neu);
  state.events = events;
  state.game = { xp: 0, unlocked: {}, scans: 0, sommelier: 0, ...(game || {}) };
  state.places = cleanPlaces(places);
}

async function boot() {
  renderTabbar();
  bind();
  try { await loadAll(); } catch (_) {
    toast('Der Speicher ist hier nicht verfügbar (privater Modus?). Einträge gehen beim Schließen verloren.', { ms: 7000 });
  }
  if (history.state?.wk) { try { history.replaceState(null, ''); } catch (_) { /* ignore */ } }
  render();
  if ('serviceWorker' in navigator && window.isSecureContext && !isMock()) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  try { navigator.storage?.persist?.(); } catch (_) { /* ignore */ }
  if (isMock() || /[?&]dev\b/.test(location.search)) window.weinkeller = { state, onPhotoPicked, openForm, openDetail };
}

boot();
