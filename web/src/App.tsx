import { useEffect, useMemo, useState } from "react";
import { int, pct, rupees, stars } from "./format";
import { buildInsights, changedField, describe, FIELD_LABEL, liveDate, type Field } from "./insights";
import { buildPlaybook, compareAreas } from "./playbook";
import { predictPopular, predictRating } from "./predict";
import type { Concept, Data } from "./types";

function useData() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const get = (n: string) => fetch(`/data/${n}.json`).then((r) => {
      if (!r.ok) throw new Error(`${n}.json: HTTP ${r.status}`);
      return r.json();
    });
    const osm = fetch("/data/osm.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([...["market", "reviews", "model"].map(get), osm])
      .then(([market, reviews, model, osmData]) => setData({ market, reviews, model, osm: osmData }))
      .catch((e) => setError(String(e)));
  }, []);
  return { data, error };
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(() => {
    try { return (localStorage.getItem("theme") as "light" | "dark" | null) ?? null; } catch { return null; }
  });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    try { theme ? localStorage.setItem("theme", theme) : localStorage.removeItem("theme"); } catch { /* storage unavailable */ }
  }, [theme]);
  const dark = theme === "dark" || (theme === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return { dark, toggle: () => setTheme(dark ? "light" : "dark") };
}

export default function App() {
  const { data, error } = useData();
  const { dark, toggle } = useTheme();
  if (error) return <main className="page"><p className="status">Couldn't load the data ({error}).</p></main>;
  if (!data) return <main className="page"><p className="status">Loading 12,430 restaurants…</p></main>;
  return <Report data={data} dark={dark} toggleTheme={toggle} />;
}

function Report({ data, dark, toggleTheme }: { data: Data; dark: boolean; toggleTheme: () => void }) {
  const t = data.market.totals;
  const rm = data.model.metrics;
  return (
    <>
      <header className="masthead">
        <div className="page masthead-row">
          <span className="brand">Launch<em>Lab</em> <small>Bangalore</small></span>
          <nav aria-label="Sections">
            <a href="#plan">Plan a restaurant</a>
            <a href="#market">Market</a>
            <a href="#reviews">Customers</a>
            <a href="#accuracy">Accuracy</a>
            <a href="#decisions">Decisions</a>
          </nav>
          <button className="theme" onClick={toggleTheme} aria-label="Toggle dark mode">{dark ? "☀" : "☾"}</button>
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <p className="kicker">{int(t.restaurants)} real Bangalore restaurants · {t.areas} areas · {int(data.reviews.n_reviews)} customer reviews</p>
          {data.osm && <p className="live-badge"><i className="live-dot" />Live layer: {int(data.osm.total)} food places mapped on OpenStreetMap today ({liveDate(data.osm)}), refreshed weekly</p>}
          <h1>Opening a restaurant in Bangalore? <span className="accent">Predict how it will do</span> before you spend a rupee.</h1>
          <p className="lede">
            Machine-learning models trained on Zomato listings predict a new restaurant's rating and its chance of becoming popular,
            from the decisions an owner makes before opening: area, cuisine, format, price and delivery.
          </p>
          <div className="tiles">
            <div className="tile"><span className="tile-value">{rm.popularity["Gradient boosting"].auc.toFixed(2)}</span><span className="tile-label">popularity model AUC on restaurants it never saw (0.5 = coin flip, 1 = perfect)</span></div>
            <div className="tile"><span className="tile-value">±{rm.rating["Gradient boosting"].mae.toFixed(2)}★</span><span className="tile-label">typical error of the rating prediction</span></div>
            <div className="tile"><span className="tile-value">{stars(t.mean_rating)}</span><span className="tile-label">average rating · {rupees(t.median_cost)} typical cost for two</span></div>
            <div className="tile"><span className="tile-value">{pct(t.online_share)}</span><span className="tile-label">take online orders</span></div>
          </div>
        </section>

        <Planner data={data} />
        <MarketSection data={data} />
        <ReviewsSection data={data} />
        <Accuracy data={data} />
        <Decisions data={data} />
        <Method data={data} />
      </main>

      <footer className="page footer">
        <p>
          Data: <a href="https://www.kaggle.com/datasets/himanshupoddar/zomato-bangalore-restaurants">Zomato Bangalore Restaurants</a> (Kaggle, a public snapshot of
          Zomato listings from 2019). Live layer: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, ODbL. Independent student project, not affiliated with Zomato. Built with Python, scikit-learn, React.
        </p>
      </footer>
    </>
  );
}

