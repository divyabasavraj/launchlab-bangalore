"""Predictive models for a restaurant concept.

1. Rating model      -> predicted Zomato rating (regression)
2. Popularity model  -> chance of reaching the top 25% by votes (classification)

Inputs are only things an owner decides before opening: area, cuisines,
restaurant type, cost for two, online ordering, table booking, Zomato
categories and how many outlets the brand has. Reviews, votes and
"dishes liked" are NOT inputs; they come after launch (that would be cheating).

Testing: 5-fold cross-validation grouped by brand name, so every outlet of a
chain lands in the same fold and the model never "remembers" a sibling outlet.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import mean_absolute_error, roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

TOP_CUISINES = 40
MIN_AREA = 20  # smaller areas are grouped as "Other area"
LISTINGS = ["Delivery", "Dine-out", "Desserts", "Cafes", "Drinks & nightlife", "Buffet", "Pubs and bars"]


class Encoder:
    """Turns restaurant attributes into the model's numeric columns. The
    browser rebuilds exactly the same columns from the form."""

    def fit(self, df: pd.DataFrame) -> "Encoder":
        counts = df.area.value_counts()
        self.areas = sorted(counts[counts >= MIN_AREA].index)
        self.cuisines = list(df.cuisines.explode().value_counts().head(TOP_CUISINES).index)
        self.types = list(df.rest_types.explode().value_counts().index)
        return self

    @property
    def columns(self) -> list[str]:
        return (["cost_for_two", "online_order", "book_table", "outlets", "n_cuisines"]
                + [f"area:{a}" for a in self.areas]
                + [f"cuisine:{c}" for c in self.cuisines]
                + [f"type:{t}" for t in self.types]
                + [f"listed:{l}" for l in LISTINGS])

    def transform(self, df: pd.DataFrame) -> np.ndarray:
        X = np.zeros((len(df), len(self.columns)))
        X[:, 0] = df.cost_for_two
        X[:, 1] = df.online_order
        X[:, 2] = df.book_table
        X[:, 3] = df.outlets.clip(upper=60)
        X[:, 4] = df.cuisines.map(len)
        idx = {c: i for i, c in enumerate(self.columns)}
        for r, (area, cuisines, types, listed) in enumerate(zip(df.area, df.cuisines, df.rest_types, df.listed_in)):
            if f"area:{area}" in idx:
                X[r, idx[f"area:{area}"]] = 1
            for c in cuisines:
                if f"cuisine:{c}" in idx:
                    X[r, idx[f"cuisine:{c}"]] = 1
            for t in types:
                if f"type:{t}" in idx:
                    X[r, idx[f"type:{t}"]] = 1
            for l in listed:
                if f"listed:{l}" in idx:
                    X[r, idx[f"listed:{l}"]] = 1
        return X


GROUPS = {  # feature families for "what matters" (permutation importance)
    "Area": "area:", "Cuisines": "cuisine:", "Restaurant type": "type:", "Zomato categories": "listed:",
    "Cost for two": "cost_for_two", "Online ordering": "online_order", "Table booking": "book_table",
    "Number of outlets (chain size)": "outlets", "Number of cuisines": "n_cuisines",
}


def gbm_reg():
    return HistGradientBoostingRegressor(max_iter=250, learning_rate=0.06, max_leaf_nodes=24,
                                         min_samples_leaf=25, l2_regularization=1.0, random_state=0)


def gbm_clf():
    return HistGradientBoostingClassifier(max_iter=200, learning_rate=0.06, max_leaf_nodes=24,
                                          min_samples_leaf=25, l2_regularization=1.0, random_state=0)


def group_importance(model, X, y, cols, score, rng, repeats=3):
    """How much worse the model gets when one family of inputs is scrambled."""
    base = score(y, model, X)
    out = {}
    for name, prefix in GROUPS.items():
        j = [i for i, c in enumerate(cols) if c.startswith(prefix)]
        drops = []
        for _ in range(repeats):
            Xp = X.copy()
            Xp[:, j] = Xp[rng.permutation(len(X))][:, j]
            drops.append(score(y, model, Xp) - base)
        out[name] = float(np.mean(drops))
    return out


def export_trees(model) -> list[list[list]]:
    """Rows of [feature, threshold, missing_left, left, right, is_leaf, value]."""
    return [[[int(n["feature_idx"]), round(float(n["num_threshold"]), 6), int(n["missing_go_to_left"]),
              int(n["left"]), int(n["right"]), int(n["is_leaf"]), round(float(n["value"]), 6)]
             for n in pred.nodes]
            for (pred,) in model._predictors]


def run_trees(trees, baseline, X):
    raw = np.full(len(X), baseline)
    for tree in trees:
        for i, x in enumerate(X):
            n = tree[0]
            while not n[5]:
                n = tree[n[3] if x[n[0]] <= n[1] else n[4]]
            raw[i] += n[6]
    return raw


def run(df: pd.DataFrame) -> dict:
    rated = df[df.rating.notna()].reset_index(drop=True)
    enc = Encoder().fit(rated)
    cols = enc.columns
    X, y = enc.transform(rated), rated.rating.to_numpy()
    popular_cut = float(np.percentile(rated.votes, 75))
    yp = (rated.votes >= popular_cut).astype(int).to_numpy()
    groups = rated.name.to_numpy()
    rng = np.random.default_rng(0)

    pred = {k: np.zeros(len(rated)) for k in ["overall_mean", "area_mean", "ridge", "gbm", "p_logit", "p_gbm"]}
    importance_r, importance_p = [], []
    for fold, (tr, te) in enumerate(GroupKFold(n_splits=5).split(X, y, groups)):
        pred["overall_mean"][te] = y[tr].mean()
        area_mean = rated.iloc[tr].groupby("area").rating.mean()
        pred["area_mean"][te] = rated.iloc[te].area.map(area_mean).fillna(y[tr].mean())
        ridge = make_pipeline(StandardScaler(), Ridge(alpha=10.0)).fit(X[tr], y[tr])
        pred["ridge"][te] = ridge.predict(X[te])
        g = gbm_reg().fit(X[tr], y[tr])
        pred["gbm"][te] = g.predict(X[te])
        lg = make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000, C=0.5)).fit(X[tr], yp[tr])
        pred["p_logit"][te] = lg.predict_proba(X[te])[:, 1]
        gc = gbm_clf().fit(X[tr], yp[tr])
        pred["p_gbm"][te] = gc.predict_proba(X[te])[:, 1]
        if fold == 0:
            importance_r.append(group_importance(g, X[te], y[te], cols,
                                                 lambda yy, m, xx: mean_absolute_error(yy, m.predict(xx)), rng))
            importance_p.append(group_importance(gc, X[te], yp[te], cols,
                                                 lambda yy, m, xx: -roc_auc_score(yy, m.predict_proba(xx)[:, 1]), rng))

    def reg_metrics(p):
        err = np.abs(p - y)
        return {"mae": float(err.mean()), "within_0_3": float((err <= 0.3).mean()), "within_0_5": float((err <= 0.5).mean())}

    metrics = {
        "n_rated": int(len(rated)),
        "rating": {"Gradient boosting": reg_metrics(pred["gbm"]), "Linear (ridge) regression": reg_metrics(pred["ridge"]),
                   "Guess the area's average": reg_metrics(pred["area_mean"]),
                   "Guess the city average": reg_metrics(pred["overall_mean"])},
        "popular_cut_votes": popular_cut,
        "popularity": {"Gradient boosting": {"auc": float(roc_auc_score(yp, pred["p_gbm"]))},
                       "Logistic regression": {"auc": float(roc_auc_score(yp, pred["p_logit"]))}},
        "importance_rating": importance_r[0],
        "importance_popularity": importance_p[0],
    }
    # Predicted-vs-actual sample for a scatter chart (out-of-fold).
    sample = rng.choice(len(rated), size=min(1500, len(rated)), replace=False)
    scatter = [{"actual": float(y[i]), "predicted": round(float(pred["gbm"][i]), 3)} for i in sample]

    # Final models on all rated restaurants, exported for the browser.
    reg, clf = gbm_reg().fit(X, y), gbm_clf().fit(X, yp)
    browser = {
        "columns": cols, "areas": enc.areas, "cuisines": enc.cuisines, "types": enc.types, "listings": LISTINGS,
        "rating": {"baseline": float(np.ravel(reg._baseline_prediction)[0]), "trees": export_trees(reg)},
        "popularity": {"baseline": float(np.ravel(clf._baseline_prediction)[0]), "trees": export_trees(clf)},
    }
    check = rng.choice(len(X), 300, replace=False)
    assert np.allclose(run_trees(browser["rating"]["trees"], browser["rating"]["baseline"], X[check]),
                       reg.predict(X[check]), atol=1e-3), "rating export mismatch"
    p_check = 1 / (1 + np.exp(-run_trees(browser["popularity"]["trees"], browser["popularity"]["baseline"], X[check])))
    assert np.allclose(p_check, clf.predict_proba(X[check])[:, 1], atol=1e-3), "popularity export mismatch"

    return {"metrics": metrics, "scatter": scatter, "model": browser}
