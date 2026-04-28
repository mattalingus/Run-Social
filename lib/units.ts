export type DistanceUnit = "miles" | "km";

const KM_PER_MILE = 1.60934;

function stripZeros(s: string): string {
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function truncate2(value: number): number {
  return Math.floor(value * 100) / 100;
}

function truncate1(value: number): number {
  return Math.floor(value * 10) / 10;
}

export function toDisplayDist(miles: number | null | undefined, unit: DistanceUnit): string {
  if (miles == null || !isFinite(miles) || isNaN(miles)) return unit === "km" ? "0 km" : "0 mi";
  if (unit === "km") {
    return `${stripZeros(truncate2(miles * KM_PER_MILE).toFixed(2))} km`;
  }
  return `${stripZeros(truncate2(miles).toFixed(2))} mi`;
}

export function toDisplayDistShort(miles: number | null | undefined, unit: DistanceUnit): string {
  if (miles == null) return "—";
  if (!isFinite(miles) || isNaN(miles)) return "—";
  if (unit === "km") {
    return `${truncate1(miles * KM_PER_MILE).toFixed(1)} km`;
  }
  return `${truncate1(miles).toFixed(1)} mi`;
}

export function toDisplayPace(minPerMile: number | null | undefined, unit: DistanceUnit): string {
  if (minPerMile == null || !isFinite(minPerMile) || isNaN(minPerMile)) return unit === "km" ? "—" : "—";
  const pace = unit === "km" ? minPerMile / KM_PER_MILE : minPerMile;
  let mins = Math.floor(pace);
  let secs = Math.round((pace - mins) * 60);
  if (secs === 60) { secs = 0; mins += 1; }
  const pad = secs < 10 ? "0" : "";
  return `${mins}:${pad}${secs} /${unit === "km" ? "km" : "mi"}`;
}

export function unitLabel(unit: DistanceUnit): string {
  return unit === "km" ? "km" : "mi";
}

/**
 * Common race distances (in miles). If a planned/goal distance lands within
 * tolerance of one of these, it should render as the race label (e.g. "5K",
 * "Half Marathon") instead of a raw number.
 */
const RACE_DISTANCES_MI: { mi: number; label: string }[] = [
  { mi: 0.62137, label: "1K" },
  { mi: 1.86411, label: "3K" },
  { mi: 3.10686, label: "5K" },
  { mi: 6.21371, label: "10K" },
  { mi: 9.32057, label: "15K" },
  { mi: 12.42742, label: "20K" },
  { mi: 13.10940, label: "Half Marathon" },
  { mi: 15.53428, label: "25K" },
  { mi: 18.64114, label: "30K" },
  { mi: 26.21880, label: "Marathon" },
  { mi: 31.06855, label: "50K" },
  { mi: 62.13711, label: "100K" },
];

// ~50m tolerance
const RACE_TOLERANCE_MI = 0.035;

/**
 * If miles is within tolerance of a common race distance, return its label.
 * Otherwise returns null.
 */
export function toRaceLabel(miles: number | null | undefined): string | null {
  if (miles == null || !isFinite(miles) || isNaN(miles)) return null;
  for (const r of RACE_DISTANCES_MI) {
    if (Math.abs(miles - r.mi) <= RACE_TOLERANCE_MI) return r.label;
  }
  return null;
}

/**
 * Smart distance display — shows "5K" / "Half Marathon" / "Marathon" when the
 * value matches a common race distance, otherwise falls back to the standard
 * unit-aware format.
 */
export function toDisplayDistSmart(miles: number | null | undefined, unit: DistanceUnit): string {
  const race = toRaceLabel(miles);
  if (race) return race;
  return toDisplayDist(miles, unit);
}

export function toDisplaySpeed(minPerMile: number | null | undefined, unit: DistanceUnit): string {
  if (minPerMile == null || !isFinite(minPerMile) || isNaN(minPerMile) || minPerMile <= 0) return "—";
  if (unit === "km") {
    const kmh = (KM_PER_MILE * 60) / minPerMile;
    return `${kmh.toFixed(1)} km/h`;
  }
  const mph = 60 / minPerMile;
  return `${mph.toFixed(1)} mph`;
}
