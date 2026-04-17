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
  if (miles == null || !isFinite(miles) || isNaN(miles)) return unit === "km" ? "0 km" : "0 mi";
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
