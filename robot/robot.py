"""Robot AnounisGaming.

Lit les sources d'actu, traduit en français, regroupe les doublons,
repère les rumeurs, génère l'audio (voix neuronale) et écrit feed.json.

Usage : python robot/robot.py --out <dossier de données>
"""
import argparse
import asyncio
import calendar
import hashlib
import html
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import feedparser
import requests

import extras

ROOT = Path(__file__).resolve().parent
UA = "Mozilla/5.0 (Linux; Android 14) AnounisGaming/1.0 (+usage personnel)"
KEEP_HOURS = 96          # durée de conservation des infos
MAX_ITEMS = 450          # taille max du fil
MAX_PER_SOURCE = 25      # entrées lues par source à chaque passage
MAX_NEW_TRANSLATE = 300  # traductions max par passage
MAX_NEW_AUDIO = 30       # nouveaux audios max par passage
VOICES = ["fr-FR-VivienneMultilingualNeural", "fr-FR-DeniseNeural"]

RUMOR_WORDS = [
    "leak", "leaked", "leaks", "rumor", "rumour", "rumored", "rumoured", "insider",
    "reportedly", "allegedly", "datamine", "datamined", "rumeur", "fuite", "leaké",
    "リーク", "噂", "rumors", "rumours", "hearing that", "sources say", "i'm told", "i am told",
    "according to sources", "selon nos informations", "selon des sources",
]
PC_WORDS = ["pc", "steam", "epic games store", "gog", "windows", "steam deck"]
PS5_WORDS = ["ps5", "playstation 5", "playstation", "ps plus", "psvr2", "ps5 pro", "state of play"]
STOP = set("""le la les un une des de du d l et ou en au aux pour par sur dans avec sans est sont a
ont ce cette ces son sa ses leur leurs qui que quoi dont plus moins tout tous toute toutes nouveau
nouvelle nouveaux jeu jeux video vidéo trailer bande annonce date sortie annonce annoncé officiel
the a an of to in on for with and or is are was be its it this that new game games""".split())


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def clean_html(text):
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", text or "")
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    # bruit fréquent dans les flux
    text = re.sub(r"\b(submitted by|\[link\]|\[comments\]|Read more|Continue reading).*$", "", text, flags=re.I).strip()
    return text


def shorten(text, limit=420):
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "), cut.rfind("。"))
    if end > limit * 0.5:
        return cut[: end + 1].strip()
    return cut.rsplit(" ", 1)[0].strip() + "…"


def item_id(url):
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]


def find_image(entry):
    for key in ("media_content", "media_thumbnail"):
        for m in entry.get(key) or []:
            url = m.get("url")
            if url and not url.endswith(".mp4"):
                return url
    for enc in entry.get("enclosures") or []:
        if (enc.get("type") or "").startswith("image") and enc.get("href"):
            return enc["href"]
    blob = " ".join([entry.get("summary", "")] + [c.get("value", "") for c in entry.get("content") or []])
    m = re.search(r'<img[^>]+src="([^"]+)"', blob)
    if m:
        return html.unescape(m.group(1))
    return None


def find_video(entry):
    if entry.get("yt_videoid"):
        return entry["yt_videoid"]
    blob = " ".join([entry.get("summary", ""), entry.get("link", "")] + [c.get("value", "") for c in entry.get("content") or []])
    m = re.search(r"(?:youtube(?:-nocookie)?\.com/(?:embed/|watch\?v=)|youtu\.be/)([A-Za-z0-9_-]{11})", blob)
    return m.group(1) if m else None


def tags_for(text):
    low = " " + text.lower() + " "
    plats = []
    if any(re.search(r"(?<![a-z0-9])" + re.escape(w) + r"(?![a-z0-9])", low) for w in PS5_WORDS):
        plats.append("PS5")
    if any(re.search(r"(?<![a-z0-9])" + re.escape(w) + r"(?![a-z0-9])", low) for w in PC_WORDS):
        plats.append("PC")
    rumor = any(w in low for w in RUMOR_WORDS)
    return plats, rumor


