export type Tree = [number, number, number, number, number, number, number][];

export type ModelData = {
  metrics: {
    n_rated: number;
    rating: Record<string, { mae: number; within_0_3: number; within_0_5: number }>;
    popular_cut_votes: number;
    popularity: Record<string, { auc: number }>;
    importance_rating: Record<string, number>;
    importance_popularity: Record<string, number>;
  };
  scatter: { actual: number; predicted: number }[];
  model: {
    columns: string[];
    areas: string[];
    cuisines: string[];
    types: string[];
    listings: string[];
    rating: { baseline: number; trees: Tree[] };
    popularity: { baseline: number; trees: Tree[] };
  };
};

export type Area = {
  area: string;
  restaurants: number;
  rating: number | null;
  median_votes: number;
  median_cost: number;
  costs: number[];
  online_share: number;
  booking_share: number;
  cuisine_counts: Record<string, number>;
  type_counts: Record<string, number>;
  cuisine_ratings: Record<string, number>;
};

export type GroupStats = {
  restaurants: number;
  rating: number | null;
  median_votes: number;
  popular_share: number;
  median_cost: number;
  online_share: number;
  areas: number;
};

export type Market = {
  totals: {
    restaurants: number;
    rated: number;
    areas: number;
    median_cost: number;
    mean_rating: number;
    online_share: number;
    chains_share: number;
  };
  by_price: { band: string; restaurants: number; rating: number; median_votes: number }[];
  online: { band: string; with: number; without: number; n_with: number; n_without: number; votes_with: number; votes_without: number }[];
  by_chain: { kind: string; restaurants: number; rating: number; median_votes: number }[];
  by_cuisine: { cuisines: string; restaurants: number; rating: number; median_votes: number; cost: number }[];
  areas: Area[];
  cuisine_stats: Record<string, GroupStats>;
  type_stats: Record<string, GroupStats>;
  listing_stats: Record<string, GroupStats>;
  cuisine_band: Record<string, Record<string, { n: number; rating: number; median_votes: number }>>;
  booking: { band: string; share: number; with: number | null; without: number | null; votes_with: number | null; votes_without: number | null }[];
};

export type GroupThemes = { n_low: number; low_share: number; low: Record<string, number>; high: Record<string, number> };

export type Reviews = {
  n_low: number;
  n_high: number;
  n_reviews: number;
  low_share: number;
  themes: { theme: string; low: number; high: number }[];
  by_cuisine: Record<string, GroupThemes>;
  by_type: Record<string, GroupThemes>;
};

export type OsmArea = { lat: number; lon: number; total: number; previous: number | null; types: Record<string, number>; cuisines: Record<string, number>; tagged_share: number };

export type Osm = {
  fetched_at: string;
  osm_data_time: string;
  previous_fetched_at: string | null;
  radius_km: number;
  total: number;
  types: Record<string, number>;
  cuisines: Record<string, number>;
  tagged_share: number;
  areas: Record<string, OsmArea>;
  attribution: string;
};

export type Data = { market: Market; reviews: Reviews; model: ModelData; osm: Osm | null };

export type Concept = {
  area: string;
  cuisines: string[];
  type: string;
  cost: number;
  online: boolean;
  booking: boolean;
  outlets: number;
  listings: string[];
};
