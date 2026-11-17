// AI layer: reads labels and plays sommelier through OpenRouter's free models.
// Swapping the provider later means changing only this file.

import { norm, thisYear, sleep } from './util.js';
import { COLORS, STATUS, status, normCountry, cleanTaste, baseType, normSweet, cleanPairing, pairingOf } from './wine.js';

const API = 'https://openrouter.ai/api/v1';
// Free models with image input (checked 17 Nov 2026). OpenRouter tries them in this order.
export const AUTO_MODELS = ['google/gemma-4-31b-it:free', 'nvidia/nemotron-3.5-super-vl:free', 'google/gemma-4-26b-a4b-it:free'];
const FREE_ROUTER = 'openrouter/free';
const SETTINGS_KEY = 'wk.settings';
const MODELS_KEY = 'wk.models';
const MOCK = /[?&]mock\b/.test(location.search);
const DEFAULTS = { apiKey: '', model: 'auto', effects: true };

export function settings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (_) { return { ...DEFAULTS }; }
}
export function saveSettings(patch) {
  const next = { ...settings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (_) { /* storage blocked */ }
  return next;
}

export const isMock = () => MOCK;
export const aiReady = () => MOCK || !!settings().apiKey;
export const modelLabel = id => String(id || '').split('/').pop().replace(/:free$/, '').replace(/-/g, ' ');

export class AiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function modelList() {
  const chosen = settings().model;
  if (!chosen || chosen === 'auto') return AUTO_MODELS;
  return [chosen, ...AUTO_MODELS.filter(m => m !== chosen)].slice(0, 3);
}

function httpError(code, message) {
  if (code === 401) return new AiError('auth', 'Der Schlüssel stimmt nicht. Prüf ihn unter „Mehr“.');
  if (code === 402) return new AiError('credits', 'Dieses Modell kostet Guthaben. Wähle unter „Mehr“ ein Gratis-Modell.');
  if (code === 429) return new AiError('limit', 'Gratis-Limit erreicht (50 Anfragen pro Tag). Morgen geht es weiter.');
  if (code === 408) return new AiError('timeout', 'Die KI hat zu lange gebraucht. Versuch es nochmal.');
  if (code >= 500) return new AiError('server', 'Die Gratis-KI ist gerade überlastet. Versuch es gleich nochmal.');
  const detail = message ? ` (${String(message).slice(0, 120)})` : '';
  return new AiError('bad', `Die KI konnte das gerade nicht lesen${detail}.`);
}

async function post(key, body, timeout = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Weinkeller' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw e.name === 'AbortError'
      ? new AiError('timeout', 'Die KI hat zu lange gebraucht. Versuch es nochmal.')
      : new AiError('network', 'Keine Verbindung zur KI. Bist du online?');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch (_) { /* not JSON */ }
  if (!res.ok || data?.error) throw httpError(res.ok ? Number(data?.error?.code) || 0 : res.status, data?.error?.message);
  let content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) content = content.map(p => p?.text || '').join('');
  if (!content || !String(content).trim()) throw new AiError('empty', 'Die KI hat nichts zurückgegeben. Versuch es nochmal.');
  return { content: String(content), model: data.model || body.model };
}

async function chat(messages, maxTokens) {
  const key = settings().apiKey;
  if (!key) throw new AiError('nokey', 'Noch keine KI eingerichtet.');
  const base = { messages, temperature: 0.1, max_tokens: maxTokens, response_format: { type: 'json_object' } };
  const list = modelList();
  try {
    return await post(key, { ...base, model: list[0], models: list });
  } catch (e) {
    // Second chance: OpenRouter's free router picks any free model that can handle the request.
    if (!['server', 'bad', 'empty'].includes(e.code)) throw e;
    return post(key, { ...base, model: FREE_ROUTER });
  }
}

function parseJson(text) {
  const t = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(t.slice(a, b + 1)); } catch (_) { /* fall through */ }
  }
  throw new AiError('parse', 'Die Antwort der KI war unlesbar. Versuch es nochmal.');
}

const str = v => {
  if (v == null) return '';
  const s = (Array.isArray(v) ? v.join(', ') : String(v)).trim();
  return /^(null|none|n\/?a|unknown|unbekannt|keine?|-+|—|\?)$/i.test(s) ? '' : s;
};
const year = (v, lo, hi) => {
  const m = String(v ?? '').match(/\d{4}/);
  const n = m ? Number(m[0]) : NaN;
  return n >= lo && n <= hi ? n : null;
};

export function colorOf(value) {
  const s = norm(value);
  if (!s) return '';
  if (/schaum|sekt|spark|champ|cremant|prosecco|cava|frizz|spumante|perl/.test(s)) return 'schaum';
  if (/suss|suess|sweet|dessert|likor|eiswein|ausbruch|trockenbeer|beerenaus/.test(s)) return 'suess';
  if (/\brot|red|rouge|rosso|tinto/.test(s)) return 'rot';
  if (/ros/.test(s)) return 'rose';
  if (/weis|white|blanc|bianco|blanco|branco/.test(s)) return 'weiss';
  return '';
}

