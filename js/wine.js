// Wine knowledge: types, drinking-window status, grapes, countries, food pairing, links.

import { norm, thisYear, yearFrac } from './util.js';

export const COLORS = {
  rot: { label: 'Rot', dot: '#8e1b3a' },
  weiss: { label: 'Weiß', dot: '#e3cf6e' },
  rose: { label: 'Rosé', dot: '#f0a3b6' },
  schaum: { label: 'Schaumwein', dot: '#efe0a1' },
  suess: { label: 'Süßwein', dot: '#d9962b' },
};

export const STATUS = {
  lagern: { label: 'Lagern' },
  jetzt: { label: 'Jetzt trinken' },
  bald: { label: 'Bald trinken' },
  drueber: { label: 'Drüber' },
  offen: { label: 'Ohne Fenster' },
};

// Complete drinking window, or null when nothing is known.
export function windowOf(w) {
  let from = w.drinkFrom || null;
  let to = w.drinkTo || null;
  if (!from && !to) return null;
  if (!from) from = w.vintage ? Math.min(w.vintage + 1, to) : to - 3;
  if (!to) to = from + 4;
  if (from > to) [from, to] = [to, from];
  const soon = Math.max(1, Math.round((to - from) * 0.25));
  return { from, to, soon };
}

// Traffic light: lagern -> jetzt -> bald (last quarter of the window) -> drüber.
export function status(w, year = thisYear()) {
  const win = windowOf(w);
  if (!win) return 'offen';
  if (year > win.to) return 'drueber';
  if (year < win.from) return 'lagern';
  if (year >= win.to - win.soon) return 'bald';
  return 'jetzt';
}

export function windowBar(w) {
  const win = windowOf(w);
  if (!win) return '';
  const now = yearFrac();
  const start = Math.min(w.vintage || win.from - 2, win.from - 1, Math.floor(now) - 1);
  const end = Math.max(win.to + 3, Math.ceil(now) + 1);
  const total = end - start;
  const pct = v => ((v - start) / total) * 100;
  const segs = [
    ['lagern', start, win.from],
    ['jetzt', win.from, win.to - win.soon],
    ['bald', win.to - win.soon, win.to + 1],
    ['drueber', win.to + 1, end],
  ].filter(([, a, b]) => b > a);
  const today = Math.min(99.5, Math.max(0.5, pct(now)));
  return `<div class="tw-chart" role="img" aria-label="Trinkfenster ${win.from} bis ${win.to}, heute ${STATUS[status(w)].label}">
    <div class="tw-bar">${segs.map(([k, a, b]) => `<span class="seg-${k}" style="width:${(((b - a) / total) * 100).toFixed(3)}%"></span>`).join('')}</div>
    <div class="tw-today" style="left:${today.toFixed(2)}%"><span>Heute</span></div>
    <div class="tw-ticks" aria-hidden="true"><span style="left:${pct(win.from).toFixed(2)}%">ab ${win.from}</span><span style="left:${pct(win.to + 1).toFixed(2)}%">bis ${win.to}</span></div>
  </div>`;
}

