import type { Concept, ModelData, Tree } from "./types";

type M = ModelData["model"];

/** Build the model's input columns from a concept: must mirror analysis/model.py Encoder. */
export function encode(m: M, c: Concept): number[] {
  const x = new Array(m.columns.length).fill(0);
  x[0] = c.cost;
  x[1] = c.online ? 1 : 0;
  x[2] = c.booking ? 1 : 0;
  x[3] = Math.min(60, c.outlets);
  x[4] = c.cuisines.length;
  const set = (name: string) => {
    const i = m.columns.indexOf(name);
    if (i >= 0) x[i] = 1;
  };
  set(`area:${c.area}`);
  c.cuisines.forEach((q) => set(`cuisine:${q}`));
  set(`type:${c.type}`);
  c.listings.forEach((l) => set(`listed:${l}`));
  return x;
}

function runTrees(trees: Tree[], baseline: number, x: number[]): number {
  let raw = baseline;
  for (const tree of trees) {
    let n = tree[0];
    while (!n[5]) n = tree[x[n[0]] <= n[1] ? n[3] : n[4]];
    raw += n[6];
  }
  return raw;
}

export function predictRating(m: M, c: Concept): number {
  return Math.min(4.9, Math.max(1.8, runTrees(m.rating.trees, m.rating.baseline, encode(m, c))));
}

export function predictPopular(m: M, c: Concept): number {
  return 1 / (1 + Math.exp(-runTrees(m.popularity.trees, m.popularity.baseline, encode(m, c))));
}
