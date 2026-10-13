import { bandOf, FIX, gapCuisines, topComplaint } from "./insights";
import { int, pct, rupees, stars } from "./format";
import { predictPopular, predictRating } from "./predict";
import type { Area, Concept, Market, ModelData, Reviews } from "./types";

type M = ModelData["model"];

export type Action = { title: string; why: string; priority: "High" | "Medium" };
export type Opportunity = { lever: string; concept: Concept; from: number; to: number; ratingFrom: number; ratingTo: number; note: string };
export type Playbook = { situation: string; actions: Action[]; opportunities: Opportunity[] };

const competitorsIn = (a: Area | undefined, c: Concept) => (a ? c.cuisines.reduce((s, q) => s + (a.cuisine_counts[q] ?? 0), 0) : 0);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function context(mk: Market, c: Concept) {
  const area = mk.areas.find((a) => a.area === c.area);
  const comps = mk.areas.map((a) => competitorsIn(a, c));
  const competitors = competitorsIn(area, c);
  const crowded = competitors >= [...comps].sort((a, b) => a - b)[Math.floor(comps.length * 0.75)];
  const cityVotes = median(mk.areas.map((a) => a.median_votes));
  const busy = (area?.median_votes ?? 0) >= cityVotes;
  const cheaperThan = area ? area.costs.filter((v) => v > c.cost).length / area.costs.length : 0.5;
  const position = cheaperThan >= 0.6 ? "value" : cheaperThan <= 0.25 ? "premium" : "mid-market";
  const crowdedCuisines = c.cuisines.filter((q) => (mk.cuisine_stats[q]?.restaurants ?? 0) >= 1500);
  return { area, competitors, crowded, cityVotes, busy, cheaperThan, position, crowdedCuisines };
}

/** Plain-English comparison when the owner moves the concept to another area. */
export function compareAreas(mk: Market, from: Concept, to: Concept): string {
  const a = context(mk, from), b = context(mk, to);
  if (!a.area || !b.area) return "";
  const compChange = a.competitors ? (b.competitors - a.competitors) / a.competitors : 0;
  const parts = [
    `${to.area} has ${int(b.competitors)} restaurants serving your cuisines vs ${int(a.competitors)} in ${from.area}` +
      (Math.abs(compChange) >= 0.15 ? ` (${compChange < 0 ? "" : "+"}${Math.round(compChange * 100)}%)` : ""),
    `footfall ${b.busy === a.busy ? (b.area.median_votes >= a.area.median_votes ? "higher" : "lower") : b.busy ? "much higher" : "much lower"} (${int(b.area.median_votes)} vs ${int(a.area.median_votes)} median votes)`,
    a.position === b.position ? `your ${rupees(to.cost)} price is ${b.position} here, same as in ${from.area}` : `your ${rupees(to.cost)} price reads as ${b.position} here (was ${a.position})`,
  ];
  const footChange = a.area.median_votes ? (b.area.median_votes - a.area.median_votes) / a.area.median_votes : 0;
  const shifts: string[] = [];
  if (compChange >= 0.25) shifts.push("More direct competitors here, so standing out matters more: lead with a signature dish and push for early reviews.");
  if (compChange <= -0.25) shifts.push("Fewer direct competitors here, so every visibility rupee goes further: invest in awareness.");
  if (footChange <= -0.3) shifts.push("Footfall is lower, so marketing must create demand: wider delivery reach, local social media and launch offers.");
  if (footChange >= 0.3) shifts.push("Footfall is higher, so marketing can capture existing demand: promoted listings and storefront visibility at peak hours.");
  if (a.position !== b.position) shifts.push(b.position === "premium" ? "You'd now be one of the pricier options, so sell the experience, not the price." : b.position === "value" ? "You'd now be one of the cheaper options, so lead with value: combos and office-lunch deals." : "Your price is now mid-market here, so compete on quality and convenience.");
  const shift = shifts.length ? shifts.join(" ") : "The market looks similar; keep the same plan and focus on what makes you different.";
  return `${parts.join("; ")}. ${shift}`;
}