// ---------- grapes ----------
export const GRAPES = [
  { name: 'Grüner Veltliner', type: 'white', alias: ['gruner veltliner', 'gruener veltliner', 'veltliner'] },
  { name: 'Riesling', type: 'white', alias: ['riesling', 'rheinriesling', 'weisser riesling'] },
  { name: 'Welschriesling', type: 'white', alias: ['welschriesling', 'riesling italico', 'olaszrizling', 'grasevina'] },
  { name: 'Gelber Muskateller', type: 'white', alias: ['gelber muskateller', 'muskateller', 'muscat', 'moscato', 'muskat'] },
  { name: 'Weißburgunder', type: 'white', alias: ['weissburgunder', 'weisser burgunder', 'pinot blanc', 'pinot bianco'] },
  { name: 'Chardonnay', type: 'white', alias: ['chardonnay', 'morillon'] },
  { name: 'Sauvignon Blanc', type: 'white', alias: ['sauvignon blanc', 'sauvignon', 'fume blanc'] },
  { name: 'Gewürztraminer', type: 'white', alias: ['gewurztraminer', 'gewuerztraminer', 'traminer'] },
  { name: 'Grauburgunder', type: 'white', alias: ['grauburgunder', 'pinot grigio', 'pinot gris', 'rulander'] },
  { name: 'Chenin Blanc', type: 'white', alias: ['chenin blanc', 'chenin'] },
  { name: 'Blaufränkisch', type: 'red', alias: ['blaufrankisch', 'blaufraenkisch', 'lemberger', 'kekfrankos', 'frankovka'] },
  { name: 'Zweigelt', type: 'red', alias: ['zweigelt', 'blauer zweigelt', 'rotburger'] },
  { name: 'St. Laurent', type: 'red', alias: ['st laurent', 'sankt laurent', 'saint laurent'] },
  { name: 'Pinot Noir', type: 'red', alias: ['pinot noir', 'blauburgunder', 'blauer burgunder', 'spatburgunder', 'spaetburgunder', 'pinot nero'] },
  { name: 'Merlot', type: 'red', alias: ['merlot'] },
  { name: 'Cabernet Sauvignon', type: 'red', alias: ['cabernet sauvignon', 'cabernet'] },
  { name: 'Cabernet Franc', type: 'red', alias: ['cabernet franc'] },
  { name: 'Syrah', type: 'red', alias: ['syrah', 'shiraz'] },
  { name: 'Grenache', type: 'red', alias: ['grenache', 'garnacha', 'cannonau'] },
  { name: 'Tempranillo', type: 'red', alias: ['tempranillo', 'tinta roriz', 'aragonez', 'tinto fino'] },
  { name: 'Sangiovese', type: 'red', alias: ['sangiovese', 'brunello', 'prugnolo'] },
  { name: 'Nebbiolo', type: 'red', alias: ['nebbiolo', 'spanna', 'chiavennasca'] },
  { name: 'Malbec', type: 'red', alias: ['malbec'] },
  { name: 'Primitivo', type: 'red', alias: ['primitivo', 'zinfandel'] },
];

// Longest alias first, so "cabernet franc" wins over "cabernet".
const ALIASES = GRAPES.flatMap(g => g.alias.map(a => [a, g.name])).sort((a, b) => b[0].length - a[0].length);

export function canonGrape(part) {
  const n = ` ${norm(part)} `;
  for (const [alias, name] of ALIASES) if (n.includes(` ${alias} `)) return name;
  const clean = String(part).replace(/\d+\s*%/g, '').replace(/\s+/g, ' ').trim();
  return clean ? clean.replace(/(^|[\s-])\p{Ll}/gu, s => s.toUpperCase()) : '';
}

export function grapesOf(w) {
  const raw = String(w.grape || '').trim();
  if (!raw) return [];
  const parts = raw.split(/\s*(?:,|\/|&|\+|;|\bund\b|\band\b)\s*/i).map(s => s.trim()).filter(Boolean);
  return [...new Set(parts.map(canonGrape).filter(Boolean))];
}

// ---------- taste profile ----------
// Typical style per grape, 1 (low) to 5 (high): body, tannin (null for whites), sweetness, acidity.
const GRAPE_TASTE = {
  'Grüner Veltliner': [3, null, 1, 4], 'Riesling': [2, null, 2, 5], 'Welschriesling': [2, null, 1, 4],
  'Gelber Muskateller': [2, null, 1, 4], 'Weißburgunder': [3, null, 1, 3], 'Chardonnay': [4, null, 1, 3],
  'Sauvignon Blanc': [2, null, 1, 5], 'Gewürztraminer': [4, null, 2, 2], 'Grauburgunder': [3, null, 1, 3],
  'Chenin Blanc': [3, null, 2, 4], 'Blaufränkisch': [4, 3, 1, 4], 'Zweigelt': [3, 2, 1, 3],
  'St. Laurent': [3, 2, 1, 3], 'Pinot Noir': [2, 2, 1, 4], 'Merlot': [4, 3, 1, 3],
  'Cabernet Sauvignon': [5, 5, 1, 3], 'Cabernet Franc': [3, 3, 1, 4], 'Syrah': [5, 4, 1, 3],
  'Grenache': [4, 2, 1, 2], 'Tempranillo': [4, 4, 1, 3], 'Sangiovese': [3, 4, 1, 5],
  'Nebbiolo': [4, 5, 1, 5], 'Malbec': [5, 4, 1, 3], 'Primitivo': [5, 3, 2, 2],
};
const COLOR_TASTE = { rot: [3, 3, 1, 3], weiss: [2, null, 1, 4], rose: [2, null, 1, 3], schaum: [2, null, 1, 4], suess: [3, null, 5, 3] };
const COLOR_NAMES = { rot: 'Rotwein', weiss: 'Weißwein', rose: 'Rosé', schaum: 'Schaumwein', suess: 'Süßwein' };