def fetch_source(src):
    """Retourne (liste d'entrées brutes, statut)."""
    try:
        if src["kind"] == "bluesky":
            out = extras.fetch_bluesky(src, item_id, shorten)[: src.get("max", MAX_PER_SOURCE)]
            return out, {"ok": True, "count": len(out)}
        r = requests.get(src["url"], headers={"User-Agent": UA}, timeout=25)
        if r.status_code in (403, 429) and "www.reddit.com" in src["url"]:
            time.sleep(6)
            r = requests.get(src["url"].replace("www.reddit.com", "old.reddit.com"), headers={"User-Agent": UA}, timeout=25)
        r.raise_for_status()
        feed = feedparser.parse(r.content)
        out = []
        for e in feed.entries[:src.get("max", MAX_PER_SOURCE)]:
            link = e.get("link")
            title = clean_html(e.get("title", ""))
            if not link or not title:
                continue
            ts = e.get("published_parsed") or e.get("updated_parsed")
            published = calendar.timegm(ts) if ts else int(time.time())
            body = e.get("summary", "")
            if not body and e.get("content"):
                body = e["content"][0].get("value", "")
            summary = shorten(clean_html(body))
            if summary.lower().startswith(title.lower()[:40].lower()) and len(summary) < len(title) + 20:
                summary = ""
            name = src["name"]
            if src["kind"] == "reddit":
                m = re.search(r"reddit\.com/r/([^/]+)/", link)
                name = f"r/{m.group(1)}" if m else name
            out.append({
                "id": item_id(link),
                "url": link,
                "source": name,
                "kind": src["kind"],
                "lang": src.get("lang", "auto"),
                "published": published,
                "title_orig": title,
                "summary_orig": summary,
                "image": find_image(e),
                "video": find_video(e),
            })
        return out, {"ok": True, "count": len(out)}
    except Exception as exc:  # une source en panne ne bloque jamais les autres
        return [], {"ok": False, "error": f"{type(exc).__name__}: {str(exc)[:160]}"}


# ---------- traduction ----------

class Translator:
    def __init__(self):
        self.deepl_key = os.environ.get("DEEPL_KEY", "").strip()
        self.deepl_ok = bool(self.deepl_key)
        self.used = {"deepl": 0, "gemini": 0, "google": 0, "aucune": 0}
        self.gemini_key = os.environ.get("GEMINI_KEY", "").strip()
        self.gemini_ok = bool(self.gemini_key)
        self.last_error = None
        self.errors = []

    def _deepl(self, texts):
        host = "api-free.deepl.com" if self.deepl_key.endswith(":fx") else "api.deepl.com"
        r = requests.post(
            f"https://{host}/v2/translate",
            headers={"Authorization": f"DeepL-Auth-Key {self.deepl_key}"},
            json={"text": texts, "target_lang": "FR", "preserve_formatting": True},
            timeout=40,
        )
        if r.status_code in (403, 456, 429):
            raise RuntimeError(f"DeepL {r.status_code}")
        r.raise_for_status()
        return [t["text"] for t in r.json()["translations"]]

    def _gemini(self, texts):
        """Traduction par Gemini (clé gratuite Google AI Studio), 40 textes par demande."""
        out = []
        for i in range(0, len(texts), 40):
            chunk = texts[i:i + 40]
            prompt = ("Traduis en français naturel chaque texte de ce tableau JSON (actualité jeu vidéo). Ne traduis pas les noms "
                      "de jeux, studios, consoles ni personnes. Réponds uniquement avec un tableau JSON de "
                      f"{len(chunk)} chaînes, dans le même ordre.\n\n" + json.dumps(chunk, ensure_ascii=False))
            text = extras.gemini_call({"contents": [{"parts": [{"text": prompt}]}],
                                       "generationConfig": {"temperature": 0, "responseMimeType": "application/json"}})
            res = json.loads(text)
            if not isinstance(res, list) or len(res) != len(chunk):
                raise RuntimeError("Gemini : réponse incomplète")
            out += [str(x) for x in res]
            time.sleep(7)
        return out

    def _gtx(self, text):
        for attempt in range(3):
            r = requests.post(
                "https://translate.googleapis.com/translate_a/single",
                params={"client": "gtx", "sl": "auto", "tl": "fr", "dt": "t"},
                data={"q": text}, headers={"User-Agent": UA}, timeout=30,
            )
            if r.status_code == 429:
                time.sleep([12, 30, 60][attempt])
                continue
            r.raise_for_status()
            out = "".join(seg[0] for seg in r.json()[0] if seg and seg[0])
            if not out:
                raise RuntimeError("réponse vide")
            return out
        raise RuntimeError("trop de demandes (429)")

    def _google(self, texts):
        """Traduit par paquets d'environ 3 000 caractères, une demande toutes les 0,4 s."""
        out = list(texts)
        fails = 0
        streak = 0
        i = 0
        started = time.time()
        while i < len(texts):
            if streak >= 2 or time.time() - started > 420:
                fails += len(texts) - i  # le reste attend le prochain passage
                break
            j, size = i, 0
            while j < len(texts) and (j == i or size + len(texts[j]) < 3000):
                size += len(texts[j]) + 1
                j += 1
            chunk = [t.replace("\n", " ") for t in texts[i:j]]
            try:
                res = self._gtx("\n".join(chunk)).split("\n")
                if len(res) != len(chunk):
                    res = []
                    for t in chunk:
                        res.append(self._gtx(t))
                        time.sleep(0.3)
                out[i:j] = [r.strip() or t for r, t in zip(res, chunk)]
                streak = 0
            except Exception as exc:
                self.last_error = f"google: {exc}"
                fails += j - i
                streak += 1
            time.sleep(1.5)
            i = j
        if fails == len(texts):
            raise RuntimeError(f"Google Traduction ne répond pas ({self.last_error})")
        return out

    def translate(self, texts):
        texts = [t if t else "" for t in texts]
        idx = [i for i, t in enumerate(texts) if t.strip()]
        if not idx:
            return texts
        payload = [texts[i] for i in idx]
        result = None
        if self.deepl_ok:
            try:
                result = self._deepl(payload)
                self.used["deepl"] += len(payload)
            except Exception as exc:
                log("DeepL indisponible, bascule :", exc)
                self.errors.append(f"deepl: {exc}"[:300])
                self.deepl_ok = False
        if result is None and self.gemini_ok:
            try:
                result = self._gemini(payload)
                self.used["gemini"] += len(payload)
            except Exception as exc:
                log("Gemini indisponible, bascule sur Google :", exc)
                self.errors.append(f"gemini: {exc}"[:300])
                self.gemini_ok = False
        if result is None:
            try:
                result = self._google(payload)
                self.used["google"] += len(payload)
            except Exception as exc:
                log("Traduction impossible :", exc)
                self.used["aucune"] += len(payload)
                return texts
        out = list(texts)
        for i, t in zip(idx, result):
            out[i] = t
        return out


