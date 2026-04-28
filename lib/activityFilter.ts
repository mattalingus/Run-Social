/**
 * Multi-sport-aware activity match.
 *
 * A run row may carry either:
 *   - a single `activity_type` (legacy single-sport event), or
 *   - an `activity_types[]` array (multi-sport event, e.g. `["run","walk"]`).
 *
 * When the array is present and non-empty it's the source of truth; otherwise
 * fall back to the legacy single-type field.
 */
export function matchesActivity(
  run: { activity_type?: string | null; activity_types?: string[] | null },
  filter: string
): boolean {
  const types = Array.isArray(run.activity_types) ? run.activity_types : null;
  if (types && types.length > 0) return types.includes(filter);
  return (run.activity_type ?? "run") === filter;
}

/** All activity types this event supports, normalized to a non-empty array. */
export function eventActivityTypes(
  run: { activity_type?: string | null; activity_types?: string[] | null }
): string[] {
  const types = Array.isArray(run.activity_types) ? run.activity_types : null;
  if (types && types.length > 0) return types;
  return [run.activity_type ?? "run"];
}
