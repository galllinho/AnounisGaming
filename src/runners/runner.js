// Vérification des prix en arrière-plan (toutes les 2 h, même appli fermée).
// L'appli envoie sa liste de souhaits avec l'événement « sync ».
addEventListener("sync", (resolve, reject, args) => {
  try { CapacitorKV.set("cfg", JSON.stringify(args || {})); resolve(); } catch (e) { reject(e); }
});

addEventListener("checkPrices", async (resolve, reject) => {
  try {
    const raw = CapacitorKV.get("cfg");
    const cfg = JSON.parse((raw && raw.value) || "{}");
    if (!cfg.key || !cfg.wish || !cfg.wish.length) return resolve();
    const fx = await (await fetch("https://api.frankfurter.dev/v1/latest?base=EUR")).json();
    const rates = Object.assign({ EUR: 1 }, fx.rates || {});
    const ids = cfg.wish.map(w => w.id);
    const best = {};
    for (const c of cfg.countries || ["FR"]) {
      try {
        const r = await fetch(`https://api.isthereanydeal.com/games/prices/v3?key=${encodeURIComponent(cfg.key)}&country=${c}&deals=false&capacity=4`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids) });
        const data = await r.json();
        for (const g of data || []) {
          for (const d of g.deals || []) {
            const rate = rates[d.price.currency];
            if (!rate) continue;
            const eur = d.price.amount / rate;
            if (!best[g.id] || eur < best[g.id].eur) best[g.id] = { eur, shop: d.shop.name, country: c };
          }
        }
      } catch (e) {}
    }
    const notes = [];
    let n = Math.floor(Date.now() / 1000) % 100000;
    for (const w of cfg.wish) {
      const b = best[w.id];
      if (b && b.eur <= w.target && (!w.notified || b.eur < w.notified - 0.01)) {
        w.notified = b.eur;
        notes.push({ id: ++n, title: "Baisse de prix : " + w.title,
          body: b.eur.toFixed(2).replace(".", ",") + " € chez " + b.shop + " (" + b.country + "), sous ton objectif de " + w.target.toFixed(2).replace(".", ",") + " €.",
          scheduleAt: new Date(Date.now() + 2000) });
      }
    }
    if (notes.length) CapacitorNotifications.schedule(notes);
    CapacitorKV.set("cfg", JSON.stringify(cfg));
    resolve();
  } catch (e) { reject(e); }
});