// With "Mehr Arten" on, the finer types are kept; otherwise they fall back to the basic ones.
function typeOf(value, more) {
  const s = norm(value);
  let t = '';
  if (/orange|maischevergoren|skin contact|amber/.test(s)) t = 'orange';
  else if (/perl|frizzante|secco|pet nat|petillant|vino frizzante/.test(s)) t = 'perl';
  else if (/likor|liqueur|port|sherry|madeira|marsala|fortified/.test(s)) t = 'likoer';
  if (t) return more ? t : baseType(t);
  return colorOf(value);
}

const FIELD_NAMES = { winzer: 'producer', wein: 'name', rebsorte: 'grape', jahrgang: 'vintage', region: 'region', land: 'country', farbe: 'color', trinken_ab: 'drinkFrom', trinken_bis: 'drinkTo', suesse_stufe: 'sweetness' };

function normalizeLabel(raw, model) {
  if (!raw || raw.kein_etikett === true) throw new AiError('nolabel', 'Auf dem Foto ist kein Weinetikett zu erkennen.');
  const more = !!settings().moreTypes;
  const vintage = year(raw.jahrgang, 1900, thisYear() + 1);
  let from = year(raw.trinken_ab, 1900, 2100);
  let to = year(raw.trinken_bis, 1900, 2100);
  if (from && to && from > to) [from, to] = [to, from];
  if (vintage && from && from < vintage) from = vintage;
  if (from && to && to - from > 60) to = from + 60;
  const fields = {
    producer: str(raw.winzer), name: str(raw.wein), grape: str(raw.rebsorte), vintage,
    region: str(raw.region), country: normCountry(str(raw.land)), color: typeOf(str(raw.farbe), more),
    drinkFrom: from, drinkTo: to,
    taste: cleanTaste(raw.geschmack && {
      body: raw.geschmack.koerper, tannin: raw.geschmack.tannin, sweet: raw.geschmack.suesse, acid: raw.geschmack.saeure,
    }),
    pairing: cleanPairing(raw.passt_zu),
  };
  if (more) fields.sweetness = normSweet(str(raw.suesse_stufe), fields.color);
  if (fields.name && norm(fields.name) === norm(fields.producer)) fields.name = '';
  if (!fields.producer && !fields.name && !fields.grape) {
    throw new AiError('nolabel', 'Die KI konnte auf dem Foto nichts lesen. Probier ein schärferes Foto.');
  }
  const unsure = (Array.isArray(raw.unsicher) ? raw.unsicher : [])
    .map(k => FIELD_NAMES[String(k).toLowerCase().trim()]).filter(Boolean);
  return { fields, unsure, model };
}

const labelPrompt = more => `You read wine labels for a wine cellar app. Look at the photo and reply with ONLY one JSON object and no other text, in this shape:
{"winzer": "...", "wein": "...", "rebsorte": "...", "jahrgang": 2021, "region": "...", "land": "...", "farbe": "...",${more ? ' "suesse_stufe": "...",' : ''} "trinken_ab": 2023, "trinken_bis": 2030, "geschmack": {"koerper": 3, "tannin": 2, "suesse": 1, "saeure": 4}, "passt_zu": ["...", "...", "..."], "unsicher": ["..."]}

Rules:
- winzer: the winery or producer, as printed on the label.
- wein: the wine, vineyard (Ried, Lage) or cuvée name without producer and grape; null if there is none.
- rebsorte: the grape variety or varieties, e.g. "Grüner Veltliner" or "Cabernet Sauvignon, Merlot". If it is not printed, infer it only when the appellation makes it unambiguous (Chablis = Chardonnay, Barolo = Nebbiolo); otherwise null.
- jahrgang: the vintage as a 4-digit number; null if no vintage is visible. Never guess the vintage.
- region: the wine region or appellation; null if unknown.
- land: the country in German, e.g. "Österreich", "Italien", "Frankreich".
- farbe: exactly one of ${more ? '"rot", "weiss", "rose", "orange" (orange or skin-contact wine), "schaum" (sparkling: Sekt, Champagne, Crémant, Cava), "perl" (semi-sparkling: Perlwein, Frizzante, Secco, Pét-Nat), "suess" (sweet dessert wine), "likoer" (fortified: Port, Sherry, Madeira)' : '"rot", "weiss", "rose", "schaum", "suess"'}.${more ? `
- suesse_stufe: the sweetness as printed or typical for this wine. Still wines: "trocken", "halbtrocken", "lieblich" or "süß". Sparkling: "brut nature", "extra brut", "brut", "extra trocken", "trocken", "halbtrocken" or "mild". null if unknown.` : ''}
- trinken_ab and trinken_bis: your best estimate of the drinking window, as years.
- geschmack: your estimate of the taste of exactly this wine (style, quality level such as Federspiel or Smaragd, vintage) from 1 (low) to 5 (high): koerper = body, tannin (null for white, rosé and sparkling wines), suesse = sweetness, saeure = acidity.
- passt_zu: three short German dish names that fit exactly this wine, e.g. "Wiener Schnitzel", "Forelle", "Spargel".
- unsicher: the names of the fields you are unsure about.
If the photo shows no wine label, reply {"kein_etikett": true}.`;