const clamp5 = v => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
};

export function cleanTaste(t) {
  if (!t || typeof t !== 'object') return null;
  const out = { body: clamp5(t.body), tannin: clamp5(t.tannin), sweet: clamp5(t.sweet), acid: clamp5(t.acid) };
  return out.body || out.sweet || out.acid ? out : null;
}

// Stored AI estimate first; otherwise the typical profile of the grape(s) or the wine type.
export function tasteOf(w) {
  const own = cleanTaste(w.taste);
  if (own) return { values: own, source: 'ai' };
  const known = grapesOf(w).filter(g => GRAPE_TASTE[g]);
  let base = null;
  let label = '';
  if (known.length) {
    base = [0, 1, 2, 3].map(i => {
      const vals = known.map(g => GRAPE_TASTE[g][i]).filter(v => v != null);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    });
    label = known.length === 1 ? known[0] : known.slice(0, 2).join(' und ');
  } else if (COLOR_TASTE[w.color]) {
    base = COLOR_TASTE[w.color].slice();
    label = COLOR_NAMES[w.color];
  }
  if (!base) return null;
  if (w.color && w.color !== 'rot') base[1] = null;
  if (w.color === 'suess') base[2] = 5;
  if (w.color === 'rose') base[0] = Math.min(base[0] ?? 2, 2);
  if (w.color === 'schaum') { base[0] = Math.min(base[0] ?? 2, 3); base[3] = Math.max(base[3] ?? 4, 4); }
  const [body, tannin, sweet, acid] = base;
  return { values: { body, tannin, sweet, acid }, source: 'typical', label };
}

// ---------- countries ----------
export const FLAGS = {
  'Österreich': '🇦🇹', 'Deutschland': '🇩🇪', 'Italien': '🇮🇹', 'Frankreich': '🇫🇷', 'Spanien': '🇪🇸',
  'Portugal': '🇵🇹', 'Schweiz': '🇨🇭', 'Ungarn': '🇭🇺', 'Slowenien': '🇸🇮', 'Kroatien': '🇭🇷',
  'Griechenland': '🇬🇷', 'USA': '🇺🇸', 'Argentinien': '🇦🇷', 'Chile': '🇨🇱', 'Südafrika': '🇿🇦',
  'Australien': '🇦🇺', 'Neuseeland': '🇳🇿', 'Georgien': '🇬🇪', 'Tschechien': '🇨🇿', 'Slowakei': '🇸🇰',
  'Kanada': '🇨🇦', 'Libanon': '🇱🇧', 'Israel': '🇮🇱', 'Rumänien': '🇷🇴', 'Bulgarien': '🇧🇬',
  'Moldau': '🇲🇩', 'Uruguay': '🇺🇾', 'Brasilien': '🇧🇷', 'China': '🇨🇳', 'England': '🇬🇧',
  'Luxemburg': '🇱🇺', 'Serbien': '🇷🇸', 'Türkei': '🇹🇷', 'Mexiko': '🇲🇽', 'Japan': '🇯🇵',
};

