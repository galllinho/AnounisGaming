// Tâche de fond (toutes les 30 min environ, même appli fermée) :
// alertes pour les infos majeures et l'actu des favoris, widget, et prix de la liste de souhaits (toutes les 2 h).
addEventListener("sync", (resolve, reject, args) => {
  try {
    const old = JSON.parse((CapacitorKV.get("cfg") || {}).value || "{}");
    const cfg = Object.assign({}, args || {});
    // garde l'état des alertes de prix déjà envoyées
    const sent = {};
    for (const w of old.wish || []) if (w.notified) sent[w.id] = w.notified;
    for (const w of cfg.wish || []) if (!w.notified && sent[w.id]) w.notified = sent[w.id];
    CapacitorKV.set("cfg", JSON.stringify(cfg));
    resolve();
  } catch (e) { reject(e); }
});

function norm(t) { return String(t || "").toLowerCase().replace(/[™®©]/g, "").replace(/[^a-z0-9à-ÿ]+/g, " ").trim(); }
let nid = Math.floor(Date.now() / 1000) % 100000;

async function checkNews(cfg, notes) {
  if (!cfg.raw) return;
  const r = await fetch(cfg.raw + "alerts.json?t=" + Math.floor(Date.now() / 60000));
  const a = await r.json();
  // widget : les 3 dernières infos
  const latest = (a.latest || []).map(x => ({ t: x.t, s: x.s }));
  if (latest.length) CapacitorKV.set("widget", JSON.stringify({ at: Date.now(), items: latest }));
  const seenRaw = CapacitorKV.get("seen");
  const first = !seenRaw || !seenRaw.value;
  const seen = first ? [] : JSON.parse(seenRaw.value);
  const favs = (cfg.favs || []).filter(f => f.key && f.key.length > 3);
  for (const it of a.items || []) {
    if (seen.includes(it.id)) continue;
    seen.push(it.id);
    if (first || notes.length >= 3) continue;
    const fav = cfg.alertFavs && favs.find(f => norm(it.t).includes(f.key));
    if (fav) notes.push({ id: ++nid, title: "★ " + fav.title, body: it.title + " (" + it.source + ")", scheduleAt: new Date(Date.now() + 1500) });
    else if (cfg.alertMajor && (it.n >= 3 || it.off) && !it.rumor) notes.push({ id: ++nid, title: it.off ? "Annonce officielle" : "Info majeure", body: it.title + (it.n > 1 ? " · " + it.n + " sources" : ""), scheduleAt: new Date(Date.now() + 1500) });
  }
  CapacitorKV.set("seen", JSON.stringify(seen.slice(-400)));
}

async function checkPrices(cfg, notes) {
  const last = Number((CapacitorKV.get("lastPrice") || {}).value || 0);
  if (!cfg.key || !cfg.wish || !cfg.wish.length || Date.now() - last < 2 * 3600 * 1000) return;
  CapacitorKV.set("lastPrice", String(Date.now()));
  const fx = await (await fetch("https://api.frankfurter.dev/v1/latest?base=EUR")).json();
  const rates = Object.assign({ EUR: 1 }, fx.rates || {});
  const ids = cfg.wish.map(w => w.id);
  const best = {};
  for (const c of cfg.countries || ["FR"]) {
    try {
      const r = await fetch(`https://api.isthereanydeal.com/games/prices/v3?key=${encodeURIComponent(cfg.key)}&country=${c}&deals=false&capacity=4`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids) });
      for (const g of (await r.json()) || []) {
        for (const d of g.deals || []) {
          const rate = rates[d.price.currency];
          if (!rate) continue;
          const eur = d.price.amount / rate;
          if (!best[g.id] || eur < best[g.id].eur) best[g.id] = { eur, shop: d.shop.name, country: c };
        }
      }
    } catch (e) {}
  }
  for (const w of cfg.wish) {
    const b = best[w.id];
    if (b && b.eur <= w.target && (!w.notified || b.eur < w.notified - 0.01)) {
      w.notified = b.eur;
      notes.push({ id: ++nid, title: "Baisse de prix : " + w.title,
        body: b.eur.toFixed(2).replace(".", ",") + " € chez " + b.shop + " (" + b.country + "), sous ton objectif de " + w.target.toFixed(2).replace(".", ",") + " €.",
        scheduleAt: new Date(Date.now() + 2000) });
    }
  }
}

addEventListener("checkPrices", async (resolve, reject) => {
  try {
    const cfg = JSON.parse((CapacitorKV.get("cfg") || {}).value || "{}");
    const notes = [];
    try { await checkNews(cfg, notes); } catch (e) {}
    try { await checkPrices(cfg, notes); } catch (e) {}
    if (notes.length) CapacitorNotifications.schedule(notes);
    CapacitorKV.set("cfg", JSON.stringify(cfg));
    resolve();
  } catch (e) { reject(e); }
});
