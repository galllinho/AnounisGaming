"""Fonctions V2 du robot : Bluesky, fiabilité, articles de rumeurs, illustrations IGDB, brief du matin."""
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone

import requests

UA = "Mozilla/5.0 (Linux; Android 14) AnounisGaming/1.0 (+usage personnel)"
KIND_RELIABILITY = {"officiel": 5, "site": 4, "video": 4, "bluesky": 4, "reddit": 2}
DENY_WORDS = ["denies", "denied", "debunk", "debunked", "fake", "not true", "false", "démenti", "dément", "faux"]
CONFIRM_WORDS = ["officially", "confirmed", "confirms", "announced", "announces", "officiel", "confirme", "annonce"]


def log(*a):
    import sys
    print(*a, file=sys.stderr, flush=True)


# ---------- Bluesky (API publique, sans compte) ----------

def fetch_bluesky(src, item_id, shorten):
    handle = src["url"].strip().lstrip("@")
    r = requests.get(
        "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed",
        params={"actor": handle, "limit": 30, "filter": "posts_no_replies"},
        headers={"User-Agent": UA}, timeout=25,
    )
    r.raise_for_status()
    out = []
    for f in r.json().get("feed", []):
        if f.get("reason"):  # republication d'un autre compte
            continue
        post = f.get("post", {})
        rec = post.get("record", {})
        text = re.sub(r"\s+", " ", rec.get("text", "")).strip()
        if len(text) < 40:
            continue
        rkey = post.get("uri", "").rsplit("/", 1)[-1]
        url = f"https://bsky.app/profile/{handle}/post/{rkey}"
        try:
            ts = int(datetime.fromisoformat(rec.get("createdAt", "").replace("Z", "+00:00")).timestamp())
        except Exception:
            ts = int(time.time())
        emb = post.get("embed") or {}
        image = video = None
        if emb.get("images"):
            image = emb["images"][0].get("fullsize") or emb["images"][0].get("thumb")
        ext = emb.get("external") or (emb.get("media") or {}).get("external") or {}
        if ext:
            image = image or ext.get("thumb")
            m = re.search(r"(?:youtube\.com/watch\?v=|youtu\.be/)([A-Za-z0-9_-]{11})", ext.get("uri", ""))
            video = m.group(1) if m else None
        cut = text.find(". ")
        title = text if len(text) <= 140 else (text[: cut + 1] if 30 < cut < 140 else text[:137].rsplit(" ", 1)[0] + "…")
        summary = shorten(text[len(title):].strip(" …")) if len(text) > len(title) + 20 else ""
        out.append({
            "id": item_id(url), "url": url, "source": src["name"], "kind": "bluesky", "lang": src.get("lang", "en"),
            "published": ts, "title_orig": title, "summary_orig": summary, "image": image, "video": video,
        })
    return out


# ---------- fiabilité ----------

def source_reliability(sources):
    table = {}
    for s in sources:
        table[s["name"]] = s.get("reliability", KIND_RELIABILITY.get(s.get("kind"), 3))
    return table


def rate_item(it, members, table):
    """Indice de 1 à 5 : meilleure source + bonus si plusieurs sources indépendantes en parlent."""
    best = max(table.get(m["source"], KIND_RELIABILITY.get(m["kind"], 3) if not m["source"].startswith("r/") else 2) for m in members)
    bonus = 1 if len({m["source"] for m in members}) >= 3 else 0
    return max(1, min(5, best + bonus))


def rumor_status(members):
    text = " ".join(f"{m['title_orig']} {m.get('summary_orig', '')}".lower() for m in members)
    if any(m["kind"] == "officiel" for m in members) or any(w in text for w in ("officially confirmed", "confirme officiellement")):
        return "confirme"
    if any(w in text for w in DENY_WORDS):
        return "dementi"
    return "rumeur"


# ---------- illustrations IGDB (facultatif, compte Twitch développeur gratuit) ----------