const COUNTRY_ALIASES = {
  'osterreich': 'Österreich', 'oesterreich': 'Österreich', 'austria': 'Österreich', 'autriche': 'Österreich', 'at': 'Österreich',
  'deutschland': 'Deutschland', 'germany': 'Deutschland', 'allemagne': 'Deutschland',
  'italien': 'Italien', 'italy': 'Italien', 'italia': 'Italien',
  'frankreich': 'Frankreich', 'france': 'Frankreich',
  'spanien': 'Spanien', 'spain': 'Spanien', 'espana': 'Spanien',
  'portugal': 'Portugal', 'schweiz': 'Schweiz', 'switzerland': 'Schweiz', 'suisse': 'Schweiz',
  'ungarn': 'Ungarn', 'hungary': 'Ungarn', 'slowenien': 'Slowenien', 'slovenia': 'Slowenien',
  'kroatien': 'Kroatien', 'croatia': 'Kroatien', 'griechenland': 'Griechenland', 'greece': 'Griechenland',
  'usa': 'USA', 'us': 'USA', 'united states': 'USA', 'vereinigte staaten': 'USA', 'kalifornien': 'USA', 'california': 'USA',
  'argentinien': 'Argentinien', 'argentina': 'Argentinien', 'chile': 'Chile',
  'sudafrika': 'Südafrika', 'suedafrika': 'Südafrika', 'south africa': 'Südafrika',
  'australien': 'Australien', 'australia': 'Australien', 'neuseeland': 'Neuseeland', 'new zealand': 'Neuseeland',
  'georgien': 'Georgien', 'georgia': 'Georgien', 'tschechien': 'Tschechien', 'czechia': 'Tschechien', 'czech republic': 'Tschechien',
  'slowakei': 'Slowakei', 'slovakia': 'Slowakei', 'kanada': 'Kanada', 'canada': 'Kanada',
  'libanon': 'Libanon', 'lebanon': 'Libanon', 'israel': 'Israel', 'rumanien': 'Rumänien', 'romania': 'Rumänien',
  'bulgarien': 'Bulgarien', 'bulgaria': 'Bulgarien', 'moldau': 'Moldau', 'moldawien': 'Moldau', 'moldova': 'Moldau',
  'uruguay': 'Uruguay', 'brasilien': 'Brasilien', 'brazil': 'Brasilien', 'china': 'China',
  'england': 'England', 'united kingdom': 'England', 'uk': 'England', 'grossbritannien': 'England',
  'luxemburg': 'Luxemburg', 'luxembourg': 'Luxemburg', 'serbien': 'Serbien', 'serbia': 'Serbien',
  'turkei': 'Türkei', 'turkey': 'Türkei', 'mexiko': 'Mexiko', 'mexico': 'Mexiko', 'japan': 'Japan',
};

export function normCountry(value) {
  const s = String(value ?? '').trim();
  return COUNTRY_ALIASES[norm(s)] || s;
}

const AT_REGIONS = ['wachau', 'kamptal', 'kremstal', 'wagram', 'traisental', 'weinviertel', 'thermenregion', 'carnuntum',
  'burgenland', 'leithaberg', 'neusiedlersee', 'mittelburgenland', 'eisenberg', 'rosalia', 'steiermark', 'vulkanland',
  'niederosterreich', 'wien'];

export const isAustrian = w => normCountry(w.country) === 'Österreich' || AT_REGIONS.some(r => norm(w.region).includes(r));

export const isSparkling = w => w.color === 'schaum' ||
  /\b(sekt|champagne|champagner|cremant|prosecco|cava|franciacorta|pet nat|frizzante|spumante)\b/.test(norm(`${w.name} ${w.producer} ${w.grape}`));

// Same wine = same producer, same name (or grape) and same vintage.
export const matchKey = w => `${norm(w.producer)}|${norm(w.name || w.grape)}|${w.vintage || ''}`;

export const flagOf = w => FLAGS[normCountry(w.country)] || '';

