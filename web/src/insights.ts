import { int, pct, rupees, stars } from "./format";
import type { Concept, Market } from "./types";

export type Field = "area" | "cuisines" | "type" | "cost" | "online" | "booking" | "outlets" | "listings";
export type Tone = "good" | "warn" | "neutral";
export type Insight = { field: Field; title: string; headline: string; detail: string; tone: Tone };

const BANDS: [number, number, string][] = [
  [0, 300, "Under ₹300"], [300, 500, "₹300–499"], [500, 800, "₹500–799"], [800, 1500, "₹800–1,499"], [1500, 1e9, "₹1,500+"],
];
export const bandOf = (cost: number) => BANDS.find(([lo, hi]) => cost >= lo && cost < hi)![2];

export function describe(field: Field, c: Concept): string {
  switch (field) {
    case "area": return c.area;
    case "cuisines": return c.cuisines.join(" + ");
    case "type": return c.type;
    case "cost": return `${rupees(c.cost)} for two`;
    case "online": return c.online ? "online ordering on" : "online ordering off";
    case "booking": return c.booking ? "table booking on" : "table booking off";
    case "outlets": return c.outlets === 1 ? "1 outlet" : `${c.outlets} outlets`;
    case "listings": return c.listings.length ? c.listings.join(", ") : "no Zomato categories";
  }
}

export const FIELD_LABEL: Record<Field, string> = {
  area: "Area", cuisines: "Cuisines", type: "Format", cost: "Price", online: "Online ordering",
  booking: "Table booking", outlets: "Outlets", listings: "Zomato listing",
};

export function changedField(a: Concept, b: Concept): Field | null {
  const fields: Field[] = ["area", "cuisines", "type", "cost", "online", "booking", "outlets", "listings"];
  return fields.find((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f])) ?? null;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

