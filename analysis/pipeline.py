"""Build everything the website needs.

Run:  .venv/bin/python -I analysis/clean.py && .venv/bin/python -I analysis/pipeline.py
Writes web/public/data/{market,reviews,model}.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import insights  # noqa: E402
import model  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "data"


def main() -> None:
    df = pd.read_parquet(ROOT / "data" / "parquet" / "restaurants.parquet")
    for c in ["rest_types", "cuisines", "listed_in"]:
        df[c] = df[c].map(list)
    reviews = pd.read_parquet(ROOT / "data" / "parquet" / "reviews.parquet")

    print("market insights ...")
    market = insights.market(df)
    print("review themes ...")
    themes = insights.review_themes(reviews, df)
    print("models (5-fold, grouped by brand) ...")
    models = model.run(df)

    OUT.mkdir(parents=True, exist_ok=True)
    for name, obj in {"market": market, "reviews": themes, "model": models}.items():
        (OUT / f"{name}.json").write_text(json.dumps(obj, separators=(",", ":"), default=float))

    print(json.dumps(market["totals"], indent=1))
    print(pd.DataFrame(market["by_price"]).round(2).to_string(index=False))
    print(pd.DataFrame(market["online"]).round(2).to_string(index=False))
    print(pd.DataFrame(market["by_chain"]).round(2).to_string(index=False))
    print(pd.DataFrame(market["by_cuisine"]).head(8).to_string(index=False))
    print(pd.DataFrame(market["by_cuisine"]).tail(5).to_string(index=False))
    print(pd.DataFrame(themes["themes"]).round(3).to_string(index=False), themes["n_low"], themes["n_high"])


if __name__ == "__main__":
    main()