class Igdb:
    def __init__(self):
        self.cid = os.environ.get("TWITCH_CLIENT_ID", "").strip()
        self.secret = os.environ.get("TWITCH_CLIENT_SECRET", "").strip()
        self.token = None
        self.ok = bool(self.cid and self.secret)
        self.error = None
        self.calls = 0

    def _auth(self):
        if self.token:
            return self.token
        r = requests.post("https://id.twitch.tv/oauth2/token", params={
            "client_id": self.cid, "client_secret": self.secret, "grant_type": "client_credentials"}, timeout=20)
        r.raise_for_status()
        self.token = r.json()["access_token"]
        return self.token

    @staticmethod
    def candidates(title):
        """Devine le nom du jeu dans un titre : passages entre guillemets, puis suites de mots en capitales."""
        out = re.findall(r"[\"“«'‘]([^\"”»'’]{3,60})[\"”»'’]", title)
        stop = {"The", "A", "An", "New", "PS5", "PC", "Xbox", "Nintendo", "Switch", "Sony", "PlayStation", "Rumor", "Report", "Leak", "Insider"}
        for m in re.finditer(r"((?:[A-Z][\w'’:-]*|\d+)(?:\s+(?:[A-Z][\w'’:-]*|\d+|of|the|and))*)", title):
            c = m.group(1).strip(" :")
            if len(c) > 3 and c.split()[0] not in stop:
                out.append(c)
        seen, res = set(), []
        for c in sorted(out, key=len, reverse=True):
            if c.lower() not in seen:
                seen.add(c.lower())
                res.append(c)
        return res[:4]

    def illustrate(self, it):
        if not self.ok or self.calls > 60:
            return
        try:
            for cand in self.candidates(it["title_orig"]):
                self.calls += 1
                r = requests.post("https://api.igdb.com/v4/games", headers={
                    "Client-ID": self.cid, "Authorization": f"Bearer {self._auth()}"},
                    data=f'search "{cand.replace(chr(34), "")}"; fields name,cover.image_id,screenshots.image_id,artworks.image_id,videos.video_id; limit 3;',
                    timeout=20)
                r.raise_for_status()
                low = it["title_orig"].lower()
                for g in r.json():
                    name = g.get("name", "")
                    if name and all(w in low for w in name.lower().split()[:3]):
                        shots = [s["image_id"] for s in (g.get("screenshots") or []) + (g.get("artworks") or [])][:6]
                        it["game"] = name
                        if g.get("cover"):
                            it["cover"] = f"https://images.igdb.com/igdb/image/upload/t_cover_big/{g['cover']['image_id']}.jpg"
                        it["gallery"] = [f"https://images.igdb.com/igdb/image/upload/t_screenshot_big/{s}.jpg" for s in shots]
                        vids = [v["video_id"] for v in (g.get("videos") or [])]
                        if vids:
                            it["trailer"] = vids[-1]
                        return
                time.sleep(0.3)
        except Exception as exc:
            self.error = f"igdb: {exc}"[:200]
            self.ok = False


# ---------- articles de rumeurs ----------

GEMINI_MODELS = [m for m in [os.environ.get("GEMINI_MODEL", "")] if m] + ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.0-flash"]


def gemini_call(payload, timeout=90):
    """Appelle Gemini en essayant plusieurs noms de modèle (Google en retire régulièrement)."""
    key = os.environ.get("GEMINI_KEY", "").strip()
    if not key:
        return None
    last = None
    for model in list(GEMINI_MODELS):
        for attempt in range(2):
            try:
                r = requests.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                                  headers={"x-goog-api-key": key, "Content-Type": "application/json"}, json=payload, timeout=timeout)
            except requests.exceptions.Timeout:
                last = f"{model} : délai dépassé"
                break
            if r.status_code in (429, 500, 503):
                # modèle saturé : petite pause, puis on essaie le modèle suivant
                last = f"{model} : {r.status_code} (saturé)"
                time.sleep(6)
                continue
            if r.status_code == 404:
                last = f"modèle {model} introuvable"
                break
            if r.status_code >= 400:
                raise RuntimeError(f"Gemini {r.status_code} : {r.text[:160]}")
            GEMINI_MODELS[:] = [model] + [m for m in GEMINI_MODELS if m != model]
            return r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
    raise RuntimeError(last or "Gemini indisponible")


