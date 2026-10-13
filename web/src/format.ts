export function rupees(v: number): string {
  return "₹" + Math.round(v).toLocaleString("en-IN");
}

export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function int(v: number): string {
  return Math.round(v).toLocaleString("en-IN");
}

export function stars(v: number): string {
  return `${v.toFixed(1)}★`;
}
