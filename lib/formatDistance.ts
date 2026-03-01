/**
 * Rounds a distance value to the nearest 0.5 and returns a clean display string.
 * Whole numbers are shown without a decimal (e.g. "6"),
 * half values show one decimal (e.g. "6.5").
 *
 * Does NOT include a unit — callers append " mi" or " km" as needed.
 *
 * @example
 * formatDistance(5.23)  // "5"
 * formatDistance(5.26)  // "5.5"
 * formatDistance(6.74)  // "6.5"
 * formatDistance(6.76)  // "7"
 */
export function formatDistance(value: number): string {
  const rounded = Math.round(value * 2) / 2;
  return rounded % 1 === 0 ? String(Math.round(rounded)) : rounded.toFixed(1);
}