def _gemini(prompt):
    return gemini_call({"contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 900}}, timeout=90)


def write_rumor(it, members, table, state):
    """Construit l'article d'une rumeur. Rédigé par l'IA si une clé Gemini est fournie, sinon assemblé à partir des sources."""
    who = []
    for m in members:
        rel = table.get(m["source"], 2 if m["source"].startswith("r/") else KIND_RELIABILITY.get(m["kind"], 3))
        who.append({"source": m["source"], "url": m["url"], "title": m["title"], "reliability": rel})
    who.sort(key=lambda w: -w["reliability"])
    said = []
    for m in members:
        s = (m.get("summary") or "").strip()
        if s and s not in said:
            said.append(s)
    status = rumor_status(members)
    body = None
    sig = "|".join(sorted(m["id"] for m in members))
    prev = it.get("article") or {}
    if prev.get("sig") == sig and prev.get("by") == "ia":
        body = prev.get("body")
    elif state["ia_left"] > 0 and os.environ.get("GEMINI_KEY"):
        sources_txt = "\n".join(f"- {m['source']} : {m['title']}. {m.get('summary') or ''}" for m in members)
        prompt = ("Tu es journaliste jeu vidéo. Rédige en français un court article (150 à 220 mots) sur cette RUMEUR, "
                  "au conditionnel, sans rien inventer au-delà des sources. Structure : une phrase d'accroche, ce qui est "
                  "affirmé, qui l'affirme, ce qui reste incertain. Pas de titre, pas de liste.\n\nSources :\n" + sources_txt)
        try:
            body = _gemini(prompt)
            state["ia_left"] -= 1
            state["ia_used"] += 1
        except Exception as exc:
            state["error"] = f"gemini: {exc}"[:200]
            state["ia_left"] = 0
    article = {"sig": sig, "status": status, "who": who, "by": "ia" if body else "sources"}
    if body:
        article["body"] = body
    else:
        article["said"] = said[:4]
    it["article"] = article


# ---------- brief du matin ----------

def paris_now():
    now = datetime.now(timezone.utc)
    # heure d'été européenne : du dernier dimanche de mars au dernier dimanche d'octobre
    y = now.year
    last_sun = lambda m: max(d for d in (datetime(y, m, day, 1, tzinfo=timezone.utc) for day in range(25, 32)) if d.weekday() == 6)
    offset = 2 if last_sun(3) <= now < last_sun(10) else 1
    return now + timedelta(hours=offset)


MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]


def build_brief(items, old_brief):
    """Choisit les 6 infos qui comptent depuis la veille au soir et prépare le texte à lire."""
    local = paris_now()
    today = local.strftime("%Y-%m-%d")
    if old_brief and old_brief.get("date") == today:
        return old_brief, False
    if local.hour < 5 or (old_brief and local.hour >= 12):
        return old_brief, False
    since = time.time() - 14 * 3600
    heads = [it for it in items if not it.get("group") and it["published"] >= since and not it.get("pending")]

    def score(it):
        return len(it.get("also", [])) * 2 + (2 if it["kind"] == "officiel" else 0) + (1 if it.get("rumor") else 0) + (1 if it.get("video") else 0)
    picked = sorted(heads, key=lambda x: (-score(x), -x["published"]))[:6]
    if len(picked) < 3:
        return old_brief, False
    date_txt = f"{JOURS[local.weekday()]} {local.day} {MOIS[local.month - 1]}"
    parts = [f"Bonjour ! Voici ton brief jeux vidéo du {date_txt}."]
    ordinals = ["Pour commencer", "Ensuite", "On continue", "Autre info", "Encore une"]
    for n, it in enumerate(picked):
        lead = ordinals[min(n, len(ordinals) - 1)] if n < len(picked) - 1 else "Et pour finir"
        if it.get("rumor") and n < len(picked) - 1:
            lead = "Côté rumeurs, à prendre avec des pincettes"
        summary = (it.get("summary") or "").strip()
        parts.append(f"{lead} : {it['title'].rstrip(' .!?…')}. {summary}".strip())
    parts.append("C'est tout pour ce matin. Bonne journée, et bon jeu !")
    text = "\n\n".join(parts)
    return {"date": today, "label": date_txt, "items": [it["id"] for it in picked], "text": text, "audio": False}, True