def translate_items(items, tr):
    waiting = [it for it in items if "title" not in it or it.get("pending")]
    for it in waiting:
        if it["lang"] == "fr":
            it["title"], it["summary"], it["translated"] = it["title_orig"], it["summary_orig"], False
            it.pop("pending", None)
    rest = [it for it in waiting if it["lang"] != "fr"]
    # le surplus attend le prochain passage (affiché en version originale d'ici là)
    for it in rest[MAX_NEW_TRANSLATE:]:
        it["title"], it["summary"], it["translated"], it["pending"] = it["title_orig"], it["summary_orig"], False, True
    rest = rest[:MAX_NEW_TRANSLATE]
    for i in range(0, len(rest), 40):
        chunk = rest[i:i + 40]
        texts = []
        for it in chunk:
            texts += [it["title_orig"], it["summary_orig"]]
        res = tr.translate(texts)
        for j, it in enumerate(chunk):
            it["title"], it["summary"] = res[2 * j], res[2 * j + 1]
            it["translated"] = res[2 * j] != it["title_orig"]
            tries = it.get("tries", 0) + 1
            if it["translated"] or tries >= 3:
                it.pop("pending", None)
                it.pop("tries", None)
            else:
                it["pending"], it["tries"] = True, tries


# ---------- doublons ----------

def words(text):
    text = re.sub(r"[^\w\s]", " ", text.lower())
    return {w for w in text.split() if len(w) > 2 and w not in STOP}