/* ------------------------------ Planner ------------------------------ */

const PREFERRED_AREAS = ["Indiranagar", "Koramangala 5th Block", "HSR", "BTM"];
const TYPE_CHOICES = ["Quick Bites", "Casual Dining", "Cafe", "Delivery", "Dessert Parlor", "Takeaway", "Bakery", "Bar", "Pub", "Fine Dining", "Food Court", "Microbrewery", "Beverage Shop", "Kiosk", "Sweet Shop", "Lounge"];

function Planner({ data }: { data: Data }) {
  const m = data.model.model;
  const areas = m.areas;
  const types = TYPE_CHOICES.filter((x) => m.types.includes(x));
  const defaultArea = PREFERRED_AREAS.find((a) => areas.includes(a)) ?? areas[0];
  const [c, setC] = useState<Concept>({
    area: defaultArea, cuisines: ["North Indian", "Chinese"], type: "Casual Dining", cost: 600,
    online: true, booking: false, outlets: 1, listings: ["Delivery", "Dine-out"],
  });
  const [change, setChange] = useState<{ n: number; field: Field; from: string; to: string; before: [number, number]; after: [number, number]; why?: string; added: string[]; dropped: string[] } | null>(null);
  const update = (next: Concept) => {
    const field = changedField(c, next);
    if (field) {
      setChange({
        n: (change?.n ?? 0) + 1, field, from: describe(field, c), to: describe(field, next),
        before: [predictRating(m, c), predictPopular(m, c)], after: [predictRating(m, next), predictPopular(m, next)],
        why: field === "area" ? compareAreas(data.market, c, next) : undefined,
        ...(() => {
          const a = buildPlaybook(data.market, m, c, data.reviews, data.osm).actions.map((x) => x.title);
          const b = buildPlaybook(data.market, m, next, data.reviews, data.osm).actions.map((x) => x.title);
          return { added: b.filter((t) => !a.includes(t)), dropped: a.filter((t) => !b.includes(t)) };
        })(),
      });
    }
    setC(next);
  };
  const set = (patch: Partial<Concept>) => update({ ...c, ...patch });
  const insights = useMemo(() => buildInsights(data.market, data.reviews, c, data.osm), [data.market, data.reviews, c, data.osm]);
  const changedInsight = change ? insights.find((i) => i.field === change.field) : undefined;
  const playbook = useMemo(() => buildPlaybook(data.market, m, c, data.reviews, data.osm), [data.market, m, c, data.reviews, data.osm]);
  const toggleIn = (list: string[], v: string, max = 99) =>
    list.includes(v) ? list.filter((x) => x !== v) : list.length >= max ? list : [...list, v];

  const rating = predictRating(m, c);
  const popular = predictPopular(m, c);
  const mae = data.model.metrics.rating["Gradient boosting"].mae;

  const levers = useMemo(() => {
    const alt: { label: string; concept: Concept }[] = [
      { label: c.online ? "Turn off online ordering" : "Turn on online ordering", concept: { ...c, online: !c.online, listings: c.online ? c.listings.filter((l) => l !== "Delivery") : [...new Set([...c.listings, "Delivery"])] } },
      { label: c.booking ? "Remove table booking" : "Offer table booking", concept: { ...c, booking: !c.booking } },
      { label: `Price ${rupees(Math.max(100, c.cost - 200))} for two (−₹200)`, concept: { ...c, cost: Math.max(100, c.cost - 200) } },
      { label: `Price ${rupees(c.cost + 200)} for two (+₹200)`, concept: { ...c, cost: c.cost + 200 } },
    ];
    return alt.map((a) => ({ ...a, rating: predictRating(m, a.concept), popular: predictPopular(m, a.concept) }));
  }, [c, m]);

  const finder = useMemo(() => {
    const areaInfo = new Map(data.market.areas.map((a) => [a.area, a]));
    const rows = areas.map((area) => {
      const info = areaInfo.get(area);
      const competitors = info ? c.cuisines.reduce((s, q) => s + (info.cuisine_counts[q] ?? 0), 0) : 0;
      return {
        area, competitors,
        rating: predictRating(m, { ...c, area }), popular: predictPopular(m, { ...c, area }),
        restaurants: info?.restaurants ?? 0,
      };
    });
    const comp = rows.map((r) => r.competitors).sort((a, b) => a - b);
    const crowded = comp[Math.floor(comp.length * 0.75)] ?? Infinity;
    return rows.sort((a, b) => b.popular - a.popular).slice(0, 8).map((r) => ({ ...r, crowded: r.competitors >= crowded }));
  }, [c, m, areas, data.market.areas]);

  return (
    <section className="block" id="plan">
      <p className="step">The tool</p>
      <h2>Plan your restaurant</h2>
      <p className="prose">Describe the concept. Predictions update instantly. The models run right here in your browser.</p>

      <div className="planner">
        <form className="form" onSubmit={(e) => e.preventDefault()}>
          <label className="field">
            <span>Area</span>
            <select value={c.area} onChange={(e) => set({ area: e.target.value })}>
              {areas.map((a) => <option key={a}>{a}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Format</span>
            <select value={c.type} onChange={(e) => set({ type: e.target.value })}>
              {types.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <div className="field">
            <span>Cuisines <small>(pick up to 4)</small></span>
            <div className="chips">
              {m.cuisines.slice(0, 24).map((q) => (
                <button type="button" key={q} className={c.cuisines.includes(q) ? "chip on" : "chip"}
                  onClick={() => { const next = toggleIn(c.cuisines, q, 4); if (next.length) set({ cuisines: next }); }}>{q}</button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Cost for two <b>{rupees(c.cost)}</b></span>
            <input type="range" min={100} max={3000} step={50} value={c.cost} onChange={(e) => set({ cost: +e.target.value })} />
          </label>
          <div className="field row">
            <span>Online ordering</span>
            <Toggle on={c.online} onChange={(v) => set({ online: v, listings: v ? [...new Set([...c.listings, "Delivery"])] : c.listings.filter((l) => l !== "Delivery") })} />
          </div>
          <div className="field row">
            <span>Table booking</span>
            <Toggle on={c.booking} onChange={(v) => set({ booking: v })} />
          </div>
          <label className="field">
            <span>Outlets of this brand in Bangalore <b>{c.outlets === 1 ? "1 (new, independent)" : c.outlets}</b></span>
            <input type="range" min={1} max={30} step={1} value={c.outlets} onChange={(e) => set({ outlets: +e.target.value })} />
          </label>
          <div className="field">
            <span>Listed on Zomato as</span>
            <div className="chips">
              {m.listings.map((l) => (
                <button type="button" key={l} className={c.listings.includes(l) ? "chip on" : "chip"}
                  onClick={() => set({ listings: toggleIn(c.listings, l) })}>{l}</button>
              ))}
            </div>
          </div>
        </form>

        <div className="result" aria-live="polite">
          {change && (
            <div className="change" key={change.n}>
              <span className="change-kicker">Just changed · {FIELD_LABEL[change.field]}</span>
              <span className="change-what">{change.from} → <b>{change.to}</b></span>
              <span className="change-deltas">
                <Delta label="Popularity" a={change.before[1]} b={change.after[1]} fmt={(v) => pct(v)} unit="pts" scale={100} />
                <Delta label="Rating" a={change.before[0]} b={change.after[0]} fmt={stars} unit="★" scale={1} digits={2} />
              </span>
              {(change.why || changedInsight) && <span className="change-why">{change.why ?? changedInsight!.detail}</span>}
              {(change.added.length > 0 || change.dropped.length > 0) && (
                <span className="change-brief">
                  <span className="cb-title">What changed in your marketing brief</span>
                  {change.added.map((t) => <span key={t} className="cb add">＋ {t}</span>)}
                  {change.dropped.map((t) => <span key={t} className="cb drop">－ {t}</span>)}
                </span>
              )}
            </div>
          )}
          <div className="result-main">
            <div>
              <span className="result-label">Predicted rating</span>
              <span className="result-value">{stars(rating)}</span>
              <span className="result-sub">likely range {stars(rating - mae)} – {stars(Math.min(4.9, rating + mae))}</span>
            </div>
            <div>
              <span className="result-label">Chance of becoming popular</span>
              <span className="result-value pop">{pct(popular)}</span>
              <span className="result-sub">top 25% by votes (≥{int(data.model.metrics.popular_cut_votes)}) · city average 25%</span>
            </div>
          </div>
          <div className="meter" aria-hidden><div style={{ width: `${popular * 100}%` }} /><span style={{ left: "25%" }} /></div>

          <h3 className="mini">Levers you control</h3>
          <ul className="levers">
            {levers.map((l) => {
              const dp = l.popular - popular, dr = l.rating - rating;
              return (
                <li key={l.label}>
                  <button type="button" onClick={() => update(l.concept)} title="Apply this change">{l.label}</button>
                  <span className={dp >= 0 ? "delta up" : "delta down"}>{dp >= 0 ? "▲" : "▼"} {Math.abs(dp * 100).toFixed(0)} pts popular</span>
                  <span className={dr >= 0 ? "delta up" : "delta down"}>{dr >= 0 ? "▲" : "▼"} {Math.abs(dr).toFixed(2)}★</span>
                </li>
              );
            })}
          </ul>
          <p className="result-note">Click a lever to apply it. These show how similar restaurants performed, which is useful for comparing options but not a guarantee that the change alone causes the result.</p>
        </div>
      </div>

      <div className="playbook" key={`pb-${change?.n ?? 0}`}>
        <div className="pb-head">
          <span className="pb-kicker">Marketing brief · updates with every change</span>
          <p className="pb-situation">{playbook.situation}</p>
        </div>
        <div className="pb-grid">
          <div>
            <h4>What the marketing team should do</h4>
            <ol className="pb-actions">
              {playbook.actions.map((a) => (
                <li key={a.title}>
                  <span className={`prio ${a.priority === "High" ? "high" : ""}`}>{a.priority} priority</span>
                  <b>{a.title}</b>
                  <p>{a.why}</p>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h4>Where the business value is</h4>
            <p className="pb-note">Changes the model predicts would most increase your chance of becoming popular, tested against your current plan. These are estimates from how similar restaurants performed, so validate them with a small test before committing budget.</p>
            {playbook.opportunities.length === 0 ? (
              <p className="pb-empty">Your current plan is already close to the best the model can find nearby. Focus on execution: taste, service, reviews.</p>
            ) : (
              <ul className="pb-opps">
                {playbook.opportunities.map((o) => (
                  <li key={o.lever}>
                    <div className="opp-top">
                      <b>{o.lever}</b>
                      <button type="button" onClick={() => update(o.concept)}>Apply</button>
                    </div>
                    <div className="opp-bar" aria-hidden>
                      <span className="from" style={{ width: `${o.from * 100}%` }} />
                      <span className="gain" style={{ left: `${o.from * 100}%`, width: `${(o.to - o.from) * 100}%` }} />
                    </div>
                    <span className="opp-nums">
                      Popularity {pct(o.from)} → <b>{pct(o.to)}</b> <em>▲ +{((o.to - o.from) * 100).toFixed(0)} pts</em>
                      {" · "}Rating {stars(o.ratingFrom)} → {stars(o.ratingTo)} · {o.note}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <h3 className="sub">Business insights for your choices</h3>
      <p className="prose small">Live market context for every option, from the same 12,430 restaurants. Change anything above and these update.</p>
      <div className="insights">
        {insights.map((i) => (
          <article key={`${i.field}-${change?.field === i.field ? change.n : 0}`} className={`insight ${i.tone} ${change?.field === i.field ? "flash" : ""}`}>
            <span className="insight-field">{FIELD_LABEL[i.field]} <span className="tone-icon" aria-label={i.tone === "good" ? "positive" : i.tone === "warn" ? "watch out" : "context"}>{i.tone === "good" ? "▲" : i.tone === "warn" ? "!" : "•"}</span></span>
            <h4>{i.title}</h4>
            <p className="insight-headline">{i.headline}</p>
            {i.viz?.kind === "bars" && <MiniBars items={i.viz.items} />}
            {i.viz?.kind === "ladder" && <PriceLadder costs={i.viz.costs} you={i.viz.you} />}
            <ul className="facts">{i.facts.map((f) => <li key={f}>{f}</li>)}</ul>
            {i.live && data.osm && (
              <div className="live-block">
                <span className="live-tag"><i className="live-dot" />Live today · OpenStreetMap · {liveDate(data.osm)}</span>
                <ul>{i.live.map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            )}
            <p className="move"><b>Marketing move:</b> {i.move}</p>
          </article>
        ))}
      </div>

      <h3 className="sub">Where should this concept open?</h3>
      <p className="prose small">The same concept, predicted in every area. “Competitors” counts restaurants in that area already serving your cuisines.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Area</th><th className="num">Chance popular</th><th className="num">Predicted rating</th><th className="num">Competitors</th><th className="num">Restaurants in area</th>{data.osm && <th className="num">Mapped today ({data.osm.radius_km} km)</th>}</tr></thead>
          <tbody>
            {finder.map((r) => (
              <tr key={r.area} className={r.area === c.area ? "current" : ""}>
                <td><button type="button" className="link" onClick={() => set({ area: r.area })}>{r.area}</button>{r.area === c.area && <small> (selected)</small>}</td>
                <td className="num"><span className="bar-cell"><span style={{ width: `${r.popular * 100}%` }} /></span>{pct(r.popular)}</td>
                <td className="num">{stars(r.rating)}</td>
                <td className="num">{int(r.competitors)} {r.crowded && <span className="tag">crowded</span>}</td>
                <td className="num">{int(r.restaurants)}</td>
                {data.osm && <td className="num">{data.osm.areas[r.area] ? int(data.osm.areas[r.area].total) : "–"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="caption">Top 8 areas by predicted popularity. Busy food hubs score high but are crowded; a slightly lower score with fewer competitors can be the better bet. “Restaurants in area” is the 2019 Zomato count; “Mapped today” is the live OpenStreetMap count within {data.osm?.radius_km ?? 1.2} km of the area's centre, a different measure that isn't directly comparable.</p>
    </section>
  );
}

function MiniBars({ items }: { items: { label: string; value: number; mine: boolean }[] }) {
  const max = Math.max(1, ...items.map((x) => x.value));
  return (
    <div className="minibars" role="img" aria-label="Restaurants by cuisine in this area">
      {items.map((x) => (
        <div key={x.label} className={x.mine ? "mb mine" : "mb"}>
          <span className="mb-label">{x.label}</span>
          <span className="mb-track"><span style={{ width: `${(x.value / max) * 100}%` }} /></span>
          <span className="mb-val">{int(x.value)}</span>
        </div>
      ))}
    </div>
  );
}

function PriceLadder({ costs, you }: { costs: number[]; you: number }) {
  const maxCost = 2000, step = 100;
  const bins = Array.from({ length: maxCost / step }, (_, i) => costs.filter((v) => v >= i * step && (i === maxCost / step - 1 ? true : v < (i + 1) * step)).length);
  const peak = Math.max(1, ...bins);
  const youBin = Math.min(bins.length - 1, Math.floor(you / step));
  return (
    <div className="ladder" role="img" aria-label={`Price distribution in this area with your price ${rupees(you)} marked`}>
      <div className="ladder-bars">
        {bins.map((n, i) => <span key={i} className={i === youBin ? "you" : ""} style={{ height: `${(n / peak) * 100}%` }} title={`${rupees(i * step)}–${rupees((i + 1) * step - 1)}: ${n} restaurants`} />)}
      </div>
      <div className="ladder-axis"><span>₹0</span><span>₹500</span><span>₹1,000</span><span>₹1,500</span><span>₹2,000+</span></div>
      <span className="ladder-note">Restaurants in this area by cost for two · <b>you: {rupees(you)}</b></span>
    </div>
  );
}

function Delta({ label, a, b, fmt, unit, scale, digits = 0 }: { label: string; a: number; b: number; fmt: (v: number) => string; unit: string; scale: number; digits?: number }) {
  const d = (b - a) * scale;
  const flat = Math.abs(d) < (digits ? 0.005 : 0.5);
  return (
    <span className={flat ? "cd flat" : d > 0 ? "cd up" : "cd down"}>
      {label} {fmt(a)} → <b>{fmt(b)}</b> <em>{flat ? "no change" : `${d > 0 ? "▲ +" : "▼ "}${d.toFixed(digits)} ${unit}`}</em>
    </span>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="toggle" role="group">
      <button type="button" className={on ? "on" : ""} onClick={() => onChange(true)}>Yes</button>
      <button type="button" className={!on ? "on" : ""} onClick={() => onChange(false)}>No</button>
    </span>
  );
}

/* ------------------------------ Charts ------------------------------ */

function HBars({ rows, max, format, color = "var(--series-1)" }: {
  rows: { label: string; value: number; note?: string }[];
  max: number;
  format: (v: number) => string;
  color?: string;
}) {
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div className="hbar" key={r.label} title={`${r.label}: ${format(r.value)}${r.note ? ` · ${r.note}` : ""}`}>
          <span className="hbar-label">{r.label}{r.note && <small>{r.note}</small>}</span>
          <span className="hbar-track"><span style={{ width: `${(r.value / max) * 100}%`, background: color }} /></span>
          <span className="hbar-value">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Ratings as dots on a zoomed scale: bars can't start above zero, dots can. */
function DotRows({ rows, lo = 3, hi = 4.5 }: { rows: { label: string; value: number; note?: string }[]; lo?: number; hi?: number }) {
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += 0.5) ticks.push(v);
  const x = (v: number) => `${((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div className="hbar" key={r.label} title={`${r.label}: ${stars(r.value)}${r.note ? ` · ${r.note}` : ""}`}>
          <span className="hbar-label">{r.label}{r.note && <small>{r.note}</small>}</span>
          <span className="dot-track">
            {ticks.map((t) => <span key={t} className="dot-tick" style={{ left: x(t) }} />)}
            <span className="dot-mark" style={{ left: x(r.value) }} />
          </span>
          <span className="hbar-value">{stars(r.value)}</span>
        </div>
      ))}
      <div className="hbar axis-row">
        <span />
        <span className="dot-axis">{ticks.map((t) => <span key={t} style={{ left: x(t) }}>{t.toFixed(1)}★</span>)}</span>
        <span />
      </div>
    </div>
  );
}

function MarketSection({ data }: { data: Data }) {
  const mk = data.market;
  const top = mk.by_cuisine.slice(0, 6);
  const bottom = mk.by_cuisine.slice(-6).reverse();
  const maxVotes = Math.max(...mk.online.map((o) => o.votes_with));
  return (
    <section className="block" id="market">
      <p className="step">The market</p>
      <h2>What successful Bangalore restaurants have in common</h2>

      <div className="grid2">
        <div className="card">
          <h3>Pricier places rate higher…</h3>
          <DotRows rows={mk.by_price.map((b) => ({ label: b.band, value: b.rating, note: `${int(b.restaurants)} places` }))} />
        </div>
        <div className="card">
          <h3>…and get far more votes</h3>
          <HBars rows={mk.by_price.map((b) => ({ label: b.band, value: b.median_votes }))} max={Math.max(...mk.by_price.map((b) => b.median_votes))} format={int} color="var(--series-2)" />
          <p className="card-note">Median number of Zomato votes</p>
        </div>
      </div>

      <div className="card wide">
        <h3>Online ordering goes with 2–3× more votes, at every price level</h3>
        <div className="dumbbells">
          {mk.online.map((o) => (
            <div className="db-row" key={o.band}>
              <span className="hbar-label">{o.band}</span>
              <span className="db-track">
                <span className="db-line" style={{ left: `${(o.votes_without / maxVotes) * 100}%`, width: `${((o.votes_with - o.votes_without) / maxVotes) * 100}%` }} />
                <span className="db-dot off" style={{ left: `${(o.votes_without / maxVotes) * 100}%` }} title={`Without online ordering: ${int(o.votes_without)} votes`} />
                <span className="db-dot on" style={{ left: `${(o.votes_with / maxVotes) * 100}%` }} title={`With online ordering: ${int(o.votes_with)} votes`} />
              </span>
              <span className="hbar-value">{int(o.votes_without)} → {int(o.votes_with)}</span>
            </div>
          ))}
        </div>
        <div className="legend"><span><i className="dot off" />Without online ordering</span><span><i className="dot on" />With online ordering</span><span>Median votes</span></div>
        <p className="card-note">This shows what goes together, not proof of cause: restaurants that offer delivery may also differ in other ways.</p>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Highest-rated cuisines</h3>
          <DotRows rows={top.map((q) => ({ label: q.cuisines, value: q.rating, note: `${int(q.restaurants)} places · ${rupees(q.cost)}` }))} />
        </div>
        <div className="card">
          <h3>Crowded and lower-rated</h3>
          <DotRows rows={bottom.map((q) => ({ label: q.cuisines, value: q.rating, note: `${int(q.restaurants)} places · ${rupees(q.cost)}` }))} />
        </div>
      </div>

      <div className="card wide">
        <h3>Being a chain doesn't buy a better rating, only more visibility</h3>
        <div className="chain-row">
          {mk.by_chain.map((k) => (
            <div key={k.kind} className="chain">
              <span className="chain-kind">{k.kind}</span>
              <span className="chain-val">{stars(k.rating)}</span>
              <span className="chain-sub">{int(k.median_votes)} median votes · {int(k.restaurants)} places</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReviewsSection({ data }: { data: Data }) {
  const r = data.reviews;
  const max = Math.max(...r.themes.flatMap((x) => [x.low, x.high]));
  return (
    <section className="block" id="reviews">
      <p className="step">The customers</p>
      <h2>What separates a 1★ review from a 5★ one</h2>
      <p className="prose">
        Share of {int(r.n_low)} bad reviews (1–2★) and {int(r.n_high)} good reviews (4–5★) that mention each theme.
        The themes that matter are the ones with the biggest gap.
      </p>
      <div className="card wide">
        <div className="themes">
          {r.themes.map((x) => (
            <div className="theme-row" key={x.theme}>
              <span className="hbar-label">{x.theme}</span>
              <span className="theme-bars">
                <span className="tb low" style={{ width: `${(x.low / max) * 100}%` }} title={`${pct(x.low, 1)} of bad reviews`} />
                <span className="tb high" style={{ width: `${(x.high / max) * 100}%` }} title={`${pct(x.high, 1)} of good reviews`} />
              </span>
              <span className="hbar-value">{pct(x.low, 1)} · {pct(x.high, 1)}</span>
            </div>
          ))}
        </div>
        <div className="legend"><span><i className="sq low" />Bad reviews (1–2★)</span><span><i className="sq high" />Good reviews (4–5★)</span></div>
        <p className="card-note">Price and portion size come up just as often in good reviews, so they don't separate winners from losers. Taste, service, delivery time and hygiene do.</p>
      </div>
    </section>
  );
}

function Accuracy({ data }: { data: Data }) {
  const mt = data.model.metrics;
  const rows = Object.entries(mt.rating);
  const imp = Object.entries(mt.importance_popularity).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const impMax = imp[0]?.[1] ?? 1;
  return (
    <section className="block" id="accuracy">
      <p className="step">Can you trust it?</p>
      <h2>How accurate the predictions are</h2>
      <p className="prose">
        Every number here comes from restaurants the model did <i>not</i> see while learning (5-fold cross-validation, with all outlets of a chain
        kept together so it can't just remember a sibling branch). {int(mt.n_rated)} rated restaurants.
      </p>
      <div className="grid2">
        <div className="card">
          <h3>Rating: typical error (lower is better)</h3>
          <HBars rows={rows.map(([k, v]) => ({ label: k, value: v.mae, note: `${pct(v.within_0_5)} within ±0.5★` }))}
            max={Math.max(...rows.map(([, v]) => v.mae))} format={(v) => `±${v.toFixed(2)}★`} />
          <p className="card-note">The model beats simple guesses, but only modestly. A restaurant's concept explains part of its rating; the rest is execution (taste, service), which no pre-launch model can see.</p>
        </div>
        <div className="card">
          <h3>Popularity: what drives the prediction</h3>
          <HBars rows={imp.map(([k, v]) => ({ label: k, value: v }))} max={impMax} format={(v) => (v / impMax * 100).toFixed(0)} color="var(--series-2)" />
          <p className="card-note">Relative importance: how much worse predictions get when that input is scrambled. Popularity model AUC {mt.popularity["Gradient boosting"].auc.toFixed(2)} (logistic regression {mt.popularity["Logistic regression"].auc.toFixed(2)}).</p>
        </div>
      </div>
    </section>
  );
}

function Decisions({ data }: { data: Data }) {
  const mk = data.market;
  const online = mk.online[1];
  const taste = data.reviews.themes.find((x) => x.theme === "Bad taste");
  return (
    <section className="block" id="decisions">
      <p className="step">So what?</p>
      <h2>Marketing decisions this supports</h2>
      <ol className="recs">
        <li>
          <h3>Screen concepts before investing</h3>
          <p>Compare concepts (cuisine × format × price × area) on predicted popularity first. Concept and location predict traction well (AUC {data.model.metrics.popularity["Gradient boosting"].auc.toFixed(2)}).</p>
        </li>
        <li>
          <h3>Get on delivery from day one</h3>
          <p>In the ₹300–499 band, places with online ordering have a median of {int(online.votes_with)} votes vs {int(online.votes_without)} without. Visibility is the first marketing problem a new restaurant has.</p>
        </li>
        <li>
          <h3>Pick the area with the competition in view</h3>
          <p>Food hubs score high but are crowded with the same cuisines. The location finder shows both, so you can trade a little predicted popularity for far fewer direct competitors.</p>
        </li>
        <li>
          <h3>Avoid the crowded, low-rated categories, or stand out within them</h3>
          <p>Chinese, Biryani and Rolls are crowded and rate below average. Mediterranean, European and Asian rate highest, at higher price points.</p>
        </li>
        <li>
          <h3>Spend on taste and service, not discounts</h3>
          <p>“Bad taste” appears in {taste ? pct(taste.low, 0) : "–"} of bad reviews but only {taste ? pct(taste.high, 1) : "–"} of good ones. Price complaints are equally common in good reviews. Customers punish execution, not price.</p>
        </li>
      </ol>
    </section>
  );
}

function Method({ data }: { data: Data }) {
  const mt = data.model.metrics;
  return (
    <section className="block" id="method">
      <p className="step">Method & limits</p>
      <h2>How it was built</h2>
      <div className="grid3">
        <div><h3>Data</h3><p>51,717 Zomato listings collapsed to {int(data.market.totals.restaurants)} unique restaurants (a restaurant appears once per Zomato category). Ratings, cost and reviews parsed and cleaned in Python.</p></div>
        <div><h3>Models</h3><p>Gradient-boosted trees (scikit-learn) for rating (regression) and popularity (top 25% by votes, ≥{int(mt.popular_cut_votes)}), compared with linear/logistic models and simple baselines. Inputs are only pre-launch decisions; votes, reviews and “dishes liked” are excluded to avoid leakage.</p></div>
        <div><h3>Live layer</h3><p>Every food place mapped in Bangalore is pulled from OpenStreetMap (Overpass API) and counted within {data.osm?.radius_km ?? 1.2} km of each area's geocoded centre, by type and cuisine. A scheduled job refreshes it weekly and redeploys the site.</p></div>
        <div><h3>Testing</h3><p>5-fold cross-validation grouped by brand. The browser runs the exact exported trees, checked against scikit-learn's own predictions.</p></div>
      </div>
      <h3>Limitations</h3>
      <ul className="limits">
        <li>Correlation, not causation: e.g. online ordering goes with more votes, but this data can't prove adding it causes them.</li>
        <li>Votes also grow with how long a restaurant has been open, and the data has no opening dates.</li>
        <li>The models and most insights use a 2019 snapshot; the live OpenStreetMap layer shows today's density, but volunteer mapping is incomplete (only ~{pct(data.osm?.tagged_share ?? 0.45)} of places carry a cuisine tag), so treat its counts as minimums.</li>
        <li>Rating predictions are modest (±{mt.rating["Gradient boosting"].mae.toFixed(2)}★): use them to compare concepts, not as a promise.</li>
      </ul>
    </section>
  );
}
