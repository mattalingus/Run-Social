/**
 * Timezone-aware event date/time formatting helpers.
 *
 * All functions accept the host's IANA timezone string (e.g. "America/Chicago").
 * When timezone is null/undefined/empty the device's local timezone is used as a
 * safe fallback so callers never need to guard against missing timezone data.
 */

function effectiveTz(timezone: string | null | undefined): string | undefined {
  return timezone && timezone.length > 0 ? timezone : undefined;
}

/**
 * Returns the time portion with timezone abbreviation.
 * Example: "7:00 AM CDT"
 */
export function formatEventTime(isoString: string, timezone: string | null | undefined): string {
  try {
    const tz = effectiveTz(timezone);
    const opts: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      ...(tz ? { timeZone: tz } : {}),
    };
    const parts = new Intl.DateTimeFormat("en-US", opts).formatToParts(new Date(isoString));
    const hour = parts.find((p) => p.type === "hour")?.value ?? "";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "";
    const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
    const tzAbbr = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    return `${hour}:${minute} ${dayPeriod}${tzAbbr ? ` ${tzAbbr}` : ""}`.trim();
  } catch {
    return new Date(isoString).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
}

/**
 * Returns a short date label: "Today", "Tomorrow", or "Sat, May 3".
 * The comparison is done in the event's timezone so the label is accurate
 * for the host's local calendar day.
 */
export function formatEventDateLabel(isoString: string, timezone: string | null | undefined): string {
  try {
    const tz = effectiveTz(timezone);
    const d = new Date(isoString);
    const now = new Date();
    const calOpts: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(tz ? { timeZone: tz } : {}),
    };
    const fmt = new Intl.DateTimeFormat("en-US", calOpts);
    const eventDateStr = fmt.format(d);
    const todayStr = fmt.format(now);
    const tomorrowStr = fmt.format(new Date(now.getTime() + 86_400_000));
    if (eventDateStr === todayStr) return "Today";
    if (eventDateStr === tomorrowStr) return "Tomorrow";
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(tz ? { timeZone: tz } : {}),
    }).format(d);
  } catch {
    return new Date(isoString).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
}

/**
 * Returns a combined date + time string with timezone abbreviation.
 * Relative labels ("Today", "Tomorrow") are used when appropriate.
 * Example: "Today · 7:00 AM CDT"  |  "Sat, May 3 · 7:00 AM CDT"
 */
export function formatEventDateTime(isoString: string, timezone: string | null | undefined): string {
  return `${formatEventDateLabel(isoString, timezone)} · ${formatEventTime(isoString, timezone)}`;
}

/**
 * Returns a long-form date without time, for use in run detail headers.
 * Example: "Saturday, May 3, 2025"
 */
export function formatEventDateFull(isoString: string, timezone: string | null | undefined): string {
  try {
    const tz = effectiveTz(timezone);
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      ...(tz ? { timeZone: tz } : {}),
    }).format(new Date(isoString));
  } catch {
    return new Date(isoString).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
}
