"""Today's restaurant landscape from OpenStreetMap (live, free, ODbL licence).

1. Fetch every food place mapped in Bangalore (Overpass API).
2. Find each Zomato area's centre (Nominatim geocoder; cached in
   analysis/area_coords.json so we ask only once per area).
3. Count places within RADIUS_KM of each centre, by type and by cuisine,
   using the same cuisine names as the Zomato data.

Writes web/public/data/osm.json. If a previous osm.json exists, its counts are
kept as "previous" so the site can show change since the last refresh.

Run:  .venv/bin/python -I analysis/osm.py            (live fetch)
      .venv/bin/python -I analysis/osm.py --cached   (reuse today's download)
OpenStreetMap coverage is volunteer-made and incomplete: treat counts as
"mapped today", a lower bound, not the full market.
"""

from __future__ import annotations

import json
import math
import ssl
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import certifi

ROOT = Path(__file__).resolve().parent.parent
COORDS = Path(__file__).resolve().parent / "area_coords.json"
OUT = ROOT / "web" / "public" / "data" / "osm.json"
UA = "LaunchLab-Bangalore student project (github.com/divyabasavraj/launchlab-bangalore)"
BBOX = (12.80, 77.40, 13.15, 77.80)  # south, west, north, east
RADIUS_KM = 1.2
MAX_STALE_DAYS = 3  # some mirrors lag months behind; never publish their data as "today"
SSL = ssl.create_default_context(cafile=certifi.where())
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.private.coffee/api/interpreter"]

# Zomato area names that the geocoder knows under a different spelling.
ALIASES = {"Sadashiv Nagar": "Sadashivanagar", "ITPL Main Road, Whitefield": "ITPL, Whitefield",
           "Thippasandra": "New Thippasandra", "Old Airport Road": "HAL Old Airport Road"}

# OpenStreetMap cuisine tag -> Zomato cuisine name
CUISINE_MAP = {
    "north_indian": "North Indian", "punjabi": "North Indian", "south_indian": "South Indian", "chinese": "Chinese",
    "noodle": "Chinese", "pizza": "Pizza", "burger": "Burger", "coffee_shop": "Cafe", "coffee": "Cafe", "juice": "Juices",
    "chicken": "Fast Food", "fast_food": "Fast Food", "sandwich": "Fast Food", "ice_cream": "Ice Cream", "asian": "Asian",
    "italian": "Italian", "pasta": "Italian", "tea": "Beverages", "bubble_tea": "Beverages", "mexican": "Mexican",
    "tex-mex": "Mexican", "american": "American", "kebab": "North Indian", "barbecue": "BBQ", "andhra": "Andhra",
    "thai": "Thai", "korean": "Asian", "japanese": "Asian", "arab": "Arabian", "arabic": "Arabian", "lebanese": "Arabian",
    "shawarma": "Arabian", "biryani": "Biryani", "biriyani": "Biryani", "seafood": "Seafood", "fish": "Seafood",
    "kerala": "Kerala", "momo": "Momos", "momos": "Momos", "dessert": "Desserts", "cake": "Desserts", "donut": "Desserts",
    "chaat": "Street Food", "street_food": "Street Food", "mediterranean": "Mediterranean", "french": "European",
    "continental": "Continental", "international": "Continental", "mughlai": "Mughlai", "chettinad": "Chettinad",
    "roll": "Rolls", "rolls": "Rolls", "kathi_roll": "Rolls", "salad": "Salad", "healthy": "Healthy Food",
    "bakery": "Bakery", "sweets": "Mithai", "mithai": "Mithai",
    "indian": "Indian (unspecified)", "regional": "Indian (unspecified)",  # OSM often just says "indian"
}


CACHE = ROOT / "data" / "osm" / "places.json"


def fetch_places(use_cache: bool) -> tuple[list[dict], str]:
    """Live fetch; with use_cache, reuse a download made in the last 24 hours."""
    if use_cache and CACHE.exists() and time.time() - CACHE.stat().st_mtime < 86400:
        d = json.loads(CACHE.read_text())
        return d["elements"], d.get("osm3s", {}).get("timestamp_osm_base", "")
    # Ask for the city in 4 quarters: small requests survive busy servers far better.
    s, w, n, e = BBOX
    mid_lat, mid_lon = (s + n) / 2, (w + e) / 2
    tiles = [(s, w, mid_lat, mid_lon), (s, mid_lon, mid_lat, e), (mid_lat, w, n, mid_lon), (mid_lat, mid_lon, n, e)]
    elements, seen, stamp = [], set(), ""
    for t in tiles:
        q = ('[out:json][timeout:90];nwr["amenity"~"^(restaurant|fast_food|cafe|food_court|ice_cream|bar|pub|biergarten)$"]'
             f"({t[0]},{t[1]},{t[2]},{t[3]});out center tags;")
        body = urllib.parse.urlencode({"data": q}).encode()
        d = None
        for attempt in range(4):
            for ep in OVERPASS:
                try:
                    req = urllib.request.Request(ep, data=body, headers={"User-Agent": UA})
                    with urllib.request.urlopen(req, timeout=120, context=SSL) as r:
                        got = json.load(r)
                    ts = got.get("osm3s", {}).get("timestamp_osm_base", "")
                    age = (datetime.now(timezone.utc) - datetime.fromisoformat(ts.replace("Z", "+00:00"))).days if ts else 999
                    if age > MAX_STALE_DAYS:
                        print(f"  tile {t}: {ep}: data is {age} days old, skipping this mirror")
                        continue
                    d = got
                    break
                except Exception as err:  # busy servers are common; try the next mirror
                    print(f"  tile {t}: {ep}: {err}")
            if d:
                break
            time.sleep(30 * (attempt + 1))
        if not d:
            raise RuntimeError("all Overpass servers failed")
        ts = d.get("osm3s", {}).get("timestamp_osm_base", "")
        stamp = min(stamp, ts) if stamp else ts  # label with the oldest tile's date: always honest
        for el in d["elements"]:
            if (el["type"], el["id"]) not in seen:  # a place on a tile border comes back twice
                seen.add((el["type"], el["id"]))
                elements.append(el)
        time.sleep(2)
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({"elements": elements, "osm3s": {"timestamp_osm_base": stamp}}))
    return elements, stamp