def group_items(items):
    """Regroupe les infos qui parlent de la même chose (sur 48 h)."""
    prio = {"officiel": 0, "site": 1, "video": 2, "bluesky": 3, "reddit": 4}
    result = []
    items.sort(key=lambda x: x["published"])
    sets = [words(it["title"]) | words(it["title_orig"]) for it in items]
    groups = []  # [indice canonique, ensemble de mots, membres]
    for i, it in enumerate(items):
        placed = False
        for g in groups:
            c = items[g[0]]
            if abs(it["published"] - c["published"]) > 48 * 3600:
                continue
            a, b = sets[i], g[1]
            if not a or not b:
                continue
            inter = len(a & b)
            if inter >= 3 and inter / min(len(a), len(b)) >= 0.6:
                g[2].append(i)
                placed = True
                break
        if not placed:
            groups.append([i, set(sets[i]), [i]])
    for g in groups:
        members = sorted(g[2], key=lambda k: (prio.get(items[k]["kind"], 9), items[k]["published"]))
        head = items[members[0]]
        head["group"] = None
        head["also"] = [
            {"source": items[k]["source"], "url": items[k]["url"], "title": items[k]["title"]}
            for k in members[1:]
        ]
        if not head.get("image"):
            head["image"] = next((items[k]["image"] for k in members if items[k].get("image")), None)
        if not head.get("video"):
            head["video"] = next((items[k]["video"] for k in members if items[k].get("video")), None)
        head["rumor"] = any(items[k]["rumor"] for k in members) and not any(items[k]["kind"] == "officiel" for k in members)
        head["platforms"] = sorted({p for k in members for p in items[k]["platforms"]})
        for k in members[1:]:
            items[k]["group"] = head["id"]
        result.append((head, [items[k] for k in members]))
    return result


# ---------- audio ----------

async def _speak(text, path):
    import edge_tts
    last = None
    for voice in VOICES:
        try:
            await edge_tts.Communicate(text, voice, rate="+4%").save(str(path))
            if path.exists() and path.stat().st_size > 2000:
                return voice
        except Exception as exc:
            last = exc
    raise RuntimeError(last or "audio vide")


def spoken_text(it):
    t = f"{it['title']}. {it.get('summary') or ''}"
    t = re.sub(r"https?://\S+", "", t)
    t = t.replace("&", " et ").replace("#", "").replace("*", "")
    t = re.sub(r"\s+", " ", t).strip()
    return f"Source : {it['source']}. {t}"


def make_audio(items, out_dir):
    audio_dir = out_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    keep, todo = set(), []
    heads = sorted([it for it in items if not it.get("group")], key=lambda x: -x["published"])
    for it in heads:
        path = audio_dir / f"{it['id']}.mp3"
        if it.get("pending"):
            continue
        if path.exists():
            it["audio"] = True
            keep.add(path.name)
        elif len(todo) < MAX_NEW_AUDIO:
            todo.append((it, path))

    async def run_all():
        sem = asyncio.Semaphore(5)

        async def one(it, path):
            async with sem:
                try:
                    await _speak(spoken_text(it), path)
                    return it, path, True
                except Exception as exc:
                    log("Audio impossible pour", it["id"], exc)
                    return it, path, False
        return await asyncio.gather(*(one(it, p) for it, p in todo))

    made = 0
    for it, path, ok in (asyncio.run(run_all()) if todo else []):
        it["audio"] = ok
        if ok:
            keep.add(path.name)
            made += 1
        elif path.exists():
            path.unlink()
    for f in audio_dir.glob("*.mp3"):
        if f.name not in keep:
            f.unlink()
    return made


