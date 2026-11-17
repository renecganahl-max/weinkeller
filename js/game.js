// Game layer: XP, levels, achievements and confetti.
// Rewards go to collecting, cataloguing, tasting notes and good timing, never to drinking more.

import { grapesOf, normCountry, isAustrian, isSparkling } from './wine.js';

export const XP = { addWine: 20, scan: 10, location: 5, window: 5, note: 15, rating: 5, timing: 25, sommelier: 5, achievement: 50, restock: 5 };

export const LEVELS = [
  [0, 'Traubenneuling'], [60, 'Kellerkind'], [150, 'Weinfreund'], [300, 'Kellermeister'], [500, 'Genießer'],
  [800, 'Kenner'], [1200, 'Sommelier'], [1700, 'Weinpoet'], [2400, 'Master of Wine'], [3300, 'Legende'],
];

export function levelInfo(xp) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++;
  const [min, name] = LEVELS[i];
  const next = LEVELS[i + 1] ? LEVELS[i + 1][0] : null;
  return { level: i + 1, name, min, next, progress: next ? (xp - min) / (next - min) : 1 };
}

// Demo wines never count, so trying the app does not unlock anything.
export function computeStats(allWines, events, game) {
  const wines = allWines.filter(w => !w.demo);
  const demoIds = new Set(allWines.filter(w => w.demo).map(w => w.id));
  const evs = events.filter(e => !demoIds.has(e.wineId));
  const stock = wines.filter(w => w.qty > 0);
  const year = new Date().getFullYear();

  const grapes = new Map();
  for (const w of wines) for (const g of grapesOf(w)) grapes.set(g, (grapes.get(g) || 0) + 1);
  const countries = new Map();
  for (const w of wines) {
    const c = normCountry(w.country);
    if (c) countries.set(c, (countries.get(c) || 0) + 1);
  }
  const vintages = wines.map(w => w.vintage).filter(Boolean);
  const oldest = vintages.length ? Math.min(...vintages) : null;
  const newest = vintages.length ? Math.max(...vintages) : null;
  let favorite = null;
  for (const [g, n] of grapes) if (!favorite || n > favorite[1]) favorite = [g, n];

  return {
    wineCount: wines.length,
    stockWines: stock.length,
    bottles: stock.reduce((a, w) => a + w.qty, 0),
    grapes, grapeCount: grapes.size,
    countries, countryCount: countries.size,
    austrian: wines.filter(isAustrian).length,
    sparkling: wines.filter(isSparkling).length,
    oldWines: wines.filter(w => w.vintage && year - w.vintage >= 15).length,
    oldest,
    span: oldest ? newest - oldest : 0,
    notes: evs.filter(e => e.note).length,
    timing: evs.filter(e => e.inWindow).length,
    opened: evs.reduce((a, e) => a + (e.count || 1), 0),
    scans: game.scans || 0,
    located: wines.filter(w => w.location || w.placeId).length,
    sommelier: game.sommelier || 0,
    value: stock.reduce((a, w) => a + (w.price || 0) * w.qty, 0),
    favorite: favorite ? favorite[0] : null,
  };
}