// ---------- drawn bottles (used when there is no label photo) ----------
// Shapes in a 40 x 100 box: [path, neck rect, body rect, label rect].
const SHAPES = {
  bordeaux: ['M16 2h8v5h-.6v19c0 4.5 9.6 7.6 9.6 16.5V93a5 5 0 0 1-5 5H12a5 5 0 0 1-5-5V42.5C7 33.6 16.6 30.5 16.6 26V7H16z', [16, 2, 8, 9], [7, 43, 26, 55], [11, 54, 18, 24]],
  flute: ['M17 2h6v5h-.5v17c0 9 7.5 15 7.5 24v45a5 5 0 0 1-5 5h-10a5 5 0 0 1-5-5V48c0-9 7.5-15 7.5-24V7H17z', [17, 2, 6, 9], [10, 48, 20, 50], [12, 58, 16, 22]],
  burgundy: ['M16.4 2h7.2v5h-.5v13c0 7 10 11 10 22v51a5 5 0 0 1-5 5H11.9a5 5 0 0 1-5-5V42c0-11 10-15 10-22V7h-.5z', [16.4, 2, 7.2, 9], [7, 42, 26, 56], [11, 56, 18, 22]],
  champagne: ['M15.5 2h9v8c0 7 11 12 11 25v58a5 5 0 0 1-5 5H9.5a5 5 0 0 1-5-5V35c0-13 11-18 11-25z', [15.5, 2, 9, 14], [4.5, 35, 31, 63], [9, 54, 22, 20]],
  half: ['M17.2 22h5.6v4h-.4v11c0 5 6.6 8 6.6 14v42a5 5 0 0 1-5 5h-8a5 5 0 0 1-5-5V51c0-6 6.6-9 6.6-14V26h-.4z', [17.2, 22, 5.6, 8], [11, 51, 18, 47], [13, 62, 14, 18]],
};
const BOTTLE_LOOK = {
  rot: { shape: 'bordeaux', glass: '#2a1218', cap: '#8c2445', label: '#f4ead7', ink: '#5a1428' },
  weiss: { shape: 'flute', glass: '#8fa36a', cap: '#e9dfb6', label: '#fbf6e9', ink: '#4f5a2c' },
  rose: { shape: 'burgundy', glass: '#ee9db3', cap: '#f8dbe3', label: '#fffaf6', ink: '#a23256' },
  schaum: { shape: 'champagne', glass: '#22301f', cap: '#d6b25e', label: '#f6efd9', ink: '#22301f' },
  suess: { shape: 'half', glass: '#c98a24', cap: '#7a4a12', label: '#fbf2df', ink: '#7a4a12' },
  none: { shape: 'bordeaux', glass: '#4a3d44', cap: '#8b7f86', label: '#efe8ea', ink: '#4a3d44' },
};

export function bottleSvg(w, height = 70) {
  const look = BOTTLE_LOOK[w.color] || BOTTLE_LOOK.none;
  const [d, neck, body, label] = SHAPES[look.shape];
  const [lx, ly, lw, lh] = label;
  const year = w.vintage ? String(w.vintage) : '';
  const mark = year
    ? `<text x="20" y="${ly + lh / 2 + 2.6}" text-anchor="middle" font-size="7.2" font-weight="700" fill="${look.ink}" font-family="-apple-system,system-ui,sans-serif">${year}</text>`
    : `<rect x="${lx + 4}" y="${ly + lh / 2 - 0.6}" width="${lw - 8}" height="1.2" rx=".6" fill="${look.ink}" opacity=".5"/>`;
  return `<svg class="bottle" viewBox="0 0 40 100" width="${Math.round(height * 0.4)}" height="${height}" aria-hidden="true">
    <path d="${d}" fill="${look.glass}"/>
    <rect x="${neck[0]}" y="${neck[1]}" width="${neck[2]}" height="${neck[3]}" rx="1.2" fill="${look.cap}"/>
    <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="1.6" fill="${look.label}"/>
    ${mark}
    <rect x="${body[0] + 2.4}" y="${body[1] + 4}" width="2.2" height="${body[3] - 16}" rx="1.1" fill="#fff" opacity=".16"/>
  </svg>`;
}

export const tileClass = w => `tile tile-${COLORS[w.color] ? w.color : 'none'}`;

// ---------- links to comparison platforms ----------
const searchTerms = w => [w.producer, w.name || w.grape].filter(Boolean).join(' ').trim();

export const vivinoUrl = w => `https://www.vivino.com/search/wines?q=${encodeURIComponent(searchTerms(w))}`;

export function wineSearcherUrl(w) {
  const q = searchTerms(w).split(/\s+/).filter(Boolean).map(encodeURIComponent).join('+');
  return `https://www.wine-searcher.com/find/${q}${w.vintage ? `/${w.vintage}` : ''}`;
}

