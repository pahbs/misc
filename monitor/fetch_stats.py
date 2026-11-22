#!/usr/bin/env python3
"""Fetch GoatCounter stats and write them encrypted to monitor/data/stats.enc.json.

Run by .github/workflows/monitor.yml. Needs two environment variables:
  GOATCOUNTER_TOKEN   API key with "Read statistics" permission
  MONITOR_PASSPHRASE  passphrase the monitor page uses to decrypt

Encryption: PBKDF2-SHA256 (310,000 iterations) -> AES-256-GCM, which the
browser's WebCrypto can decrypt. The file is only rewritten when the stats
change, so the repo doesn't get a commit every run.
"""
import base64, datetime as dt, hashlib, hmac, json, os, sys, time, urllib.parse, urllib.request
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

SITE = "https://pahbs.goatcounter.com"
API = SITE + "/api/v0"
RANGES = [7, 30, 90, 365]
LISTS = ["toprefs", "locations", "systems", "browsers"]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "stats.enc.json")
ITER = 310_000

TOKEN = os.environ.get("GOATCOUNTER_TOKEN", "").strip()
PASS = os.environ.get("MONITOR_PASSPHRASE", "")
if not TOKEN or not PASS:
    sys.exit("GOATCOUNTER_TOKEN and MONITOR_PASSPHRASE must both be set (repo Settings -> Secrets and variables -> Actions).")


def get(path, **params):
    q = []
    for k, v in params.items():
        for x in (v if isinstance(v, list) else [v]):
            q.append((k, str(x)))
    url = f"{API}{path}?{urllib.parse.urlencode(q)}"
    for attempt in range(5):
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                time.sleep(0.3)  # stay well under the API rate limit
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(int(e.headers.get("Retry-After", "3")) + 1)
                continue
            if e.code in (401, 403):
                sys.exit(f"GoatCounter rejected the key ({e.code}). It needs 'Read statistics' permission.")
            raise
    raise RuntimeError(f"Gave up after repeated rate limiting: {path}")


def decrypt_previous():
    """Return the previously saved stats (for the coordinate cache), or {}."""
    try:
        with open(OUT) as f:
            blob = json.load(f)
        key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=base64.b64decode(blob["salt"]), iterations=blob["iter"]).derive(PASS.encode())
        return json.loads(AESGCM(key).decrypt(base64.b64decode(blob["iv"]), base64.b64decode(blob["ct"]), None))
    except Exception:
        return {}


# ---------- coordinates for the map ----------
UA = {"User-Agent": "pahbs-site-monitor/1.0 (https://github.com/pahbs/misc)"}
geocache = decrypt_previous().get("geocache", {})
_countries = None


def country_coords(code, name):
    """Country centroid from the world-countries dataset, else geocode the name."""
    global _countries
    if _countries is None:
        try:
            req = urllib.request.Request("https://cdn.jsdelivr.net/npm/world-countries/countries.json", headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                _countries = {c["cca2"]: c.get("latlng") for c in json.load(r) if c.get("cca2")}
        except Exception as e:
            print("Couldn't load country centroids:", e)
            _countries = {}
    ll = _countries.get((code or "").upper())
    return ll if ll and len(ll) == 2 else geocode(name)


def geocode(q):
    """Look a place name up on OpenStreetMap Nominatim (cached; at most 1 request/second)."""
    if not q:
        return None
    if q in geocache:
        return geocache[q]
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "json", "limit": 1})
    ll = None
    try:
        time.sleep(1.1)
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            res = json.load(r)
            if res:
                ll = [round(float(res[0]["lat"]), 4), round(float(res[0]["lon"]), 4)]
    except Exception as e:
        print(f"Geocoding failed for {q!r}: {e}")
        return None  # don't cache failures; try again next run
    geocache[q] = ll
    return ll


def map_points(days):
    """Visitors by region (or by country when GoatCounter has no region), with coordinates."""
    pts = []
    countries = get("/stats/locations", **span(days), limit=20).get("stats", [])
    for c in countries:
        cid, cname, cn = c.get("id") or "", c.get("name") or "", c.get("count", 0)
        if not cn or not cid:
            continue
        regions = []
        try:
            regions = [r for r in get(f"/stats/locations/{urllib.parse.quote(cid)}", **span(days), limit=50).get("stats", []) if r.get("count")]
        except Exception as e:
            print(f"No region detail for {cid}: {e}")
        named = [r for r in regions if (r.get("name") or "").strip() and (r.get("name") or "").strip().lower() not in ("unknown", "(unknown)")]
        placed = 0
        for r in named:
            ll = geocode(f"{r['name']}, {cname}")
            if ll:
                pts.append({"name": r["name"], "country": cname, "lat": ll[0], "lon": ll[1], "n": r["count"]})
                placed += r["count"]
        rest = cn - placed
        if rest > 0:
            ll = country_coords(cid, cname)
            if ll:
                pts.append({"name": cname if not placed else f"{cname} (region unknown)", "country": cname, "lat": ll[0], "lon": ll[1], "n": rest, "country_level": True})
    return pts


def hour(t):
    return t.replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


now = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
end = hour(now)
span = lambda days, back=0: {"start": hour(now - dt.timedelta(days=days * (back + 1))), "end": hour(now - dt.timedelta(days=days * back))}

data = {"site": SITE, "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "ranges": {}}

# Daily site-wide visitors for the past year
tot = get("/stats/total", **span(365))
data["daily"] = [{"day": s["day"], "n": s.get("daily", 0)} for s in tot.get("stats", []) if s.get("day")]

# Every page, with its daily visitors for the past year
paths, offset_more = [], True
hits = get("/stats/hits", **span(365), limit=100)
for h in hits.get("hits", []):
    if h.get("event"):
        continue
    paths.append({
        "id": h.get("path_id"), "path": h.get("path"), "title": h.get("title") or "",
        "daily": {s["day"]: s.get("daily", 0) for s in h.get("stats", []) if s.get("day") and s.get("daily")},
    })
data["paths"] = paths

# Totals (with the period before, for comparison) and top lists for each range
for days in RANGES:
    cur, prev = get("/stats/total", **span(days)), get("/stats/total", **span(days, 1))
    r = {"total": cur.get("total", 0), "prev": prev.get("total", 0)}
    for page in LISTS:
        res = get(f"/stats/{page}", **span(days), limit=10)
        r[page] = [{"name": s.get("name") or "", "n": s.get("count", 0)} for s in res.get("stats", []) if s.get("count")]
    r["map"] = map_points(days)
    data["ranges"][str(days)] = r
data["geocache"] = geocache

# Skip rewriting when nothing but the timestamp changed
body = {k: v for k, v in data.items() if k != "generated_at"}
plain_body = json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
fingerprint = hmac.new(PASS.encode(), plain_body, hashlib.sha256).hexdigest()
try:
    with open(OUT) as f:
        if json.load(f).get("fp") == fingerprint:
            print("Stats unchanged; not rewriting.")
            sys.exit(0)
except (FileNotFoundError, ValueError):
    pass

salt, iv = os.urandom(16), os.urandom(12)
key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(PASS.encode())
ct = AESGCM(key).encrypt(iv, json.dumps(data, separators=(",", ":")).encode(), None)
b64 = lambda b: base64.b64encode(b).decode()
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump({"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct), "fp": fingerprint}, f)
print(f"Wrote {OUT}: {len(paths)} pages, {data['ranges']['30']['total']} visitors in the last 30 days.")