export const ACHIEVEMENTS = [
  { id: 'first', emoji: '🍾', title: 'Erster Schatz', desc: 'Ersten Wein eintragen', goal: 1, val: s => s.wineCount },
  { id: 'scan10', emoji: '📸', title: 'Scanner-Profi', desc: '10 Etiketten scannen', goal: 10, val: s => s.scans },
  { id: 'cellar10', emoji: '🗄️', title: 'Kleiner Keller', desc: '10 Flaschen im Keller', goal: 10, val: s => s.bottles },
  { id: 'cellar50', emoji: '🏰', title: 'Gut bestückt', desc: '50 Flaschen im Keller', goal: 50, val: s => s.bottles },
  { id: 'grapes5', emoji: '🍇', title: 'Rebsorten-Sammler', desc: '5 Rebsorten sammeln', goal: 5, val: s => s.grapeCount },
  { id: 'grapes15', emoji: '🏅', title: 'Rebsorten-Profi', desc: '15 Rebsorten sammeln', goal: 15, val: s => s.grapeCount },
  { id: 'austria5', emoji: '🏔️', title: 'Heimatliebe', desc: '5 Weine aus Österreich', goal: 5, val: s => s.austrian },
  { id: 'countries5', emoji: '🌍', title: 'Weltenbummler', desc: 'Weine aus 5 Ländern', goal: 5, val: s => s.countryCount },
  { id: 'bubbles', emoji: '🥂', title: 'Prickelnd', desc: 'Einen Schaumwein eintragen', goal: 1, val: s => s.sparkling },
  { id: 'old15', emoji: '🕰️', title: 'Alter Schatz', desc: 'Ein Wein mit 15+ Jahren', goal: 1, val: s => s.oldWines },
  { id: 'span10', emoji: '⏳', title: 'Zeitreise', desc: 'Jahrgänge über 10 Jahre', goal: 10, val: s => s.span },
  { id: 'located10', emoji: '📍', title: 'Ordnung muss sein', desc: '10 Weine mit Lagerort', goal: 10, val: s => s.located },
  { id: 'notes5', emoji: '✍️', title: 'Feine Zunge', desc: '5 Verkostungsnotizen', goal: 5, val: s => s.notes },
  { id: 'timing', emoji: '🎯', title: 'Perfektes Timing', desc: 'Im Trinkfenster geöffnet', goal: 1, val: s => s.timing },
  { id: 'somm', emoji: '🤵', title: 'Gut beraten', desc: 'Den Sommelier fragen', goal: 1, val: s => s.sommelier },
];

export const newlyUnlocked = (stats, unlocked) => ACHIEVEMENTS.filter(a => !unlocked[a.id] && a.val(stats) >= a.goal);

// ---------- confetti ----------
const PALETTE = ['#7a1d3b', '#b2345c', '#e8a0b4', '#f3cf7a', '#c8962e', '#2c6a4d', '#f6e5eb'];
let canvas = null;
let ctx = null;
let parts = [];
let raf = 0;
let W = 0;
let H = 0;

function setup() {
  canvas = canvas || document.getElementById('confetti');
  if (!canvas) return false;
  ctx = ctx || canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  const cw = Math.round(W * dpr);
  const ch = Math.round(H * dpr);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return true;
}

export function confetti({ x = 0.5, y = 0.6, angle = -90, spread = 60, count = 120, power = 1 } = {}) {
  if (!setup()) return;
  for (let i = 0; i < count; i++) {
    const a = ((angle + (Math.random() - 0.5) * spread * 2) * Math.PI) / 180;
    const v = (7 + Math.random() * 9) * power;
    parts.push({
      x: x * W, y: y * H, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      g: 0.22 + Math.random() * 0.12, rot: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.35,
      w: 6 + Math.random() * 6, h: 9 + Math.random() * 9, c: PALETTE[(Math.random() * PALETTE.length) | 0],
      round: Math.random() < 0.3, t: 0, life: 150 + Math.random() * 70, tilt: Math.random() * 6.3,
    });
  }
  if (!raf) raf = requestAnimationFrame(tick);
}

function tick() {
  ctx.clearRect(0, 0, W, H);
  parts = parts.filter(p => p.t < p.life && p.y < H + 60);
  for (const p of parts) {
    p.t++;
    p.vx *= 0.985;
    p.vy = p.vy * 0.985 + p.g;
    p.x += p.vx + Math.sin(p.t / 9) * 0.6;
    p.y += p.vy;
    p.rot += p.vr;
    p.tilt += 0.12;
    ctx.save();
    ctx.globalAlpha = p.t > p.life - 35 ? Math.max(0, (p.life - p.t) / 35) : 1;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.c;
    if (p.round) {
      ctx.beginPath();
      ctx.arc(0, 0, p.w / 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.scale(1, Math.cos(p.tilt));
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
    ctx.restore();
  }
  if (parts.length) raf = requestAnimationFrame(tick);
  else { raf = 0; ctx.clearRect(0, 0, W, H); }
}
