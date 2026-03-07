export type DistanceUnit = "miles" | "km";

const KM_PER_MILE = 1.60934;

function stripZeros(s: string): string {
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function toDisplayDist(miles: number | null | undefined, unit: DistanceUnit): string {
  if (miles == null || !isFinite(miles) || isNaN(miles)) return unit === "km" ? "0 km" : "0 mi";
  if (unit === "km") {
    return `${stripZeros((miles * KM_PER_MILE).toFixed(2))} km`;
  }
  return `${stripZeros(miles.toFixed(2))} mi`;
}

export function toDisplayDistShort(miles: number | null | undefined, unit: DistanceUnit): string {
  if (miles == null || !isFinite(miles) || isNaN(miles)) return unit === "km" ? "0 km" : "0 mi";
  if (unit === "km") {
    return `${(miles * KM_PER_MILE).toFixed(1)} km`;
  }
  return `${miles.toFixed(1)} mi`;
}

export function toDisplayPace(minPerMile: number | null | undefined, unit: DistanceUnit): string {
  if (minPerMile == null || !isFinite(minPerMile) || isNaN(minPerMile)) return unit === "km" ? "—" : "—";
  const pace = unit === "km" ? minPerMile / KM_PER_MILE : minPerMile;
  const mins = Math.floor(pace);
  const secs = Math.round((pace - mins) * 60);
  const pad = secs < 10 ? "0" : "";
  return `${mins}:${pad}${secs} /${unit === "km" ? "km" : "mi"}`;
}

export function unitLabel(unit: DistanceUnit): string {
  return unit === "km" ? "km" : "mi";
}
