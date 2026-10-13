# LaunchLab Bangalore: predict a restaurant's success before it opens

**Opening a restaurant in Bangalore? Enter a concept (area, cuisines, format, price, delivery) and machine-learning models predict its Zomato rating and its chance of becoming popular, then rank the best areas to open in.**

Built on **12,430 real Bangalore restaurants** and **1,25,908 customer reviews** from Zomato (public 2019 snapshot on Kaggle).

## The models
| Prediction | Model | How good (tested on restaurants it never saw) |
|---|---|---|
| **Popularity**: will it reach the top 25% by votes? | Gradient-boosted trees | **AUC 0.82** (logistic regression 0.81) |
| **Rating** | Gradient-boosted trees | Typical error **±0.29★**, 83% within ±0.5★ (guessing the area average: ±0.33★) |

- **Inputs are only pre-launch decisions.** Votes, reviews and "dishes liked" are excluded, since using them would leak the answer.
- **Honest testing:** 5-fold cross-validation **grouped by brand**, so all outlets of a chain sit in the same fold and the model can't just remember a sibling branch.
- **The models run in the browser.** The exported trees are checked against scikit-learn's predictions.

**Key takeaway:** concept and location predict **popularity** well, but **rating** only modestly. Ratings depend mostly on execution, and the reviews show which parts of execution matter.

## Findings
- **Price:** ₹1,500+ places average **4.14★** and 424 median votes; under ₹300: 3.55★ and 23 votes.
- **Online ordering** goes with **2–3× more votes at every price level** (an association, not proven cause).
- **Crowded and lower-rated:** Chinese, Biryani, Rolls, Andhra. **Highest-rated:** Mediterranean, European, Asian.
- **Chains** don't rate higher (3.6★ for all sizes); they just get more visibility.
- **Reviews:** "bad taste" appears in 11.6% of 1–2★ reviews vs 0.8% of 4–5★. Rude service, late delivery, hygiene and wrong items also separate bad from good. **Price and portion complaints appear equally in good reviews**, so they don't separate winners from losers.

## Marketing decisions it supports
1. Screen concepts on predicted popularity before investing.
2. Get on delivery from day one, because visibility is the first problem.
3. Choose the area with competition in view (the location finder shows both).
4. Avoid crowded low-rated categories, or differentiate within them.
5. Spend on taste and service, not discounts.

## Limitations
Correlational data (no experiments); votes also grow with restaurant age (no opening dates); a 2019 snapshot of one city; rating predictions are for comparing concepts, not promises.

## Run it
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
# download: kagglehub.dataset_download("himanshupoddar/zomato-bangalore-restaurants") -> data/raw/zomato.csv
.venv/bin/python -I analysis/clean.py      # one row per restaurant + parsed reviews
.venv/bin/python -I analysis/pipeline.py   # insights + models -> web/public/data/*.json
cd web && npm install && npm run dev
```
Stack: Python, pandas, scikit-learn, React + TypeScript + Vite (static site).

*Independent student project, not affiliated with Zomato.*