// ---------- food pairing without AI ----------
const PAIRING = [
  { keys: ['schnitzel', 'backhendl', 'wiener'], colors: ['weiss'], grapes: ['Grüner Veltliner', 'Weißburgunder', 'Gelber Muskateller', 'Welschriesling'] },
  { keys: ['fisch', 'lachs', 'forelle', 'saibling', 'zander', 'sushi', 'meeresfr', 'garnele', 'scampi', 'muschel', 'auster'], colors: ['weiss', 'schaum'], grapes: ['Grüner Veltliner', 'Riesling', 'Sauvignon Blanc', 'Chardonnay', 'Weißburgunder'] },
  { keys: ['huhn', 'hendl', 'geflugel', 'pute', 'ente', 'gans'], colors: ['weiss', 'rose', 'rot'], grapes: ['Pinot Noir', 'St. Laurent', 'Chardonnay', 'Grauburgunder', 'Zweigelt'] },
  { keys: ['steak', 'rind', 'beef', 'burger', 'grill', 'bbq', 'lamm', 'wild', 'reh', 'hirsch', 'braten', 'gulasch'], colors: ['rot'], grapes: ['Blaufränkisch', 'Cabernet Sauvignon', 'Syrah', 'Merlot', 'Malbec', 'Zweigelt', 'Tempranillo'] },
  { keys: ['pasta', 'pizza', 'lasagne', 'spaghetti', 'tomate', 'risotto', 'italien'], colors: ['rot', 'rose'], grapes: ['Sangiovese', 'Zweigelt', 'Primitivo', 'Nebbiolo', 'Grenache'] },
  { keys: ['kase', 'cheese', 'kaese'], colors: ['rot', 'suess', 'weiss'], grapes: ['Blaufränkisch', 'Pinot Noir', 'Riesling', 'Gewürztraminer'] },
  { keys: ['dessert', 'kuchen', 'torte', 'schoko', 'strudel', 'kaiserschmarrn', 'nachspeise'], colors: ['suess', 'schaum'], grapes: ['Gelber Muskateller', 'Gewürztraminer', 'Riesling'] },
  { keys: ['asia', 'curry', 'thai', 'scharf', 'indisch', 'chines', 'japan'], colors: ['weiss', 'rose'], grapes: ['Riesling', 'Gewürztraminer', 'Grüner Veltliner', 'Gelber Muskateller'] },
  { keys: ['salat', 'gemuse', 'vegetar', 'vegan', 'spargel', 'kurbis'], colors: ['weiss', 'rose'], grapes: ['Sauvignon Blanc', 'Grüner Veltliner', 'Weißburgunder', 'Grauburgunder'] },
  { keys: ['jause', 'schwein', 'wurst', 'speck', 'brettl'], colors: ['weiss', 'rot'], grapes: ['Grüner Veltliner', 'Zweigelt', 'St. Laurent', 'Blaufränkisch'] },
  { keys: ['anstoss', 'aperitif', 'apero', 'feier', 'party', 'geburtstag', 'silvester'], colors: ['schaum', 'rose'], grapes: [] },
];

const STATUS_SCORE = { bald: 3, drueber: 2, jetzt: 2, offen: 1, lagern: -3 };

export function rankForFood(wines, food) {
  const f = norm(food);
  const rules = PAIRING.filter(r => r.keys.some(k => f.includes(k)));
  const ranked = wines.map(w => {
    let score = STATUS_SCORE[status(w)];
    let fits = false;
    for (const r of rules) {
      if (w.color && r.colors.includes(w.color)) { score += 3; fits = true; }
      if (grapesOf(w).some(g => r.grapes.includes(g))) { score += 3; fits = true; }
    }
    return { w, score, fits };
  }).sort((a, b) => b.score - a.score);
  return ranked.slice(0, 3);
}

export function pairingReason(p, food) {
  const st = status(p.w);
  const bits = [];
  if (p.fits) bits.push(`passt gut zu ${food}`);
  if (st === 'bald') bits.push('sollte bald getrunken werden');
  else if (st === 'drueber') bits.push('ist schon über dem Fenster, also jetzt oder nie');
  else if (st === 'jetzt') bits.push('ist gerade schön trinkreif');
  else if (st === 'lagern') bits.push('ist eigentlich noch jung');
  const s = bits.join(' und ') || 'liegt bereit';
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}