export function buildInsights(mk: Market, c: Concept): Insight[] {
  const city = mk.totals.mean_rating;
  const area = mk.areas.find((a) => a.area === c.area);
  const band = bandOf(c.cost);
  const out: Insight[] = [];

  // Area
  if (area) {
    const competitors = c.cuisines.reduce((s, q) => s + (area.cuisine_counts[q] ?? 0), 0);
    const allComp = mk.areas.map((a) => c.cuisines.reduce((s, q) => s + (a.cuisine_counts[q] ?? 0), 0)).sort((x, y) => x - y);
    const compRank = allComp.filter((v) => v < competitors).length / allComp.length;
    const cityVotes = [...mk.areas.map((a) => a.median_votes)].sort((x, y) => x - y)[Math.floor(mk.areas.length / 2)];
    const busy = area.median_votes >= cityVotes;
    out.push({
      field: "area", title: c.area,
      headline: `${int(area.restaurants)} restaurants · ${stars(area.rating ?? city)} average · ${rupees(area.median_cost)} typical for two`,
      detail: `Already here: ${c.cuisines.map((q) => `${int(area.cuisine_counts[q] ?? 0)} ${q}`).join(", ")} restaurants${compRank >= 0.75 ? ", one of the most crowded areas for your cuisines" : compRank <= 0.35 ? ", a relatively open market for your cuisines" : ""}. ` +
        `A typical restaurant here has ${int(area.median_votes)} votes, versus ${int(cityVotes)} in a typical Bangalore area: ${busy ? "strong footfall and app traffic" : "lower traffic, so you'll have to work harder for visibility"}.`,
      tone: compRank >= 0.75 ? "warn" : busy ? "good" : "neutral",
    });
  }

  // Cuisines
  const cs = c.cuisines.map((q) => ({ q, s: mk.cuisine_stats[q], local: area?.cuisine_ratings[q] })).filter((x) => x.s);
  if (cs.length) {
    const crowded = cs.filter((x) => x.s.restaurants >= 1500);
    const best = [...cs].sort((a, b) => (b.s.rating ?? 0) - (a.s.rating ?? 0))[0];
    const worst = [...cs].sort((a, b) => (a.s.rating ?? 0) - (b.s.rating ?? 0))[0];
    const parts = cs.map((x) => `${x.q}: ${int(x.s.restaurants)} places citywide, ${stars(x.s.rating ?? city)}${x.local ? ` (${stars(x.local)} in ${c.area})` : ""}`);
    out.push({
      field: "cuisines", title: c.cuisines.join(" + "),
      headline: parts.join(" · "),
      detail: crowded.length
        ? `${crowded.map((x) => x.q).join(" and ")} ${crowded.length > 1 ? "are" : "is"} among the most crowded cuisines in Bangalore. You'll need a clear hook (a signature dish, speed or price) to stand out.`
        : (best.s.rating ?? 0) > city + 0.15
          ? `${best.q} rates well above the city average (${stars(city)}), with fewer direct competitors. That's a good positioning opportunity.`
          : `${worst.q} rates around the city average. Differentiate on quality, because customers compare you with many similar menus.`,
      tone: crowded.length ? "warn" : (best.s.rating ?? 0) > city + 0.15 ? "good" : "neutral",
    });
  }

  // Format
  const ts = mk.type_stats[c.type];
  if (ts) {
    const lift = ratio(ts.popular_share, 0.25);
    out.push({
      field: "type", title: c.type,
      headline: `${int(ts.restaurants)} ${c.type} places · ${stars(ts.rating ?? city)} average · ${pct(ts.popular_share)} become popular`,
      detail: `${lift >= 1.2 ? `${lift.toFixed(1)}× the city's 25% popularity rate. This format tends to attract votes and visibility.` : lift <= 0.8 ? `Below the city's 25% popularity rate. This format often relies on walk-ins rather than app discovery, so plan for offline marketing.` : "Close to the city's 25% popularity rate."} Typical price for this format: ${rupees(ts.median_cost)} for two.`,
      tone: lift >= 1.2 ? "good" : lift <= 0.8 ? "warn" : "neutral",
    });
  }

  // Price
  const bp = mk.by_price.find((b) => b.band === band);
  if (bp && area) {
    const cheaperThan = area.costs.filter((v) => v > c.cost).length / area.costs.length;
    const position = cheaperThan >= 0.6 ? "value" : cheaperThan <= 0.25 ? "premium" : "mid-market";
    const typeGap = ts ? c.cost / ts.median_cost : 1;
    out.push({
      field: "cost", title: `${rupees(c.cost)} for two`,
      headline: `${band}: ${int(bp.restaurants)} rated places average ${stars(bp.rating)} with ${int(bp.median_votes)} median votes`,
      detail: `In ${c.area} you'd be cheaper than ${pct(cheaperThan)} of restaurants: a ${position} position. ` +
        (typeGap < 0.7 ? `That's well below the usual ${c.type} price (${rupees(ts!.median_cost)}), so check your margins can survive it.` :
          typeGap > 1.5 ? `That's well above the usual ${c.type} price (${rupees(ts!.median_cost)}), so the experience must justify the premium.` :
            `It's in line with the usual ${c.type} price (${rupees(ts?.median_cost ?? c.cost)}).`) +
        ` Across the city, higher price bands rate higher and draw more votes.`,
      tone: typeGap < 0.7 || typeGap > 1.5 ? "warn" : position === "premium" ? "good" : "neutral",
    });
  }

  // Online ordering
  const on = mk.online.find((o) => o.band === band);
  if (on) {
    const x = ratio(on.votes_with, on.votes_without);
    out.push({
      field: "online", title: c.online ? "Online ordering: on" : "Online ordering: off",
      headline: `At ${band}: ${int(on.votes_with)} median votes with online ordering vs ${int(on.votes_without)} without (${x.toFixed(1)}×)`,
      detail: c.online
        ? `Delivery puts you in front of app users from day one. ${area ? `${pct(area.online_share)} of ${c.area} restaurants already take online orders.` : ""} Watch delivery time and packaging: late delivery is a top complaint in 1★ reviews.`
        : `Without delivery you're invisible to app-first customers. ${area ? `${pct(area.online_share)} of ${c.area} restaurants take online orders, so you'd be competing at a disadvantage.` : ""}`,
      tone: c.online ? "good" : "warn",
    });
  }

  // Table booking
  const bk = mk.booking.find((b) => b.band === band);
  if (bk) {
    out.push({
      field: "booking", title: c.booking ? "Table booking: on" : "Table booking: off",
      headline: bk.with !== null && bk.without !== null
        ? `At ${band}: ${stars(bk.with)} and ${int(bk.votes_with ?? 0)} votes with booking vs ${stars(bk.without)} and ${int(bk.votes_without ?? 0)} without`
        : `Only ${pct(bk.share, 1)} of places at ${band} offer table booking`,
      detail: bk.with !== null
        ? `Table booking signals a planned, sit-down experience. It's offered by ${pct(bk.share)} of places at this price. ${c.booking ? "It fits a dine-in concept; make sure service matches the expectation it sets." : "Consider it if you're building a dine-in destination."}`
        : `At this price customers walk in or order online; booking adds little. ${c.booking ? "It's unusual here; it can signal premium, but only if the experience backs it up." : "Skipping it is normal for this price."}`,
      tone: bk.with !== null && c.booking ? "good" : "neutral",
    });
  }

  // Outlets
  const kind = c.outlets === 1 ? "Independent (1 outlet)" : c.outlets <= 5 ? "Small chain (2–5)" : "Large chain (6+)";
  const ch = mk.by_chain.find((k) => k.kind === kind);
  const indie = mk.by_chain.find((k) => k.kind.startsWith("Independent"));
  if (ch && indie) {
    out.push({
      field: "outlets", title: kind,
      headline: `${kind}: ${stars(ch.rating)} average, ${int(ch.median_votes)} median votes`,
      detail: c.outlets === 1
        ? `Independents rate just as well as chains but get fewer votes (${int(indie.median_votes)} median). Without brand recognition, early reviews and app visibility matter most.`
        : `Chains don't rate higher (${stars(ch.rating)} vs ${stars(indie.rating)} for independents), but brand recognition brings ${ratio(ch.median_votes, indie.median_votes).toFixed(1)}× the votes.`,
      tone: c.outlets === 1 ? "neutral" : "good",
    });
  }

  // Listings
  const ls = c.listings.map((l) => ({ l, s: mk.listing_stats[l] })).filter((x) => x.s);
  if (ls.length) {
    const top = [...ls].sort((a, b) => b.s.popular_share - a.s.popular_share)[0];
    out.push({
      field: "listings", title: c.listings.join(", "),
      headline: ls.map((x) => `${x.l}: ${int(x.s.restaurants)} places, ${pct(x.s.popular_share)} popular`).join(" · "),
      detail: `Each Zomato category is a separate shelf customers browse. ${top.l} has the highest share of popular restaurants among your choices (${pct(top.s.popular_share)}). Being listed in more relevant categories means more ways to be discovered.`,
      tone: top.s.popular_share >= 0.3 ? "good" : "neutral",
    });
  }
  return out;
}
