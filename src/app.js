/* AnounisGaming — appli d'actu jeux vidéo (usage perso).
   Le robot du dépôt prépare le fil (branche « data ») ; l'appli le lit, l'affiche et le lit à voix haute. */
"use strict";

const REPO = "galllinho/anounisgaming";
const DATA_BRANCH = "data";
const CAP = window.Capacitor;
const NATIVE = !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform());
const Plug = (CAP && CAP.Plugins) || {};
const PAGE = 40;

/* ---------- état et stockage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem("ag." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ag." + k, JSON.stringify(v)); } catch { try { localStorage.removeItem("ag." + k); } catch {} } }
};
const S = {
  tab: "fil",
  filter: store.get("filter", "tout"),
  query: "",
  shown: PAGE,
  feed: store.get("feed", null),
  loading: false,
  error: null,
  status: null,
  read: new Set(store.get("read", [])),
  hidden: new Set(store.get("hiddenSources", [])),
  settings: Object.assign({ token: "", itad: "", rate: 1, voice: "humaine", skin: "neon" }, store.get("settings", {})),
  today: store.get("today", { d: "", n: 0 }),
  reddit: store.get("reddit", null),
  redditErr: null,
  price: { q: "", results: null, game: null, rows: null, loading: false, error: null, low: null }
};
const saveSettings = () => store.set("settings", S.settings);
const saveRead = () => store.set("read", [...S.read].slice(-1500));
const dayKey = () => new Date().toISOString().slice(0, 10);
function markRead(id) {
  if (S.read.has(id)) return;
  S.read.add(id); saveRead();
  if (S.today.d !== dayKey()) S.today = { d: dayKey(), n: 0 };
  S.today.n++; store.set("today", S.today);
}

/* ---------- skins ---------- */
const SKINS = [
  { id: "neon", name: "Néon arcade", colors: ["#07070F", "#22E4FF", "#FF2BD6", "#FFE14D"], theme: "#07070F" },
  { id: "console", name: "Console", colors: ["#0D1530", "#5B8CFF", "#FFFFFF", "#F5B43C"], theme: "#070B16" },
  { id: "hud", name: "HUD de jeu", colors: ["#0A0D10", "#FF8A1F", "#B6FF3B", "#FFD23F"], theme: "#0A0D10" },
  { id: "classique", name: "Classique", colors: ["#0B0D12", "#FF4655", "#4C8DFF", "#F5A524"], theme: "#0B0D12" }
];
const skin = () => S.settings.skin;
function applySkin() {
  const sk = SKINS.find(k => k.id === skin()) || SKINS[0];
  S.settings.skin = sk.id;
  document.body.dataset.skin = sk.id;
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", sk.theme);
}
function nextSkin() {
  const i = SKINS.findIndex(k => k.id === skin());
  S.settings.skin = SKINS[(i + 1) % SKINS.length].id; saveSettings(); applySkin();
  toast("Skin : " + SKINS.find(k => k.id === skin()).name);
  if (Plug.Haptics) Plug.Haptics.impact({ style: "LIGHT" }).catch(() => {});
  render();
}

