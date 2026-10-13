import { int, pct, rupees, stars } from "./format";
import type { Area, Concept, Market, Reviews } from "./types";

export type Field = "area" | "cuisines" | "type" | "cost" | "online" | "booking" | "outlets" | "listings";
export type Tone = "good" | "warn" | "neutral";
export type Viz =
  | { kind: "bars"; items: { label: string; value: number; mine: boolean }[] }
  | { kind: "ladder"; costs: number[]; you: number };
export type Insight = { field: Field; title: string; headline: string; facts: string[]; move: string; tone: Tone; viz?: Viz; detail: string };

const BANDS: [number, number, string][] = [
  [0, 300, "Under ₹300"], [300, 500, "₹300–499"], [500, 800, "₹500–799"], [800, 1500, "₹800–1,499"], [1500, 1e9, "₹1,500+"],
];
export const bandOf = (cost: number) => BANDS.find(([lo, hi]) => cost >= lo && cost < hi)![2];

export const COMPLAINTS = ["Late delivery / long wait", "Small quantity", "Overpriced", "Bad taste", "Rude or slow service",
  "Hygiene", "Cold food", "Wrong or missing items", "Packaging / spillage"];

/** What a marketing team can do about each complaint. */
export const FIX: Record<string, string> = {
  "Late delivery / long wait": "promise realistic delivery times and staff up for peak hours",
  "Small quantity": "show portion sizes in menu photos and label dishes “serves 1/2”",
  "Overpriced": "frame the price with combos and value messaging",
  "Bad taste": "run tastings and chef-led content, and act on early feedback fast",
  "Rude or slow service": "train staff on service and reply to every negative review within 24 hours",
  "Hygiene": "make kitchen hygiene visible: open kitchen photos, FSSAI rating up front",
  "Cold food": "use insulated packaging and keep the delivery radius tight",
  "Wrong or missing items": "add a packing checklist and a tamper seal on every order",
  "Packaging / spillage": "invest in spill-proof containers; it's cheaper than refunds",
};

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
const share = (n: number, d: number) => (d > 0 ? n / d : 0);

/** The complaint a group's unhappy customers raise most, relative to all 1–2★ reviews. */
export function topComplaint(rv: Reviews, group: "by_cuisine" | "by_type", key: string) {
  const g = rv[group][key];
  if (!g) return null;
  const base = Object.fromEntries(rv.themes.map((t) => [t.theme, t.low]));
  const best = COMPLAINTS.filter((t) => base[t] >= 0.015)
    .map((t) => ({ theme: t, lift: ratio(g.low[t], base[t]), share: g.low[t] }))
    .sort((a, b) => b.lift - a.lift)[0];
  return best && best.lift >= 1.1 ? { ...best, lowShare: g.low_share } : null;
}

/** Cuisines under-represented in this area compared with Bangalore overall, that rate at least average. */
export function gapCuisines(mk: Market, area: Area, exclude: string[]) {
  const total = mk.totals.restaurants;
  return Object.entries(mk.cuisine_stats)
    .filter(([q, s]) => !exclude.includes(q) && s.restaurants >= 150 && (s.rating ?? 0) >= mk.totals.mean_rating)
    .map(([q, s]) => ({ q, s, ratio: share(area.cuisine_counts[q] ?? 0, area.restaurants) / share(s.restaurants, total) }))
    .filter((x) => x.ratio < 0.6)
    .sort((a, b) => (b.s.rating ?? 0) - (a.s.rating ?? 0))
    .slice(0, 3);
}