def geocode(areas: list[str]) -> dict[str, list[float]]:
    coords = json.loads(COORDS.read_text()) if COORDS.exists() else {}
    s, w, n, e = BBOX
    for a in areas:
        if a in coords:
            continue
        name = ALIASES.get(a, a)
        for q in (f"{name}, Bengaluru, Karnataka, India", f"{name}, Bangalore, India"):
            url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "json", "limit": 6})
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30, context=SSL) as r:
                res = json.load(r)
            time.sleep(1.1)  # Nominatim usage policy: max 1 request per second
            res = [x for x in res if s <= float(x["lat"]) <= n and w <= float(x["lon"]) <= e]
            # Prefer neighbourhoods/suburbs over railway stations, shops or bus stops with the same name.
            res.sort(key=lambda x: 0 if x.get("class") in ("place", "boundary") else 1 if x.get("class") == "highway" else 2)
            if res:
                coords[a] = [round(float(res[0]["lat"]), 5), round(float(res[0]["lon"]), 5)]
                break
        print(f"  {a}: {coords.get(a, 'NOT FOUND')}")
    COORDS.write_text(json.dumps(coords, indent=1, ensure_ascii=False))
    return coords


def km(a, b) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def cuisines_of(tags: dict) -> set[str]:
    out = {CUISINE_MAP[t.strip().lower()] for t in tags.get("cuisine", "").split(";") if t.strip().lower() in CUISINE_MAP}
    if not out and tags.get("amenity") == "cafe":
        out.add("Cafe")
    if not out and tags.get("amenity") == "ice_cream":
        out.add("Ice Cream")
    return out


def main() -> None:
    areas = json.loads((ROOT / "web" / "public" / "data" / "model.json").read_text())["model"]["areas"]
    print("geocoding areas ...")
    coords = geocode(areas)
    print("fetching OpenStreetMap places ...")
    elements, osm_time = fetch_places(use_cache="--cached" in sys.argv)
    places = []
    for el in elements:
        lat = el.get("lat", el.get("center", {}).get("lat"))
        lon = el.get("lon", el.get("center", {}).get("lon"))
        if lat is None:
            continue
        t = el.get("tags", {})
        places.append({"pos": (lat, lon), "amenity": t.get("amenity"), "cuisines": cuisines_of(t), "tagged": "cuisine" in t})

    previous = {}
    if OUT.exists():
        old = json.loads(OUT.read_text())
        previous = {a: v["total"] for a, v in old.get("areas", {}).items()}
        previous_time = old.get("fetched_at")
    else:
        previous_time = None

    by_area = {}
    for a in areas:
        if a not in coords:
            continue
        near = [p for p in places if km(coords[a], p["pos"]) <= RADIUS_KM]
        cu = Counter(q for p in near for q in p["cuisines"])
        by_area[a] = {
            "lat": coords[a][0], "lon": coords[a][1], "total": len(near),
            "previous": previous.get(a),
            "types": dict(Counter(p["amenity"] for p in near)),
            "cuisines": dict(cu.most_common()),
            "tagged_share": round(sum(p["tagged"] for p in near) / len(near), 3) if near else 0.0,
        }

    city_cu = Counter(q for p in places for q in p["cuisines"])
    out = {
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "osm_data_time": osm_time, "previous_fetched_at": previous_time,
        "radius_km": RADIUS_KM, "total": len(places),
        "types": dict(Counter(p["amenity"] for p in places)),
        "cuisines": dict(city_cu.most_common()),
        "tagged_share": round(sum(p["tagged"] for p in places) / len(places), 3),
        "areas": by_area,
        "attribution": "© OpenStreetMap contributors, ODbL",
    }
    OUT.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print(f"{len(places):,} places; {len(by_area)}/{len(areas)} areas located; OSM data as of {osm_time}")


if __name__ == "__main__":
    main()
