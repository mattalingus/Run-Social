/**
 * Returns a distance as a string with up to 2 decimal places.
 * Trailing zeros are stripped so whole numbers display cleanly.
 *
 * Does NOT include a unit — callers append " mi" or " km" as needed.
 *
 * @example
 * formatDistance(1.25)   // "1.25"
 * formatDistance(1.50)   // "1.5"
 * formatDistance(5.00)   // "5"
 * formatDistance(0.08)   // "0.08"
 */
export function formatDistance(value: number): string {
  if (!isFinite(value) || isNaN(value)) return "0";
  const fixed = value.toFixed(2);
  // Strip trailing zeros: "1.50" → "1.5", "5.00" → "5"
  return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