export async function readLabel(imageDataUrl) {
  if (MOCK) {
    await sleep(1600);
    return normalizeLabel({
      winzer: 'Weingut Musterhof', wein: 'Ried Sonnberg', rebsorte: 'Grüner Veltliner', jahrgang: 2021,
      region: 'Kamptal', land: 'Österreich', farbe: 'weiss', trinken_ab: 2023, trinken_bis: 2029, unsicher: ['trinken_bis'],
      geschmack: { koerper: 3, tannin: null, suesse: 1, saeure: 4 }, suesse_stufe: 'trocken',
      passt_zu: ['Wiener Schnitzel', 'Spargel', 'Forelle'],
    }, 'demo/demo-modell');
  }
  const { content, model } = await chat([{
    role: 'user',
    content: [{ type: 'text', text: labelPrompt(!!settings().moreTypes) }, { type: 'image_url', image_url: { url: imageDataUrl } }],
  }], 750);
  return normalizeLabel(parseJson(content), model);
}

export async function askSommelier(food, wines) {
  const list = wines.slice(0, 150);
  if (MOCK) {
    await sleep(1200);
    return { picks: list.slice(0, 2).map(w => ({ id: w.id, grund: 'Im Demo-Modus passt jeder Wein. Mit echter KI gibt es echte Gründe.' })), tipp: 'Leicht gekühlt servieren.' };
  }
  const refs = list.map((w, i) => ({ ref: `W${i + 1}`, w }));
  const lines = refs.map(({ ref, w }) => [ref, w.producer || '-', w.name || '-', w.grape || '-', w.vintage || '-', COLORS[w.color]?.label || '-', STATUS[status(w)].label, pairingOf(w).dishes.join(', ') || '-'].join(' | ')).join('\n');
  const prompt = `You are a warm, witty sommelier in a home wine cellar app. Answer in German and use the informal "du".
The user is eating: "${String(food).slice(0, 200)}".
Pick up to 3 wines from the user's cellar below that fit best. Prefer wines with the status "Bald trinken" or "Drüber" when they fit. Avoid "Lagern" unless nothing else fits.
Reply with ONLY one JSON object: {"picks": [{"id": "W1", "grund": "one short sentence why it fits"}], "tipp": "one short serving tip"}
Cellar (id | producer | wine | grape | vintage | type | status | fits with):
${lines}`;
  const { content } = await chat([{ role: 'user', content: prompt }], 500);
  const r = parseJson(content);
  const byRef = new Map(refs.map(x => [x.ref, x.w]));
  const picks = (Array.isArray(r.picks) ? r.picks : [])
    .map(p => ({ w: byRef.get(String(p?.id || '').trim().toUpperCase()), grund: str(p?.grund) }))
    .filter(p => p.w)
    .slice(0, 3)
    .map(p => ({ id: p.w.id, grund: p.grund }));
  return { picks, tipp: str(r.tipp) };
}

export async function testKey(key) {
  let res;
  try {
    res = await fetch(`${API}/key`, { headers: { Authorization: `Bearer ${key}` } });
  } catch (_) {
    throw new AiError('network', 'Keine Verbindung. Bist du online?');
  }
  if (res.status === 401 || res.status === 403) throw new AiError('auth', 'Der Schlüssel stimmt nicht.');
  if (!res.ok) throw new AiError('server', 'OpenRouter antwortet gerade nicht. Versuch es später.');
  const data = await res.json().catch(() => ({}));
  return data?.data || {};
}

export async function freeVisionModels() {
  try {
    const cached = JSON.parse(localStorage.getItem(MODELS_KEY) || 'null');
    if (cached && Date.now() - cached.t < 12 * 3600 * 1000) return cached.list;
  } catch (_) { /* ignore */ }
  const res = await fetch(`${API}/models`);
  const data = await res.json();
  const list = (data?.data || [])
    .filter(m => String(m.id).endsWith(':free') && (m.architecture?.input_modalities || []).includes('image'))
    .map(m => ({ id: m.id, name: String(m.name || m.id).replace(/\s*\(free\)\s*$/i, '') }));
  try { localStorage.setItem(MODELS_KEY, JSON.stringify({ t: Date.now(), list })); } catch (_) { /* ignore */ }
  return list;
}
