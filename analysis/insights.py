"""Descriptive market insights, the location finder's market data, and what
customers complain about in reviews."""

from __future__ import annotations

import re

import numpy as np
import pandas as pd

PRICE_BANDS = [(0, 300, "Under ₹300"), (300, 500, "₹300–499"), (500, 800, "₹500–799"),
               (800, 1500, "₹800–1,499"), (1500, 100000, "₹1,500+")]

# Each theme is a set of words/phrases; a review "mentions" a theme if any match.
THEMES = {
    "Late delivery / long wait": r"\b(late|delay(ed)?|waited|wait(ing)? for|took (so )?long|on time|delivery time)\b",
    "Small quantity": r"\b(quantity|portion|less food|very less|too less|small portion)\b",
    "Overpriced": r"\b(overpriced|over priced|expensive|costly|not worth|value for money|pricey)\b",
    "Bad taste": r"\b(tasteless|bland|no taste|too salty|too spicy|not tasty|worst food|stale)\b",
    "Rude or slow service": r"\b(rude|slow service|bad service|poor service|staff (was|were) not|ignored)\b",
    "Hygiene": r"\b(hygiene|unhygienic|hair|dirty|insect|cockroach|unclean|food poisoning|sick)\b",
    "Cold food": r"\b(cold food|was cold|were cold|not hot|lukewarm)\b",
    "Wrong or missing items": r"\b(wrong order|wrong item|missing|not delivered|forgot)\b",
    "Packaging / spillage": r"\b(packaging|packed badly|spill(ed|t)?|leak(ed|ing)?)\b",
    "Great ambience": r"\b(ambience|ambiance|decor|vibe|music)\b",
    "Friendly staff": r"\b(friendly|courteous|polite|hospitality|attentive)\b",
}


def price_band(cost: float) -> str:
    return next(label for lo, hi, label in PRICE_BANDS if lo <= cost < hi)


def market(df: pd.DataFrame) -> dict:
    rated = df[df.rating.notna()].copy()
    rated["band"] = rated.cost_for_two.map(price_band)
    order = [b[2] for b in PRICE_BANDS]

    by_price = [{"band": b, "restaurants": int((rated.band == b).sum()),
                 "rating": float(rated[rated.band == b].rating.mean()),
                 "median_votes": float(rated[rated.band == b].votes.median())} for b in order]

    # Online ordering vs not, compared *within the same price band* (fairer).
    online = []
    for b in order:
        g = rated[rated.band == b]
        on, off = g[g.online_order == 1], g[g.online_order == 0]
        if len(on) >= 30 and len(off) >= 30:
            online.append({"band": b, "with": float(on.rating.mean()), "without": float(off.rating.mean()),
                           "n_with": int(len(on)), "n_without": int(len(off)),
                           "votes_with": float(on.votes.median()), "votes_without": float(off.votes.median())})

    chain = rated.assign(kind=np.select([rated.outlets == 1, rated.outlets <= 5], ["Independent (1 outlet)", "Small chain (2–5)"], "Large chain (6+)"))
    by_chain = [{"kind": k, "restaurants": int(len(g)), "rating": float(g.rating.mean()), "median_votes": float(g.votes.median())}
                for k, g in chain.groupby("kind")]
    by_chain.sort(key=lambda r: ["Independent (1 outlet)", "Small chain (2–5)", "Large chain (6+)"].index(r["kind"]))

    cuisines = rated.explode("cuisines")
    by_cuisine = (cuisines.groupby("cuisines").agg(restaurants=("name", "size"), rating=("rating", "mean"),
                                                   median_votes=("votes", "median"), cost=("cost_for_two", "median"))
                  .query("restaurants >= 80").sort_values("rating", ascending=False).reset_index())

    # Per area: how busy it is and what's already there (for the location finder).
    allr = df.copy()
    areas = []
    for area, g in allr.groupby("area"):
        r = g[g.rating.notna()]
        if len(g) < 20:
            continue
        areas.append({
            "area": area, "restaurants": int(len(g)),
            "rating": float(r.rating.mean()) if len(r) else None,
            "median_votes": float(r.votes.median()) if len(r) else 0.0,  # demand proxy
            "median_cost": float(g.cost_for_two.median()),
            "cuisine_counts": g.cuisines.explode().value_counts().to_dict(),
        })

    return {
        "totals": {"restaurants": int(len(df)), "rated": int(len(rated)), "areas": int(df.area.nunique()),
                   "median_cost": float(df.cost_for_two.median()), "mean_rating": float(rated.rating.mean()),
                   "online_share": float(df.online_order.mean()), "chains_share": float((df.outlets > 1).mean())},
        "by_price": by_price, "online": online, "by_chain": by_chain,
        "by_cuisine": by_cuisine.round(3).to_dict("records"),
        "areas": areas,
    }


def review_themes(reviews: pd.DataFrame) -> dict:
    low = reviews[reviews.stars <= 2].text.str.lower()
    high = reviews[reviews.stars >= 4].text.str.lower()
    rows = []
    for theme, pattern in THEMES.items():
        rx = re.compile(pattern)
        pl, ph = low.map(lambda t: bool(rx.search(t))).mean(), high.map(lambda t: bool(rx.search(t))).mean()
        rows.append({"theme": theme, "low": float(pl), "high": float(ph)})
    rows.sort(key=lambda r: r["low"] - r["high"], reverse=True)
    return {"n_low": int(len(low)), "n_high": int(len(high)), "n_reviews": int(len(reviews)), "themes": rows}