export function buildInsights(mk: Market, rv: Reviews, c: Concept): Insight[] {
  const city = mk.totals.mean_rating;
  const area = mk.areas.find((a) => a.area === c.area);
  const band = bandOf(c.cost);
  const out: Insight[] = [];
  const cityVotes = [...mk.areas.map((a) => a.median_votes)].sort((x, y) => x - y)[Math.floor(mk.areas.length / 2)];

  /* ---------- Area ---------- */
  if (area) {
    const competitors = c.cuisines.reduce((s, q) => s + (area.cuisine_counts[q] ?? 0), 0);
    const allComp = mk.areas.map((a) => c.cuisines.reduce((s, q) => s + (a.cuisine_counts[q] ?? 0), 0)).sort((x, y) => x - y);
    const compRank = allComp.filter((v) => v < competitors).length / allComp.length;
    const busy = area.median_votes >= cityVotes;
    const topCuisines = Object.entries(area.cuisine_counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const topTypes = Object.entries(area.type_counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const bestHere = Object.entries(area.cuisine_ratings).filter(([q]) => (area.cuisine_counts[q] ?? 0) >= 5)
      .sort((a, b) => b[1] - a[1]).slice(0, 3);
    const gaps = gapCuisines(mk, area, c.cuisines);
    out.push({
      field: "area", title: c.area,
      headline: `${int(area.restaurants)} restaurants · ${stars(area.rating ?? city)} average · ${rupees(area.median_cost)} typical for two`,
      facts: [
        `Already here: ${c.cuisines.map((q) => `${int(area.cuisine_counts[q] ?? 0)} ${q}`).join(", ")}${compRank >= 0.75 ? ", one of the most crowded areas for your cuisines" : compRank <= 0.35 ? ", a relatively open market for your cuisines" : ""}.`,
        `Footfall: a typical restaurant here has ${int(area.median_votes)} votes vs ${int(cityVotes)} in a typical Bangalore area (${busy ? "busy" : "quieter"}).`,
        `Mostly ${topTypes.map(([t, n]) => `${t} (${pct(share(n, area.restaurants))})`).join(", ")}.`,
        bestHere.length ? `Best-rated cuisines here: ${bestHere.map(([q, r]) => `${q} ${stars(r)}`).join(", ")}.` : "",
        gaps.length ? `Gaps: ${gaps.map((g) => g.q).join(", ")} ${gaps.length > 1 ? "are" : "is"} under-represented here compared with the rest of Bangalore, and rate above average.` : "",
        `${pct(area.online_share)} take online orders · ${pct(area.booking_share)} offer table booking.`,
      ].filter(Boolean),
      move: compRank >= 0.75
        ? `Crowded for your cuisines: geo-target Zomato ads to ${c.area} and lead with a dish none of the ${int(competitors)} competitors offer${gaps.length ? `, or add a ${gaps[0].q} item to fill a local gap` : ""}.`
        : busy ? `Busy and not saturated: capture existing demand with promoted listings and storefront visibility at lunch and dinner peaks.`
          : `Quieter area: build demand with delivery to neighbouring areas, local Instagram creators and a first-order offer.`,
      tone: compRank >= 0.75 ? "warn" : busy ? "good" : "neutral",
      viz: { kind: "bars", items: [...topCuisines.map(([q, n]) => ({ label: q, value: n, mine: c.cuisines.includes(q) })),
        ...c.cuisines.filter((q) => !topCuisines.some(([t]) => t === q)).map((q) => ({ label: q, value: area.cuisine_counts[q] ?? 0, mine: true }))] },
      detail: "",
    });
  }

  /* ---------- Cuisines ---------- */
  const cs = c.cuisines.map((q) => ({ q, s: mk.cuisine_stats[q] })).filter((x) => x.s);
  if (cs.length) {
    const crowded = cs.filter((x) => x.s.restaurants >= 1500);
    const facts: string[] = [];
    let move = "";
    for (const { q, s } of cs) {
      const atBand = mk.cuisine_band[q]?.[band];
      const bestAreas = mk.areas
        .filter((a) => (a.cuisine_ratings[q] ?? 0) > 0 && (a.cuisine_counts[q] ?? 0) >= 5)
        .sort((a, b) => b.cuisine_ratings[q] - a.cuisine_ratings[q]).slice(0, 2);
      const comp = topComplaint(rv, "by_cuisine", q);
      facts.push(
        `${q}: ${int(s.restaurants)} places in ${s.areas} areas, ${stars(s.rating ?? city)} average, ${rupees(s.median_cost)} typical` +
        (atBand ? `; at ${band} it averages ${stars(atBand.rating)} with ${int(atBand.median_votes)} median votes.` : "."),
      );
      if (bestAreas.length) facts.push(`Best areas for ${q}: ${bestAreas.map((a) => `${a.area} (${stars(a.cuisine_ratings[q])}, ${a.cuisine_counts[q]} places)`).join(", ")}.`);
      if (comp) {
        facts.push(`Unhappy ${q} customers mention “${comp.theme.toLowerCase()}” ${comp.lift.toFixed(1)}× more than average (${pct(comp.share)} of its 1–2★ reviews).`);
        if (!move) move = `Pre-empt the #1 ${q} complaint: ${FIX[comp.theme]}. Put it in the marketing message, not just the kitchen.`;
      }
    }
    if (!move) move = crowded.length ? `${crowded.map((x) => x.q).join(" and ")} ${crowded.length > 1 ? "are" : "is"} crowded: build the brand around one hero dish.` : "Use the cuisine's strength in your messaging: it rates above the crowded categories.";
    out.push({
      field: "cuisines", title: c.cuisines.join(" + "),
      headline: crowded.length ? `${crowded.map((x) => x.q).join(" and ")} ${crowded.length > 1 ? "are" : "is"} among Bangalore's most crowded cuisines` : `A less crowded cuisine mix`,
      facts, move, tone: crowded.length ? "warn" : "good", detail: "",
    });
  }

  /* ---------- Format ---------- */
  const ts = mk.type_stats[c.type];
  if (ts) {
    const lift = ratio(ts.popular_share, 0.25);
    const comp = topComplaint(rv, "by_type", c.type);
    const g = rv.by_type[c.type];
    out.push({
      field: "type", title: c.type,
      headline: `${int(ts.restaurants)} places · ${stars(ts.rating ?? city)} average · ${pct(ts.popular_share)} become popular (city 25%)`,
      facts: [
        `Typical price ${rupees(ts.median_cost)} for two; ${pct(ts.online_share)} take online orders.`,
        area ? `${int(area.type_counts[c.type] ?? 0)} ${c.type} places already in ${c.area}.` : "",
        g ? `${pct(g.low_share)} of ${c.type} reviews are 1–2★ (city ${pct(rv.low_share)}).` : "",
        comp ? `Its unhappy customers mention “${comp.theme.toLowerCase()}” ${comp.lift.toFixed(1)}× more than average.` : "",
        (() => {
          const peers = Object.entries(mk.type_stats)
            .filter(([t, v]) => t !== c.type && Math.abs(v.median_cost - c.cost) <= 250 && v.restaurants >= 100)
            .sort((a, b) => b[1].popular_share - a[1].popular_share).slice(0, 3);
          return peers.length ? `Other formats at a similar price: ${peers.map(([t, v]) => `${t} ${pct(v.popular_share)} popular`).join(", ")}.` : "";
        })(),
      ].filter(Boolean),
      move: lift >= 1.2 ? `This format wins on the app: put budget into Zomato visibility, photos and early reviews.`
        : lift <= 0.8 ? `This format lives on walk-ins: signage, neighbourhood tie-ups and loyalty cards beat app ads.`
          : `Split budget between app visibility and local footfall.` + (comp ? ` Also ${FIX[comp.theme]}.` : ""),
      tone: lift >= 1.2 ? "good" : lift <= 0.8 ? "warn" : "neutral", detail: "",
    });
  }

  /* ---------- Price ---------- */
  const bp = mk.by_price.find((b) => b.band === band);
  if (bp && area) {
    const cheaperThan = share(area.costs.filter((v) => v > c.cost).length, area.costs.length);
    const nearby = area.costs.filter((v) => Math.abs(v - c.cost) <= 100).length;
    const position = cheaperThan >= 0.6 ? "value" : cheaperThan <= 0.25 ? "premium" : "mid-market";
    const typeGap = ts ? c.cost / ts.median_cost : 1;
    const q0 = c.cuisines[0];
    const qb = mk.cuisine_band[q0]?.[band];
    out.push({
      field: "cost", title: `${rupees(c.cost)} for two · ${position}`,
      headline: `${band}: ${int(bp.restaurants)} places citywide average ${stars(bp.rating)} with ${int(bp.median_votes)} median votes`,
      facts: [
        `In ${c.area} you'd be cheaper than ${pct(cheaperThan)} of restaurants.`,
        `${int(nearby)} restaurants here price within ±₹100 of you (${pct(share(nearby, area.costs.length))} of the area): ${share(nearby, area.costs.length) >= 0.35 ? "the most contested price slot" : "a less contested slot"}.`,
        ts ? `Usual ${c.type} price: ${rupees(ts.median_cost)} (you're ${typeGap >= 1 ? `${Math.round((typeGap - 1) * 100)}% above` : `${Math.round((1 - typeGap) * 100)}% below`}).` : "",
        qb ? `${q0} at ${band}: ${stars(qb.rating)} average across ${qb.n} places.` : "",
      ].filter(Boolean),
      move: position === "value" ? `Own the value slot: “meal for two under ${rupees(Math.ceil(c.cost / 50) * 50 + 50)}”, combos and office-lunch deals.`
        : position === "premium" ? `Sell the experience, not the price: ambience, chef story, plated photos. Premium places rate higher citywide.`
          : `Mid-market is where most competitors sit: differentiate on a signature dish or speed, not on price.`,
      tone: typeGap < 0.7 || typeGap > 1.5 ? "warn" : position === "premium" ? "good" : "neutral",
      viz: { kind: "ladder", costs: area.costs, you: c.cost }, detail: "",
    });
  }

  /* ---------- Online ordering ---------- */
  const on = mk.online.find((o) => o.band === band);
  if (on) {
    const x = ratio(on.votes_with, on.votes_without);
    const qOnline = cs.length ? cs.reduce((s, y) => s + y.s.online_share, 0) / cs.length : null;
    const base = Object.fromEntries(rv.themes.map((t) => [t.theme, t.low]));
    const deliveryPain = c.cuisines.map((q) => rv.by_cuisine[q]).filter(Boolean)
      .flatMap((g) => ["Late delivery / long wait", "Cold food", "Packaging / spillage"].map((t) => ({ t, lift: ratio(g.low[t], base[t]) })))
      .sort((a, b) => b.lift - a.lift)[0];
    out.push({
      field: "online", title: c.online ? "Online ordering: on" : "Online ordering: off",
      headline: `At ${band}: ${int(on.votes_with)} median votes with online ordering vs ${int(on.votes_without)} without (${x.toFixed(1)}×)`,
      facts: [
        area ? (c.online
          ? `With delivery on, you're one of ~${int(area.online_share * area.restaurants + 1)} delivery options in ${c.area} (${pct(area.online_share)} of restaurants), and app customers can also order from neighbouring areas.`
          : `Without delivery you compete only for walk-ins, against ~${int(area.restaurants)} restaurants in ${c.area}; ${pct(area.online_share)} of them also sell online.`) : "",
        qOnline !== null ? `${pct(qOnline)} of ${c.cuisines.join("/")} restaurants citywide deliver.` : "",
        deliveryPain && deliveryPain.lift >= 1.1 ? `Delivery risk for your cuisines: “${deliveryPain.t.toLowerCase()}” comes up ${deliveryPain.lift.toFixed(1)}× more than average in bad reviews.` : `Late delivery appears in ${pct(base["Late delivery / long wait"] ?? 0)} of all 1–2★ reviews.`,
      ].filter(Boolean),
      move: c.online
        ? (deliveryPain && deliveryPain.lift >= 1.1 ? `Market delivery, but ${FIX[deliveryPain.t]} first: one bad delivery review outweighs a week of ads.` : "Use launch offers on the delivery app to collect your first 50 reviews quickly.")
        : `Turn delivery on: it's the cheapest visibility a new restaurant can buy at this price.`,
      tone: c.online ? "good" : "warn", detail: "",
    });
  }

  /* ---------- Table booking ---------- */
  const bk = mk.booking.find((b) => b.band === band);
  if (bk) {
    out.push({
      field: "booking", title: c.booking ? "Table booking: on" : "Table booking: off",
      headline: bk.with !== null && bk.without !== null
        ? `At ${band}: ${stars(bk.with)} and ${int(bk.votes_with ?? 0)} votes with booking vs ${stars(bk.without)} and ${int(bk.votes_without ?? 0)} without`
        : `Only ${pct(bk.share, 1)} of places at ${band} offer table booking`,
      facts: [
        `${pct(bk.share)} of restaurants at this price offer booking.`,
        area ? (c.booking
          ? `You'd be one of ~${int(area.booking_share * area.restaurants + 1)} places in ${c.area} that take reservations (${pct(area.booking_share)}): ${area.booking_share < 0.1 ? "rare here, so it stands out" : "common here, so it's expected rather than special"}.`
          : `${pct(area.booking_share)} of ${c.area} restaurants (~${int(area.booking_share * area.restaurants)}) take reservations; ${area.booking_share >= 0.15 ? "at dinner time customers here may expect it" : "few do, so skipping it is normal here"}.`) : "",
        bk.with !== null ? "Booking signals a planned, sit-down experience, which is why it goes with higher ratings at mid-to-premium prices." : "At this price customers walk in or order online.",
      ].filter(Boolean),
      move: bk.with !== null
        ? (c.booking ? "Promote weekend and group bookings; reservations make a place feel in-demand." : "If you're building a dine-in destination, add booking and push it for weekend dinners.")
        : (c.booking ? "Booking is unusual at this price; use it for group orders and celebrations, not as the main hook." : "Skip booking here; spend on delivery and walk-in visibility instead."),
      tone: bk.with !== null && c.booking ? "good" : "neutral", detail: "",
    });
  }

  /* ---------- Outlets ---------- */
  const kind = c.outlets === 1 ? "Independent (1 outlet)" : c.outlets <= 5 ? "Small chain (2–5)" : "Large chain (6+)";
  const ch = mk.by_chain.find((k) => k.kind === kind);
  const indie = mk.by_chain.find((k) => k.kind.startsWith("Independent"));
  if (ch && indie) {
    out.push({
      field: "outlets", title: kind,
      headline: `${stars(ch.rating)} average · ${int(ch.median_votes)} median votes · ${int(ch.restaurants)} places`,
      facts: [
        `Chains don't rate higher (${mk.by_chain.map((k) => `${k.kind.split(" (")[0]} ${stars(k.rating)}`).join(", ")}).`,
        `But visibility grows with brand size: ${mk.by_chain.map((k) => `${int(k.median_votes)}`).join(" → ")} median votes.`,
        c.outlets === 1
          ? `As a single outlet, expect to earn every review: independents get ${int(indie.median_votes)} median votes, ${ratio(mk.by_chain[mk.by_chain.length - 1].median_votes, indie.median_votes).toFixed(1)}× fewer than large chains.`
          : `At ${c.outlets} outlets you'd typically get ${ratio(ch.median_votes, indie.median_votes).toFixed(1)}× the votes of an independent, because people already know the name.`,
        c.outlets > 1 ? `Risk: one bad outlet hurts the whole brand's ratings, so consistency across ${c.outlets} kitchens is a marketing issue too.` : `Advantage: you can adapt the menu and story to ${c.area} faster than a chain can.`,
      ],
      move: c.outlets === 1 ? "No brand recognition yet: the founder story, local press and early reviews are your marketing." : "Use brand recognition: cross-promote outlets and run city-wide campaigns rather than per-store ads.",
      tone: c.outlets === 1 ? "neutral" : "good", detail: "",
    });
  }

  /* ---------- Listings ---------- */
  const ls = c.listings.map((l) => ({ l, s: mk.listing_stats[l] })).filter((x) => x.s);
  if (ls.length) {
    const top = [...ls].sort((a, b) => b.s.popular_share - a.s.popular_share)[0];
    const missing = Object.entries(mk.listing_stats).filter(([l]) => !c.listings.includes(l))
      .sort((a, b) => b[1].popular_share - a[1].popular_share)[0];
    out.push({
      field: "listings", title: c.listings.join(", "),
      headline: `${ls.length} Zomato ${ls.length > 1 ? "categories" : "category"} · best: ${top.l} (${pct(top.s.popular_share)} of its places are popular)`,
      facts: [
        ...ls.map((x) => `${x.l}: ${int(x.s.restaurants)} places, ${stars(x.s.rating ?? city)} average, ${int(x.s.median_votes)} median votes.`),
        missing ? `Not listed under ${missing[0]}, where ${pct(missing[1].popular_share)} of places are popular.` : "",
      ].filter(Boolean),
      move: "Each category is a separate shelf customers browse. Get listed everywhere you genuinely fit, with category-specific photos.",
      tone: top.s.popular_share >= 0.3 ? "good" : "neutral", detail: "",
    });
  }

  return out.map((i) => ({ ...i, detail: i.move }));
}
