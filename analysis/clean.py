"""Turn the raw Zomato export into one clean row per restaurant.

The raw file lists a restaurant once per Zomato category it appears in
(Delivery, Dine-out, Cafes...), so 51,717 rows are really ~12,500 restaurants.

Writes data/parquet/restaurants.parquet and data/parquet/reviews.parquet.
Run:  .venv/bin/python -I analysis/clean.py
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "zomato.csv"
OUT = ROOT / "data" / "parquet"


def parse_rating(v) -> float:
    m = re.match(r"\s*(\d(?:\.\d)?)\s*/\s*5", str(v))
    return float(m.group(1)) if m else np.nan  # "NEW", "-", missing -> not rated yet


def parse_cost(v) -> float:
    try:
        return float(str(v).replace(",", ""))
    except ValueError:
        return np.nan


def split_list(v) -> list[str]:
    return [s.strip() for s in str(v).split(",") if s.strip() and str(v) != "nan"]


def parse_reviews(v) -> list[tuple[float, str]]:
    """reviews_list is a printed Python list of ("Rated 4.0", "RATED\\n  text") tuples.
    literal_eval only parses literals; it never runs code."""
    try:
        items = ast.literal_eval(v) if isinstance(v, str) else []
    except (ValueError, SyntaxError):
        return []
    out = []
    for stars, text in items:
        m = re.search(r"(\d(?:\.\d)?)", str(stars))
        text = re.sub(r"^RATED\s*", "", str(text)).strip()
        if m and text:
            out.append((float(m.group(1)), text))
    return out


def main() -> None:
    raw = pd.read_csv(RAW)
    raw["key"] = raw.name.str.strip() + " | " + raw.address.str.strip()

    # Zomato categories a restaurant is listed under become yes/no columns.
    listed = (raw.groupby("key")["listed_in(type)"].agg(lambda s: sorted(set(s))))

    first = raw.drop_duplicates("key").set_index("key")
    df = pd.DataFrame({
        "name": first.name.str.strip(),
        "area": first.location,
        "zone": raw.groupby("key")["listed_in(city)"].agg(lambda s: s.mode().iat[0]),
        "rest_types": first.rest_type.map(split_list),
        "cuisines": first.cuisines.map(split_list),
        "cost_for_two": first["approx_cost(for two people)"].map(parse_cost),
        "online_order": (first.online_order == "Yes").astype(int),
        "book_table": (first.book_table == "Yes").astype(int),
        "rating": first.rate.map(parse_rating),
        "votes": first.votes.astype(int),
        "listed_in": listed,
    })
    df = df.dropna(subset=["area", "cost_for_two"])
    df = df[df.cuisines.map(len) > 0]
    # How many outlets the brand has across Bangalore (1 = independent).
    df["outlets"] = df.groupby("name").name.transform("size")

    # Reviews: keep the longest review list seen for each restaurant.
    raw["n_rev"] = raw.reviews_list.str.len().fillna(0)
    best = raw.sort_values("n_rev").drop_duplicates("key", keep="last").set_index("key")
    rows = []
    for key, v in best.reviews_list.items():
        if key not in df.index:
            continue
        for stars, text in parse_reviews(v):
            rows.append((key, stars, text))
    reviews = pd.DataFrame(rows, columns=["key", "stars", "text"]).drop_duplicates()

    OUT.mkdir(parents=True, exist_ok=True)
    df.reset_index().rename(columns={"index": "key"}).to_parquet(OUT / "restaurants.parquet", index=False)
    reviews.to_parquet(OUT / "reviews.parquet", index=False)

    print(f"{len(df):,} restaurants, {df.rating.notna().sum():,} rated, {len(reviews):,} reviews")
    print(df.describe().round(2).to_string())


if __name__ == "__main__":
    main()