export function buildPlaybook(mk: Market, m: M, c: Concept, rv: Reviews): Playbook {
  const reviewLate = rv.themes.find((t) => t.theme.startsWith("Late delivery"))?.low ?? 0;
  const x = context(mk, c);
  const band = bandOf(c.cost);
  const ts = mk.type_stats[c.type];
  const on = mk.online.find((o) => o.band === band);
  const bk = mk.booking.find((b) => b.band === band);
  const pop = predictPopular(m, c), rating = predictRating(m, c);

  const situation =
    `A ${x.position} ${c.type} place serving ${c.cuisines.join(" + ")} in ${c.area}: ` +
    `${x.crowded ? "a crowded market for these cuisines" : "moderate competition for these cuisines"}, ` +
    `${x.busy ? "with strong footfall" : "with below-average footfall"}. ` +
    `Predicted ${stars(rating)} and a ${pct(pop)} chance of becoming popular (city average 25%).`;

  const actions: Action[] = [];
  if (!c.online && on) {
    actions.push({ priority: "High", title: "Launch on delivery apps before anything else",
      why: `At ${band}, restaurants with online ordering have ${int(on.votes_with)} median votes vs ${int(on.votes_without)} without. Without it you're invisible to app-first customers.` });
  }
  if (x.crowded || x.crowdedCuisines.length) {
    actions.push({ priority: "High", title: "Differentiate: lead every campaign with one signature dish",
      why: `${int(x.competitors)} restaurants in ${c.area} already serve ${c.cuisines.join(" or ")}${x.crowdedCuisines.length ? `, and ${x.crowdedCuisines.join(" and ")} ${x.crowdedCuisines.length > 1 ? "are" : "is"} among Bangalore's most crowded cuisines` : ""}. Generic menus get lost; a named hero item gives customers a reason to choose you.` });
  }
  if (x.busy) {
    actions.push({ priority: x.crowded ? "Medium" : "High", title: `Capture existing demand in ${c.area}`,
      why: `A typical restaurant here gets ${int(x.area?.median_votes ?? 0)} votes vs ${int(x.cityVotes)} in a typical area. Spend on promoted Zomato listings and storefront visibility at lunch and dinner peaks, where the traffic already is.` });
  } else {
    actions.push({ priority: "High", title: "Create demand: footfall here is below average",
      why: `A typical restaurant here gets ${int(x.area?.median_votes ?? 0)} votes vs ${int(x.cityVotes)} citywide. Widen reach with delivery to neighbouring areas, local Instagram creators and a launch offer for first orders.` });
  }
  if (x.position === "value") {
    actions.push({ priority: "Medium", title: "Message value: “meal for two under " + rupees(Math.ceil(c.cost / 50) * 50 + 50) + "”",
      why: `You'd be cheaper than ${pct(x.cheaperThan)} of ${c.area} restaurants. Combos and office-lunch deals turn a price advantage into repeat orders.` });
  } else if (x.position === "premium") {
    actions.push({ priority: "Medium", title: "Message the experience, not the price",
      why: `You'd be pricier than ${pct(1 - x.cheaperThan)} of ${c.area} restaurants. Premium places rate and get voted higher citywide, but only when ambience and service justify it: “great ambience” appears in 27% of 5★ reviews.${!c.booking && bk?.with ? " Add table booking to signal a destination." : ""}` });
  }
  if (c.online) {
    actions.push({ priority: "Medium", title: "Protect delivery ratings: packaging and delivery time",
      why: `Late delivery or long waits show up in ${pct(reviewLate, 0)} of 1–2★ reviews. A bad first delivery costs more than any campaign earns back.` });
  }
  // Cuisine-specific complaint: the most over-represented one across the chosen cuisines.
  const comp = c.cuisines.map((q) => ({ q, k: topComplaint(rv, "by_cuisine", q) })).filter((x) => x.k)
    .sort((a, b) => b.k!.lift - a.k!.lift)[0];
  if (comp?.k) {
    actions.push({ priority: comp.k.lift >= 1.5 ? "High" : "Medium", title: `Pre-empt the top ${comp.q} complaint: ${comp.k.theme.toLowerCase()}`,
      why: `Unhappy ${comp.q} customers mention it ${comp.k.lift.toFixed(1)}× more than average (${pct(comp.k.share)} of 1–2★ reviews). Marketing move: ${FIX[comp.k.theme]}.` });
  }
  const gaps = x.area ? gapCuisines(mk, x.area, c.cuisines) : [];
  if (gaps.length) {
    actions.push({ priority: "Medium", title: `Fill a local gap: add ${gaps[0].q} to the menu`,
      why: `${gaps[0].q} is under-represented in ${c.area} compared with the rest of Bangalore, and rates ${stars(gaps[0].s.rating ?? 0)} citywide. A few ${gaps[0].q} dishes give locals a reason to pick you over the usual options.` });
  }
  if (x.area) {
    const nearby = x.area.costs.filter((v) => Math.abs(v - c.cost) <= 100).length / x.area.costs.length;
    if (nearby >= 0.35) {
      actions.push({ priority: "Medium", title: `Don't compete on price: ${pct(nearby)} of ${c.area} sits in your price slot`,
        why: `That many restaurants price within ±₹100 of ${rupees(c.cost)}. Discounts just match everyone else; a combo, loyalty card or signature dish gives customers a reason that isn't price.` });
    }
  }
  const tcomp = topComplaint(rv, "by_type", c.type);
  if (tcomp && tcomp.lift >= 1.3 && tcomp.theme !== comp?.k?.theme) {
    actions.push({ priority: "Medium", title: `${c.type} customers are sensitive to ${tcomp.theme.toLowerCase()}`,
      why: `It comes up ${tcomp.lift.toFixed(1)}× more than average in bad ${c.type} reviews. Marketing move: ${FIX[tcomp.theme]}.` });
  }
  if (c.booking && (bk?.with ?? null) !== null) {
    actions.push({ priority: "Medium", title: "Sell reservations: weekend dinners, birthdays and groups",
      why: `At ${band}, places with booking average ${stars(bk!.with!)} and ${int(bk!.votes_with ?? 0)} votes vs ${stars(bk!.without ?? 0)} and ${int(bk!.votes_without ?? 0)} without. Promote booking slots on Zomato and Instagram to make the place feel in-demand.` });
  }
  if (c.outlets > 1) {
    const ch = mk.by_chain.find((k) => k.kind === (c.outlets <= 5 ? "Small chain (2–5)" : "Large chain (6+)"));
    actions.push({ priority: "Medium", title: `Market the brand, not the outlet: ${c.outlets} outlets share one reputation`,
      why: `Chains of this size get ${int(ch?.median_votes ?? 0)} median votes, more visibility than independents, but no better ratings. Run city-wide campaigns and keep quality consistent, because one weak kitchen drags every outlet's rating.` });
  } else {
    actions.push({ priority: "Medium", title: "Tell the founder story: you have no brand recognition yet",
      why: "Independents rate as well as chains but get far fewer votes. Local press, the founder's story and a push for the first 50 reviews are the cheapest ways to close that gap." });
  }
  actions.push({ priority: "Medium", title: "Make taste and service the brand promise, and answer every bad review",
    why: "Bad taste and rude service are the clearest differences between 1★ and 5★ reviews. Price complaints are just as common in good reviews, so discounts don't fix ratings." });
  if (ts && ts.popular_share < 0.2) {
    actions.push({ priority: "Medium", title: `Plan offline marketing for a ${c.type.toLowerCase()}`,
      why: `Only ${pct(ts.popular_share)} of ${c.type} places become popular on Zomato. This format relies on walk-ins, so signage, neighbourhood tie-ups and loyalty cards matter more than app ads.` });
  }

  // Where the business value is: let the model test alternatives.
  const opp: Opportunity[] = [];
  const add = (lever: string, concept: Concept, note: string) => {
    const p = predictPopular(m, concept), r = predictRating(m, concept);
    if (p - pop >= 0.02) opp.push({ lever, concept, from: pop, to: p, ratingFrom: rating, ratingTo: r, note });
  };
  if (!c.online) add("Turn on online ordering", { ...c, online: true, listings: [...new Set([...c.listings, "Delivery"])] }, "Delivery visibility");
  if (!c.booking && c.cost >= 500) add("Offer table booking", { ...c, booking: true }, "Signals a dine-in destination");
  let bestPrice: Concept | null = null, bestP = pop;
  for (let cost = Math.max(100, c.cost - 300); cost <= c.cost + 300; cost += 50) {
    const k = { ...c, cost };
    const p = predictPopular(m, k);
    if (p > bestP + 0.02 && predictRating(m, k) >= rating - 0.05) { bestP = p; bestPrice = k; }
  }
  if (bestPrice) add(`Price at ${rupees(bestPrice.cost)} for two`, bestPrice, bestPrice.cost > c.cost ? "Premium positioning" : "Sharper value");
  let bestList: Concept | null = null, bestLP = pop, bestL = "";
  for (const l of m.listings.filter((l) => !c.listings.includes(l))) {
    const k = { ...c, listings: [...c.listings, l] };
    const p = predictPopular(m, k);
    if (p > bestLP) { bestLP = p; bestList = k; bestL = l; }
  }
  if (bestList) add(`Also list under “${bestL}” on Zomato`, bestList, "Another shelf to be found on");
  const lessCrowded = mk.areas
    .filter((a) => m.areas.includes(a.area) && a.area !== c.area && competitorsIn(a, c) < x.competitors * 0.6)
    .map((a) => ({ a, p: predictPopular(m, { ...c, area: a.area }) }))
    .sort((p, q) => q.p - p.p)[0];
  if (lessCrowded) add(`Open in ${lessCrowded.a.area} instead`, { ...c, area: lessCrowded.a.area },
    `${int(competitorsIn(lessCrowded.a, c))} competitors vs ${int(x.competitors)}`);
  if (x.crowdedCuisines.length) {
    const swapOut = x.crowdedCuisines[0];
    const city = mk.totals.mean_rating;
    const swap = m.cuisines.slice(0, 30)
      .filter((q) => !c.cuisines.includes(q) && (mk.cuisine_stats[q]?.restaurants ?? 9999) < 1500 && (mk.cuisine_stats[q]?.rating ?? 0) >= city)
      .map((q) => { const k = { ...c, cuisines: c.cuisines.map((v) => (v === swapOut ? q : v)) }; return { q, k, p: predictPopular(m, k) }; })
      .sort((a, b) => b.p - a.p)[0];
    if (swap) add(`Swap ${swapOut} for ${swap.q}`, swap.k, `${swap.q}: less crowded, rated ${stars(mk.cuisine_stats[swap.q].rating ?? 0)} citywide`);
  }
  opp.sort((a, b) => (b.to - b.from) - (a.to - a.from));

  const order = { High: 0, Medium: 1 };
  actions.sort((a, b) => order[a.priority] - order[b.priority]);
  return { situation, actions: actions.slice(0, 6), opportunities: opp.slice(0, 4) };
}