# ---------- principal ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--input", help="fichier JSON d'entrées brutes (tests hors ligne)")
    args = ap.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    feed_path = out_dir / "feed.json"

    old = {}
    if feed_path.exists():
        try:
            for it in json.loads(feed_path.read_text("utf-8")).get("items", []):
                old[it["id"]] = it
        except Exception as exc:
            log("Ancien fil illisible, on repart de zéro :", exc)

    sources = json.loads((ROOT / "sources.json").read_text("utf-8"))["sources"]
    status = {}
    fresh = []
    if args.input:
        fresh = json.loads(Path(args.input).read_text("utf-8"))
        status["test"] = {"ok": True, "count": len(fresh)}
    else:
        with ThreadPoolExecutor(max_workers=8) as pool:
            for src, (entries, st) in zip(sources, pool.map(fetch_source, sources)):
                status[src["name"]] = st
                fresh += entries
                log(f"{src['name']:<26} {'ok' if st['ok'] else 'ERREUR'} {st.get('count', st.get('error'))}")

    now = int(time.time())
    merged = dict(old)
    for e in fresh:
        if e["id"] in merged:
            # on garde la traduction déjà faite, on rafraîchit les médias
            for k in ("image", "video"):
                if e.get(k) and not merged[e["id"]].get(k):
                    merged[e["id"]][k] = e[k]
            continue
        e["published"] = min(e["published"], now)
        e["first_seen"] = now
        merged[e["id"]] = e

    names = {s["name"] for s in sources}
    items = [it for it in merged.values()
             if now - it["published"] < KEEP_HOURS * 3600
             and (it["source"] in names or it["source"].startswith("r/") or args.input)]
    items.sort(key=lambda x: -x["published"])
    items = items[:MAX_ITEMS]

    tr = Translator()
    translate_items(items, tr)
    for it in items:
        plats, rumor = tags_for(f"{it['title_orig']} {it['summary_orig']} {it['source']}")
        it["platforms"], it["rumor"] = plats, rumor or it["source"] == "r/GamingLeaksAndRumours"
    groups = group_items(items)

    # fiabilité, articles de rumeurs, illustrations
    table = extras.source_reliability(sources)
    ia = {"ia_left": 25, "ia_used": 0, "error": None}
    igdb = extras.Igdb()
    recent = sorted(groups, key=lambda g: -g[0]["published"])
    for n, (head, members) in enumerate(recent):
        head["reliability"] = extras.rate_item(head, members, table)
        if head["rumor"] or (head.get("article") and head["article"].get("status") == "rumeur"):
            extras.write_rumor(head, members, table, ia)
            if head["article"]["status"] == "confirme":
                head["rumor"] = False
        elif "article" in head:
            del head["article"]
        wants_art = head["rumor"] or n < 12
        if head.get("game") and extras.generic_name(head["game"]):
            for k in ("game", "gallery", "cover", "trailer"):
                head.pop(k, None)
        if wants_art and igdb.ok and not head.get("igdb_done") and not args.input:
            head["igdb_done"] = True
            head.pop("igdb_tried", None)
            igdb.illustrate(head)

    made = 0
    if not args.no_audio:
        made = make_audio(items, out_dir)

    # V3 : historique des rumeurs, sorties à venir, Game Pass
    heads_now = [h for h, _ in groups]
    n_rumors = extras.update_rumor_history(out_dir / "rumors.json", heads_now, now)
    n_releases = None if args.input else extras.igdb_releases(igdb, out_dir / "releases.json", now)
    gamepass = None if args.input else extras.gamepass_catalog(out_dir / "gamepass.json", now)

    # brief du matin
    brief_path = out_dir / "brief.json"
    old_brief = None
    if brief_path.exists():
        try:
            old_brief = json.loads(brief_path.read_text("utf-8"))
        except Exception:
            old_brief = None
    brief, is_new = extras.build_brief(items, old_brief)
    if brief:
        mp3 = out_dir / "brief.mp3"
        if (is_new or not brief.get("audio")) and not args.no_audio:
            try:
                asyncio.run(_speak(brief["text"], mp3))
                brief["audio"] = True
            except Exception as exc:
                log("Audio du brief impossible :", exc)
                brief["audio"] = False
        brief_path.write_text(json.dumps(brief, ensure_ascii=False), "utf-8")

    items.sort(key=lambda x: -x["published"])
    data = {
        "version": 1,
        "updated": now,
        "count": len(items),
        "items": items,
    }
    feed_path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (out_dir / "status.json").write_text(json.dumps({
        "updated": now,
        "sources": status,
        "translation": tr.used,
        "translation_error": tr.last_error,
        "translation_errors": tr.errors,
        "rumors_ai": ia["ia_used"],
        "extras_errors": [e for e in (ia["error"], igdb.error) if e],
        "igdb": igdb.ok,
        "brief": brief.get("date") if brief else None,
        "rumors_tracked": n_rumors,
        "releases": n_releases,
        "gamepass": gamepass,
        "audio_new": made,
    }, ensure_ascii=False, indent=1), "utf-8")
    heads = sum(1 for it in items if not it.get("group"))
    log(f"Fil : {len(items)} entrées, {heads} infos après regroupement, {made} nouveaux audios, traduction {tr.used}")


if __name__ == "__main__":
    main()