/* ---------- utilitaires ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICON = {
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 4.5v15l10-7.5zM17 4h3v16h-3z"/></svg>',
  headphones: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h10M7 13h10M7 17h6"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1.1.2-2.2 1.4-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M16 7l3 3M18 5l2 2"/></svg>'
};
const LANG = { en: "EN", ja: "JP", fr: "FR", auto: "" };

function ago(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "hier" : `il y a ${d} j`;
}
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function openUrl(url) {
  if (!url) return;
  if (Plug.Browser) Plug.Browser.open({ url, toolbarColor: "#0B0D12" }).catch(() => window.open(url, "_blank"));
  else window.open(url, "_blank", "noopener");
}

/* ---------- données (branche data du dépôt privé) ---------- */
async function gh(path, as = "json") {
  if (!S.settings.token) throw new Error("token");
  const url = `https://api.github.com/repos/${REPO}/contents/${path}?ref=${DATA_BRANCH}&t=${Date.now()}`;
  const headers = { Authorization: `Bearer ${S.settings.token.trim()}`, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" };
  let status, data;
  if (NATIVE && Plug.CapacitorHttp) {
    // couche réseau native d'Android : pas de blocage CORS
    const r = await Plug.CapacitorHttp.request({ method: "GET", url, headers, responseType: as === "blob" ? "blob" : "text", connectTimeout: 20000, readTimeout: 60000 });
    status = r.status; data = r.data;
    if (status >= 200 && status < 300) {
      if (as === "blob") return "data:audio/mpeg;base64," + data;
      return typeof data === "string" ? JSON.parse(data) : data;
    }
  } else {
    const r = await fetch(url, { headers, cache: "no-store" });
    status = r.status;
    if (r.ok) return as === "blob" ? URL.createObjectURL(await r.blob()) : r.json();
  }
  if (status === 401) throw new Error("Le code d'accès GitHub est refusé. Vérifie-le dans Réglages.");
  if (status === 403) throw new Error("GitHub refuse l'accès (403) : le code doit avoir « Contents : Read-only » sur AnounisGaming.");
  if (status === 404) throw new Error("Fil introuvable (404) : vérifie que le code donne accès au dépôt AnounisGaming.");
  throw new Error(`GitHub répond ${status}`);
}

async function loadFeed(manual) {
  if (!S.settings.token) { render(); return; }
  S.loading = true; S.error = null; render();
  try {
    const feed = await gh("feed.json");
    S.feed = { updated: feed.updated, items: feed.items };
    store.set("feed", S.feed);
    gh("status.json").then(s => { S.status = s; if (S.tab === "reglages") render(); }).catch(() => {});
    if (manual) toast("Fil à jour");
    loadReddit(manual);
  } catch (e) {
    S.error = e.message === "token" ? null : (e.message || String(e));
  }
  S.loading = false; render();
}

/* ---------- Reddit, lu directement depuis le téléphone ---------- */
const REDDIT = "https://www.reddit.com/r/Games+PS5+pcgaming+GamingLeaksAndRumours/top.json?t=day&limit=40&raw_json=1";
const RUMOR_WORDS = ["leak", "leaked", "rumor", "rumour", "insider", "reportedly", "allegedly", "datamine", "rumeur", "fuite"];
const PS5_RE = /\b(ps5|playstation|state of play|ps plus|psvr2)\b/i, PC_RE = /\b(pc|steam|epic games store|gog|steam deck)\b/i;
function tagItem(it) {
  const t = `${it.title_orig} ${it.summary_orig || ""}`;
  it.platforms = [PS5_RE.test(t) && "PS5", PC_RE.test(t) && "PC"].filter(Boolean);
  it.rumor = it.source === "r/GamingLeaksAndRumours" || RUMOR_WORDS.some(w => t.toLowerCase().includes(w));
  return it;
}
async function translateOnPhone(texts) {
  const out = [...texts];
  let i = 0;
  while (i < texts.length) {
    let j = i, size = 0;
    while (j < texts.length && (j === i || size + texts[j].length < 1400)) { size += texts[j].length + 1; j++; }
    const chunk = texts.slice(i, j).map(t => t.replace(/\n/g, " "));
    try {
      const d = await http("GET", "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=fr&dt=t&q=" + encodeURIComponent(chunk.join("\n")));
      const res = d[0].map(seg => seg[0] || "").join("").split("\n");
      if (res.length === chunk.length) res.forEach((r, k) => { out[i + k] = r.trim() || chunk[k]; });
    } catch {}
    i = j;
  }
  return out;
}
async function loadReddit(force) {
  if (!force && S.reddit && Date.now() / 1000 - S.reddit.at < 1200) return;
  try {
    const d = await http("GET", REDDIT);
    const prev = new Map(((S.reddit && S.reddit.items) || []).map(it => [it.id, it]));
    const items = [];
    for (const c of (d.data && d.data.children) || []) {
      const p = c.data;
      if (!p || p.stickied || p.over_18) continue;
      const id = "rd" + p.id;
      if (prev.has(id)) { const o = prev.get(id); o.score = p.score; items.push(o); continue; }
      const img = p.preview && p.preview.images && p.preview.images[0] && p.preview.images[0].source && p.preview.images[0].source.url;
      const yt = (p.url || "").match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
      const body = (p.selftext || "").replace(/\s+/g, " ").trim();
      items.push(tagItem({
        id, url: "https://www.reddit.com" + p.permalink, source: "r/" + p.subreddit, kind: "reddit", lang: "en",
        published: p.created_utc, title_orig: p.title, summary_orig: body.length > 320 ? body.slice(0, 320).replace(/\s\S*$/, "") + "…" : body,
        image: img || (/^https?:/.test(p.thumbnail || "") ? p.thumbnail : null), video: yt ? yt[1] : null, score: p.score, fresh: true
      }));
    }
    const fresh = items.filter(it => it.fresh);
    if (fresh.length) {
      const tr = await translateOnPhone(fresh.flatMap(it => [it.title_orig, it.summary_orig || ""]));
      fresh.forEach((it, k) => { it.title = tr[2 * k]; it.summary = tr[2 * k + 1]; it.translated = it.title !== it.title_orig; delete it.fresh; });
    }
    S.reddit = { at: Math.floor(Date.now() / 1000), items };
    S.redditErr = null;
    store.set("reddit", S.reddit);
  } catch (e) {
    S.redditErr = e.message || "Reddit indisponible";
  }
  render();
}

function allItems() {
  const base = S.feed ? S.feed.items.filter(it => !it.group) : [];
  const rd = (S.reddit && S.reddit.items) || [];
  return base.concat(rd).sort((a, b) => b.published - a.published);
}

function heads() {
  if (!S.feed && !S.reddit) return [];
  let list = allItems().filter(it => !S.hidden.has(it.source));
  const f = S.filter;
  if (f === "ps5") list = list.filter(it => (it.platforms || []).includes("PS5"));
  else if (f === "pc") list = list.filter(it => (it.platforms || []).includes("PC"));
  else if (f === "rumeurs") list = list.filter(it => it.rumor);
  else if (f === "officiel") list = list.filter(it => it.kind === "officiel" || (it.also || []).some(a => a.source.includes("PlayStation Blog") || a.source === "Steam"));
  else if (f === "videos") list = list.filter(it => it.video);
  else if (f === "communaute") list = list.filter(it => it.kind === "reddit");
  const q = S.query.trim().toLowerCase();
  if (q) list = list.filter(it => `${it.title} ${it.title_orig} ${it.summary || ""}`.toLowerCase().includes(q));
  return list;
}

/* ---------- rendu ---------- */
function badges(it) {
  const b = [];
  if (it.rumor) b.push(`<span class="badge b-rumor">${skin() === "hud" ? "Intel non confirmé" : "Rumeur"}</span>`);
  if (it.kind === "officiel") b.push('<span class="badge b-off">Officiel</span>');
  for (const p of it.platforms || []) b.push(`<span class="badge ${p === "PS5" ? "b-ps5" : "b-pc"}">${p}</span>`);
  const n = (it.also || []).length;
  if (n) b.push(`<span class="badge b-more">+${n} source${n > 1 ? "s" : ""}</span>`);
  return b.length ? `<div class="badges">${b.join("")}</div>` : "";
}
function meta(it) {
  const flag = it.translated && LANG[it.lang] ? `<span class="flag" title="Traduit">${LANG[it.lang]}→FR</span>` : "";
  return `<div class="meta"><span>${esc(it.source)}</span><span class="dot"></span><span>${ago(it.published)}</span>${flag}</div>`;
}
const bg = url => url ? `style="background-image:url('${esc(url).replace(/'/g, "%27")}')"` : "";
const playOverlay = it => it.video ? `<div class="play"><span>${ICON.play}</span></div>` : "";
const HERO_TAG = { neon: "À la une", hud: "▶ Mission principale" };
function card(it, hero) {
  const read = (S.read.has(it.id) ? " read" : "") + (it.rumor ? " is-rumor" : "");
  if (hero) return `<button class="card hero${read}" data-open="${it.id}">
      <div class="media" ${bg(it.image)}>${HERO_TAG[skin()] ? `<span class="hero-tag">${HERO_TAG[skin()].toUpperCase()}</span>` : ""}${playOverlay(it)}</div>
      <div class="body">${meta(it)}<h2>${esc(it.title)}</h2>${badges(it)}</div></button>`;
  return `<button class="card${read}" data-open="${it.id}"><div class="item">
      <div class="txt">${meta(it)}<h3>${esc(it.title)}</h3>${badges(it)}</div>
      ${it.image ? `<div class="thumb" ${bg(it.image)}>${playOverlay(it)}</div>` : ""}</div></button>`;
}

const FILTERS = [["tout", "Tout"], ["ps5", "PS5"], ["pc", "PC"], ["rumeurs", "Rumeurs"], ["officiel", "Officiel"], ["videos", "Vidéos"], ["communaute", "Communauté"]];
const filterLabel = (k, l) => skin() === "hud" && k === "rumeurs" ? "Intel" : l;

function consoleHero(it) {
  const tag = ["À la une", ...(it.platforms || [])].join(" · ").toUpperCase();
  const n = (it.also || []).length;
  return `<div class="ambient" ${bg(it.image)}></div>
    <div class="chero"><span class="tag">${esc(tag)}</span><h2>${esc(it.title)}</h2>
    <div class="small muted">${esc(it.source)}${n ? ` et ${n} autre${n > 1 ? "s" : ""} source${n > 1 ? "s" : ""}` : ""} · ${ago(it.published)}</div>
    <div class="btns">${it.video ? `<button class="btn primary" data-open="${it.id}">${ICON.play.replace("<svg", '<svg width="16" height="16" fill="currentColor"')} Voir la vidéo</button>` : `<button class="btn primary" data-listen="${it.id}">${ICON.headphones} Écouter</button>`}
    <button class="btn" data-open="${it.id}">Lire</button></div></div>`;
}
function tile(it) {
  return `<button class="tile${S.read.has(it.id) ? " read" : ""}" data-open="${it.id}"><div class="ph" ${bg(it.image)}>${badges({ ...it, also: [] })}${playOverlay(it)}</div><b>${esc(it.title)}</b></button>`;
}
function playerCard(total) {
  const today = S.today.d === dayKey() ? S.today.n : 0;
  const goal = Math.max(10, Math.min(40, total));
  const lvl = 1 + Math.floor(S.read.size / 25);
  return `<div class="player-card"><div class="hex">AG</div><div class="grow">
    <div class="nm"><span>ANOUNISGAMING</span><span class="lv">NIV. ${lvl}</span></div>
    <div class="xpbar"><i style="width:${Math.min(100, Math.round(100 * today / goal))}%"></i></div>
    <div class="tiny muted">${today} infos lues sur ${goal} aujourd'hui${S.feed ? " · màj " + ago(S.feed.updated) : ""}</div></div></div>`;
}

function viewFil() {
  if (!S.settings.token) return viewSetup();
  const list = heads();
  const sk = skin();
  const brand = sk === "neon" ? '<span class="b1">ANOUNIS</span><span class="b2">GAMING</span>' : "<i></i>AnounisGaming";
  const upd = S.feed ? (sk === "neon" ? `Live · ${list.length} infos · màj ${ago(S.feed.updated)}` : "Mis à jour " + ago(S.feed.updated)) : "Chargement…";
  const top = `<header class="top"><div><div class="brand">${brand}</div>
      ${sk === "hud" ? "" : `<div class="updated">${upd}</div>`}</div>
      <div class="row"><button class="iconbtn" data-act="skin" aria-label="Changer de skin">${ICON.palette}</button>
      <button class="iconbtn" data-act="listen-all" aria-label="Écouter le fil">${ICON.headphones}</button>
      <button class="iconbtn${S.loading ? " spin" : ""}" data-act="refresh" aria-label="Actualiser">${ICON.refresh}</button></div></header>
      ${sk === "hud" ? playerCard(list.length) : ""}`;
  const chips = `<div class="chips" role="toolbar">${FILTERS.map(([k, l]) => `<button class="chip" data-filter="${k}" aria-pressed="${S.filter === k}">${filterLabel(k, l)}</button>`).join("")}</div>`;
  const search = `<input class="search" type="search" placeholder="Chercher un jeu, un studio…" value="${esc(S.query)}" data-input="query" enterkeyhint="search">`;
  let body;
  if (S.error && !S.feed) body = `<div class="empty"><p class="err">${esc(S.error)}</p><button class="btn" data-act="refresh">Réessayer</button></div>`;
  else if (!S.feed && !S.reddit) body = `<div class="skel" style="aspect-ratio:16/12"></div><div class="skel" style="height:96px"></div><div class="skel" style="height:96px"></div>`;
  else if (!list.length) body = `<div class="empty">${ICON.news}<p class="muted">Rien ici pour l'instant avec ce filtre.</p></div>`;
  else if (sk === "console" && !S.query) {
    const rail = list.slice(1, 9), rest = list.slice(9, S.shown);
    const err = S.error && S.feed ? `<p class="small err">${esc(S.error)}</p>` : "";
    return `<div class="stack">${top}${consoleHero(list[0])}${chips}${search}${err}
      ${rail.length ? `<div class="rail-t">Les dernières infos</div><div class="rail">${rail.map(tile).join("")}</div>` : ""}
      ${rest.map(it => card(it, false)).join("")}
      ${list.length > S.shown ? `<button class="more" data-act="more">Voir plus (${list.length - S.shown})</button>` : ""}</div>`;
  } else {
    const part = list.slice(0, S.shown);
    body = part.map((it, i) => card(it, i === 0 && !S.query)).join("");
    if (list.length > S.shown) body += `<button class="more" data-act="more">Voir plus (${list.length - S.shown})</button>`;
  }
  const err = S.error && S.feed ? `<p class="small err">${esc(S.error)}</p>` : "";
  return `<div class="stack">${top}${chips}${search}${err}${body}</div>`;
}

function viewSetup() {
  return `<div class="stack">
    <header class="top"><div class="brand"><i></i>AnounisGaming</div></header>
    <div class="box stack">
      <h2>Bienvenue</h2>
      <p class="muted">Le robot de ton dépôt GitHub prépare le fil d'actu toutes les heures. Pour que l'appli puisse le lire, colle ici un code d'accès GitHub en lecture seule.</p>
      <ol class="steps">
        <li>Touche le bouton ci-dessous et connecte-toi à GitHub.</li>
        <li>Nom : <b>AnounisGaming</b>, expiration : <b>No expiration</b> (ou 1 an).</li>
        <li><b>Repository access</b> : <b>Only select repositories</b>, puis <b>AnounisGaming</b>.</li>
        <li><b>Permissions</b> : <b>Contents</b> en <b>Read-only</b>.</li>
        <li>Touche <b>Generate token</b>, copie le code et colle-le ici.</li>
      </ol>
      <button class="btn block" data-url="https://github.com/settings/personal-access-tokens/new">${ICON.ext} Créer le code sur GitHub</button>
      <div class="field"><label for="tk">Code d'accès</label><input id="tk" class="input" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <button class="btn primary block" data-act="save-token">Enregistrer et charger le fil</button>
    </div></div>`;
}

/* ----- Prix PC ----- */
const COUNTRIES = [["FR", "France"], ["GB", "Royaume-Uni"], ["US", "États-Unis"], ["CA", "Canada"], ["PL", "Pologne"], ["TR", "Turquie"], ["BR", "Brésil"], ["MX", "Mexique"], ["IN", "Inde"], ["JP", "Japon"], ["AU", "Australie"]];
const FLAG = c => String.fromCodePoint(...[...c].map(ch => 127397 + ch.charCodeAt(0)));

async function http(method, url, data) {
  if (NATIVE && Plug.CapacitorHttp) {
    const r = await Plug.CapacitorHttp.request({ method, url, headers: { "Content-Type": "application/json", Accept: "application/json" }, data });
    if (r.status >= 400) throw new Error(`Erreur ${r.status}`);
    return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
  }
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
  if (!r.ok) throw new Error(`Erreur ${r.status}`);
  return r.json();
}
let RATES = null;
async function rates() {
  if (RATES) return RATES;
  for (const u of ["https://api.frankfurter.dev/v1/latest?base=EUR", "https://api.frankfurter.app/latest?from=EUR"]) {
    try { const d = await http("GET", u); RATES = Object.assign({ EUR: 1 }, d.rates); return RATES; } catch {}
  }
  throw new Error("Taux de change indisponibles");
}
const toEur = (amount, cur) => (RATES && RATES[cur]) ? amount / RATES[cur] : null;

async function searchGames() {
  const P = S.price, q = P.q.trim();
  if (!q) return;
  P.loading = true; P.error = null; P.game = null; P.rows = null; render();
  try {
    const key = encodeURIComponent(S.settings.itad.trim());
    P.results = await http("GET", `https://api.isthereanydeal.com/games/search/v1?key=${key}&title=${encodeURIComponent(q)}&results=12`);
  } catch (e) { P.error = "Recherche impossible. Vérifie ta clé IsThereAnyDeal dans Réglages."; }
  P.loading = false; render();
}

function riskOf(shop, country) {
  if (country === "FR") return null;
  const s = (shop || "").toLowerCase();
  if (s.includes("steam")) return ["high", "Risque élevé : VPN interdit par Steam"];
  return ["mid", "Compte ou paiement du pays souvent requis"];
}

async function loadPrices(game) {
  const P = S.price;
  P.game = game; P.rows = null; P.low = null; P.loading = true; P.error = null; render();
  try {
    await rates();
    const key = encodeURIComponent(S.settings.itad.trim());
    const res = await Promise.all(COUNTRIES.map(([c]) =>
      http("POST", `https://api.isthereanydeal.com/games/prices/v3?key=${key}&country=${c}&deals=false&vouchers=true&capacity=8`, [game.id])
        .then(d => [c, d]).catch(() => [c, null])));
    const rows = [];
    for (const [c, d] of res) {
      const g = d && d[0];
      if (!g) continue;
      if (c === "FR" && g.historyLow && g.historyLow.all) P.low = g.historyLow.all;
      for (const deal of g.deals || []) {
        const cur = deal.price && deal.price.currency;
        const eur = toEur(deal.price.amount, cur);
        if (eur == null) continue;
        rows.push({ country: c, shop: deal.shop && deal.shop.name, local: deal.price.amount, cur, eur, cut: deal.cut || 0, url: deal.url, drm: (deal.drm || []).map(x => x.name).join(", ") });
      }
    }
    rows.sort((a, b) => a.eur - b.eur);
    // une ligne par store et par prix arrondi, pour éviter les répétitions
    const seen = new Set();
    P.rows = rows.filter(r => { const k = r.shop + "|" + r.country; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);
    if (!P.rows.length) P.error = "Aucune offre trouvée pour ce jeu dans les stores suivis.";
  } catch (e) { P.error = e.message || "Prix indisponibles"; }
  P.loading = false; render();
}

const fmtEur = n => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const fmtLocal = (n, c) => { try { return n.toLocaleString("fr-FR", { style: "currency", currency: c }); } catch { return n + " " + c; } };

function viewPrix() {
  const P = S.price;
  const head = `<header class="top"><div><div class="brand">Prix PC</div><div class="updated">Stores officiels, ${COUNTRIES.length} pays, convertis en euros</div></div></header>`;
  if (!S.settings.itad) return `<div class="stack">${head}<div class="box stack"><h3>Il faut une clé gratuite</h3>
    <p class="muted">Les prix viennent d'IsThereAnyDeal, qui suit les stores officiels dans chaque pays.</p>
    <ol class="steps"><li>Crée un compte IsThereAnyDeal.</li><li>Va dans <b>Apps</b>, crée une app (nom libre).</li><li>Copie la <b>API Key</b> (pas l'OAuth Client ID).</li></ol>
    <button class="btn block" data-url="https://isthereanydeal.com/apps/my/">${ICON.ext} Obtenir ma clé</button>
    <div class="field"><label for="ik">Clé API</label><input id="ik" class="input" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
    <button class="btn primary block" data-act="save-itad">Enregistrer</button></div></div>`;
  let body = "";
  if (P.loading) body = `<div class="skel" style="height:220px"></div>`;
  else if (P.game && P.rows) {
    const best = P.rows[0];
    const low = P.low ? `<p class="small muted">Plus bas historique en France : <b class="num">${fmtLocal(P.low.amount, P.low.currency)}</b>${best && P.low.amount && best.eur <= P.low.amount * 1.1 ? ' · <span class="ok">bonne affaire</span>' : ""}</p>` : "";
    body = `<button class="btn" data-act="price-back">${ICON.back} Autres résultats</button>
      <div class="stack"><h2>${esc(P.game.title)}</h2>${low}</div>
      <div class="card">${P.rows.map((r, i) => {
        const risk = riskOf(r.shop, r.country);
        return `<button class="price-row${i === 0 ? " best" : ""}" style="width:100%;text-align:left" data-url="${esc(r.url)}">
          <div class="eur num">${fmtEur(r.eur)}</div>
          <div class="grow"><div class="row" style="gap:6px"><b>${esc(r.shop)}</b>${r.cut ? `<span class="cut">-${r.cut}%</span>` : ""}</div>
          <div class="tiny muted">${FLAG(r.country)} ${esc((COUNTRIES.find(c => c[0] === r.country) || [])[1] || r.country)} · ${fmtLocal(r.local, r.cur)}${r.drm ? " · " + esc(r.drm) : ""}</div>
          ${risk ? `<div class="risk ${risk[0]}">${risk[1]}</div>` : ""}</div>
          <span class="muted">${ICON.ext.replace("<svg", '<svg width="18" height="18"')}</span></button>`;
      }).join("")}</div>
      <p class="tiny muted">Conversion au taux BCE du jour. Les prix étrangers peuvent exiger un compte, une carte ou une adresse du pays.</p>`;
  } else if (P.results) {
    body = P.results.length ? `<div class="card">${P.results.map((g, i) => `<button class="game" data-game="${i}">
        ${g.assets && (g.assets.boxart || g.assets.banner145) ? `<img src="${esc(g.assets.boxart || g.assets.banner145)}" alt="" loading="lazy">` : '<img alt="">'}
        <div class="grow"><b>${esc(g.title)}</b><div class="tiny muted">${g.type === "dlc" ? "Contenu additionnel" : "Jeu"}</div></div></button>`).join("")}</div>`
      : `<p class="muted">Aucun jeu trouvé.</p>`;
  } else {
    body = `<div class="empty">${ICON.tag}<p class="muted">Tape le nom d'un jeu PC pour voir l'offre la moins chère, tous pays confondus.</p></div>`;
  }
  const err = P.error ? `<p class="small err">${esc(P.error)}</p>` : "";
  return `<div class="stack">${head}
    <form class="row" data-form="price"><input class="search grow" type="search" placeholder="Nom du jeu…" value="${esc(P.q)}" data-input="price" enterkeyhint="search"><button class="btn primary" type="submit">OK</button></form>
    ${err}${body}</div>`;
}

/* ----- Réglages ----- */
function viewReglages() {
  const srcs = [...new Set(allItems().map(i => i.source))].sort((a, b) => a.localeCompare(b));
  const st = S.status;
  const status = st ? Object.entries(st.sources).map(([n, s]) => `<div class="switch"><span>${esc(n)}</span><span class="tiny ${s.ok ? "ok" : "err"}">${s.ok ? s.count + " infos" : "en panne"}</span></div>`).join("") : '<p class="small muted">Disponible après le chargement du fil.</p>';
  return `<div class="stack">
    <header class="top"><div class="brand">Réglages</div></header>
    <div class="box stack"><h3>Skin</h3>
      <div class="skins">${SKINS.map(k => `<button class="skin-card" data-skin="${k.id}" aria-pressed="${skin() === k.id}"><div class="sw" style="background:${k.colors[0]}">${k.colors.slice(1).map(c => `<i style="background:${c}"></i>`).join("")}</div><div class="nm">${k.name}</div></button>`).join("")}</div>
      <p class="tiny muted">Astuce : le bouton palette en haut du fil passe au skin suivant.</p>
    </div>
    <div class="box stack"><h3>Lecture audio</h3>
      <div class="switch"><span>Voix humaine (préparée par le robot)<div class="tiny muted">Sinon, voix Android</div></span><input type="checkbox" data-set="voice" ${S.settings.voice === "humaine" ? "checked" : ""}></div>
      <div class="field"><label for="rate">Vitesse : <span class="num">${S.settings.rate.toFixed(1)}×</span></label><input id="rate" type="range" min="0.8" max="1.5" step="0.1" value="${S.settings.rate}" data-set="rate"></div>
    </div>
    <div class="box stack"><h3>Sources affichées</h3>
      ${srcs.length ? srcs.map(n => `<label class="switch"><span>${esc(n)}</span><input type="checkbox" data-src="${esc(n)}" ${S.hidden.has(n) ? "" : "checked"}></label>`).join("") : '<p class="small muted">Disponible après le chargement du fil.</p>'}
    </div>
    <div class="box stack"><h3>État des sources</h3><div class="switch"><span>Reddit (lu par ton téléphone)</span><span class="tiny ${S.redditErr ? "err" : "ok"}">${S.redditErr ? "indisponible" : S.reddit ? S.reddit.items.length + " infos · " + ago(S.reddit.at) : "pas encore lu"}</span></div><p class="tiny muted">${st ? "Dernier passage du robot " + ago(st.updated) + " · traduction : " + Object.entries(st.translation).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") : ""}</p>${status}</div>
    <div class="box stack"><h3>Accès</h3>
      <div class="field"><label for="tk2">Code d'accès GitHub</label><input id="tk2" class="input" value="${esc(S.settings.token)}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <div class="field"><label for="ik2">Clé IsThereAnyDeal</label><input id="ik2" class="input" value="${esc(S.settings.itad)}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <button class="btn primary block" data-act="save-keys">Enregistrer</button>
    </div>
    <p class="tiny muted" style="text-align:center">AnounisGaming · usage personnel</p></div>`;
}

/* ----- article ----- */
function findItem(id) { return allItems().find(i => i.id === id); }
function openArticle(id) {
  const it = findItem(id);
  if (!it) return;
  markRead(id);
  const media = it.video
    ? `<div class="art-media" ${bg(it.image || `https://i.ytimg.com/vi/${it.video}/hqdefault.jpg`)} data-yt="${esc(it.video)}"><div class="play"><span>${ICON.play}</span></div></div>`
    : it.image ? `<div class="art-media" ${bg(it.image)}></div>` : "";
  const also = (it.also || []).length ? `<div class="section-t">Aussi relayé par</div><div class="list">${it.also.map(a => `<button data-url="${esc(a.url)}"><div class="grow"><b class="small">${esc(a.source)}</b><div class="small muted">${esc(a.title)}</div></div>${ICON.ext.replace("<svg", '<svg width="18" height="18"')}</button>`).join("")}</div>` : "";
  const warn = it.rumor ? `<div class="warn"><b>Rumeur non confirmée.</b> Ces infos viennent de fuites ou d'insiders et peuvent se révéler fausses.</div>` : "";
  const orig = it.translated ? `<p class="orig">Titre original : ${esc(it.title_orig)}</p>` : "";
  $("#sheet-root").innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-in art stack">
      <div class="row between"><button class="iconbtn" data-act="close" aria-label="Retour">${ICON.back}</button>${badges(it)}</div>
      ${media}${meta(it)}<h1>${esc(it.title)}</h1>${warn}
      ${it.summary ? `<p class="lead">${esc(it.summary)}</p>` : ""}${orig}
      <div class="btns"><button class="btn primary" data-listen="${it.id}">${ICON.headphones} Écouter</button><button class="btn" data-url="${esc(it.url)}">${ICON.ext} Lire la source</button></div>
      ${also}</div></div>`;
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  $("#sheet-root").innerHTML = "";
  document.body.style.overflow = "";
  if (S.tab === "fil") render();
}

/* ---------- lecteur audio ---------- */
const P = { queue: [], idx: -1, audio: new Audio(), playing: false, tts: false, item: null, url: null };
P.audio.addEventListener("timeupdate", () => { const b = $("#pbar"); if (b && P.audio.duration) b.style.width = (100 * P.audio.currentTime / P.audio.duration) + "%"; });
P.audio.addEventListener("ended", () => nextTrack());
P.audio.addEventListener("error", () => { if (P.item && !P.tts && P.audio.src) speakTts(P.item); });

function spoken(it) { return `${it.title}. ${it.summary || ""}`.replace(/https?:\/\/\S+/g, ""); }
async function speakTts(it) {
  if (P.tts && P.item === it) return;
  P.tts = true; P.playing = true; renderPlayer();
  try {
    if (Plug.TextToSpeech) {
      await Plug.TextToSpeech.speak({ text: spoken(it), lang: "fr-FR", rate: S.settings.rate, pitch: 1, volume: 1, category: "playback" });
    } else if (window.speechSynthesis) {
      await new Promise(res => { const u = new SpeechSynthesisUtterance(spoken(it)); u.lang = "fr-FR"; u.rate = S.settings.rate; u.onend = u.onerror = res; speechSynthesis.speak(u); });
    }
  } catch {}
  if (P.tts && P.item === it) nextTrack();
}
async function playItem(it) {
  stopAll(false);
  P.item = it; P.playing = true; P.tts = false; renderPlayer();
  if (it.audio && S.settings.voice === "humaine") {
    try {
      const src = await gh(`audio/${it.id}.mp3`, "blob");
      if (P.item !== it) return;
      if (P.url && P.url.startsWith("blob:")) URL.revokeObjectURL(P.url);
      P.url = src;
      P.audio.src = P.url; P.audio.playbackRate = S.settings.rate;
      await P.audio.play();
      return;
    } catch { if (P.item !== it || P.tts) return; }
  }
  speakTts(it);
}
function stopAll(clear = true) {
  P.audio.pause();
  if (Plug.TextToSpeech) Plug.TextToSpeech.stop().catch(() => {});
  else if (window.speechSynthesis) speechSynthesis.cancel();
  P.tts = false; P.playing = false;
  if (clear) { P.item = null; P.queue = []; P.idx = -1; }
  renderPlayer();
}
function nextTrack() {
  if (P.queue.length && P.idx < P.queue.length - 1) { P.idx++; playItem(P.queue[P.idx]); }
  else { P.playing = false; P.item = null; renderPlayer(); }
}
function togglePlay() {
  if (!P.item) return;
  if (P.tts) { stopAll(false); P.playing = false; renderPlayer(); return; }
  if (P.audio.paused && P.audio.src) { P.audio.play(); P.playing = true; }
  else if (!P.audio.src || P.playing === false) { playItem(P.item); return; }
  else { P.audio.pause(); P.playing = false; }
  renderPlayer();
}
function renderPlayer() {
  const root = $("#player-root");
  if (!P.item) { root.innerHTML = ""; return; }
  const n = P.queue.length ? ` · ${P.idx + 1}/${P.queue.length}` : "";
  root.innerHTML = `<div class="player"><div class="player-in">
    <div class="grow"><div class="t">${esc(P.item.title)}</div><div class="s">${esc(P.item.source)}${P.tts ? " · voix Android" : ""}${n}</div><div class="bar"><i id="pbar"></i></div></div>
    <button class="pbtn" data-act="pp" aria-label="${P.playing ? "Pause" : "Lecture"}">${P.playing ? ICON.pause : ICON.play}</button>
    ${P.queue.length ? `<button class="pbtn ghost" data-act="pnext" aria-label="Suivant">${ICON.next}</button>` : ""}
    <button class="pbtn ghost" data-act="pclose" aria-label="Fermer">${ICON.close}</button></div></div>`;
}

/* ---------- navigation ---------- */
function renderNav() {
  const tabs = [["fil", "Fil", ICON.news], ["prix", "Prix PC", ICON.tag], ["reglages", "Réglages", ICON.gear]];
  $("#nav").innerHTML = `<div class="nav-in">${tabs.map(([k, l, i], n) => `<button data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ""}>${i}<span><span class="slot">${n + 1} </span>${l}</span></button>`).join("")}</div>`;
}
function render() {
  const app = $("#app");
  const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.input;
  const caret = focused ? document.activeElement.selectionStart : null;
  app.innerHTML = S.tab === "fil" ? viewFil() : S.tab === "prix" ? viewPrix() : viewReglages();
  renderNav();
  if (focused) { const el = app.querySelector(`[data-input="${focused}"]`); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch {} } }
}

document.addEventListener("click", e => {
  const t = e.target.closest("button, [data-yt], label");
  if (!t) return;
  const d = t.dataset;
  if (d.open) return openArticle(d.open);
  if (d.url) return openUrl(d.url);
  if (d.yt) { t.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(d.yt)}?autoplay=1&playsinline=1&rel=0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="Vidéo"></iframe>`; t.removeAttribute("data-yt"); t.style.backgroundImage = "none"; return; }
  if (d.listen) { const it = findItem(d.listen); P.queue = []; P.idx = -1; if (it) playItem(it); return; }
  if (d.filter) { S.filter = d.filter; store.set("filter", S.filter); S.shown = PAGE; render(); window.scrollTo(0, 0); return; }
  if (d.tab) { S.tab = d.tab; render(); window.scrollTo(0, 0); return; }
  if (d.skin && t.classList.contains("skin-card")) { S.settings.skin = d.skin; saveSettings(); applySkin(); return render(); }
  if (d.game != null) return loadPrices(S.price.results[+d.game]);
  switch (d.act) {
    case "refresh": return loadFeed(true);
    case "skin": return nextSkin();
    case "more": S.shown += PAGE; return render();
    case "close": return closeSheet();
    case "pp": return togglePlay();
    case "pnext": return nextTrack();
    case "pclose": return stopAll(true);
    case "listen-all": {
      const list = heads().filter(it => !S.read.has(it.id)).slice(0, 15);
      if (!list.length) return toast("Tu as déjà tout lu");
      P.queue = list; P.idx = 0; playItem(list[0]); return;
    }
    case "save-token": {
      const v = $("#tk").value.trim();
      if (!v) return toast("Colle d'abord le code");
      S.settings.token = v; saveSettings(); return loadFeed();
    }
    case "save-itad": { S.settings.itad = $("#ik").value.trim(); saveSettings(); return render(); }
    case "save-keys": {
      S.settings.token = $("#tk2").value.trim(); S.settings.itad = $("#ik2").value.trim(); saveSettings();
      toast("Enregistré"); return loadFeed();
    }
    case "price-back": S.price.game = null; S.price.rows = null; return render();
  }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.src) { t.checked ? S.hidden.delete(t.dataset.src) : S.hidden.add(t.dataset.src); store.set("hiddenSources", [...S.hidden]); }
  if (t.dataset.set === "voice") { S.settings.voice = t.checked ? "humaine" : "android"; saveSettings(); }
  if (t.dataset.set === "rate") { S.settings.rate = +t.value; saveSettings(); P.audio.playbackRate = S.settings.rate; render(); }
});
let qTimer;
document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.input === "query") { clearTimeout(qTimer); qTimer = setTimeout(() => { S.query = t.value; S.shown = PAGE; render(); }, 250); }
  if (t.dataset.input === "price") S.price.q = t.value;
});
document.addEventListener("submit", e => {
  if (e.target.dataset.form === "price") { e.preventDefault(); document.activeElement && document.activeElement.blur(); searchGames(); }
});

if (Plug.App) {
  Plug.App.addListener("backButton", () => {
    if ($("#sheet-root").innerHTML) return closeSheet();
    if (S.tab !== "fil") { S.tab = "fil"; return render(); }
    Plug.App.exitApp();
  });
  Plug.App.addListener("resume", () => { if (S.feed && Date.now() / 1000 - S.feed.updated > 1800) loadFeed(); });
}

applySkin();
render();
loadFeed();
loadReddit();
