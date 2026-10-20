/**
 * Event times. An event keeps the host's local date, time and IANA timezone;
 * these turn that into a UTC instant and back into a display string, using
 * only Intl so the same code runs in Convex, Node and the browser.
 */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const MAX_ZONE = 64;

const offsetFormats = new Map<string, Intl.DateTimeFormat>();

function offsetFormat(timeZone: string): Intl.DateTimeFormat {
  let f = offsetFormats.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    offsetFormats.set(timeZone, f);
  }
  return f;
}

/** The zone's offset from UTC at instant t, in ms (local wall clock minus UTC). */
function offsetAt(t: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of offsetFormat(timeZone).formatToParts(t)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return wall - Math.floor(t / 1000) * 1000;
}

/** True for an IANA zone name Intl knows. Raw offsets like "+02:00" are refused. */
export function isTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > MAX_ZONE) return false;
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The zone's canonical IANA name, so "europe/london" becomes "Europe/London". Input must pass isTimeZone. */
export function canonicalTimeZone(value: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
}

/** True for "HH:MM" on a 24 hour clock. */
export function isTimeOfDay(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * The UTC instant, in ms, of a local date ("YYYY-MM-DD") and time ("HH:MM") in
 * an IANA zone. Inputs must already be valid.
 *
 * Probes the zone's offset a day either side and at the naive instant, and
 * keeps each candidate whose offset is a fixed point (reading it back in the
 * zone gives the asked-for wall time). A fall-back time has two such
 * candidates and gets the earlier one. A spring-forward time has none and gets
 * the first valid instant after the gap: the transition itself.
 */
export function toUtc(localDate: string, localTime: string, timeZone: string): number {
  const [y, mo, d] = localDate.split("-").map(Number);
  const [h, mi] = localTime.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);

  const offsets = new Set([offsetAt(wall - DAY, timeZone), offsetAt(wall, timeZone), offsetAt(wall + DAY, timeZone)]);
  const fits: number[] = [];
  for (const o of offsets) {
    const t = wall - o;
    if (offsetAt(t, timeZone) === o) fits.push(t);
  }
  if (fits.length > 0) return Math.min(...fits);

  // In a gap. Reading the wall time with the offset before the change lands
  // after the transition, with the offset after it lands before. Binary search
  // between them for the first instant on the later offset.
  const before = offsetAt(wall - DAY, timeZone);
  const after = offsetAt(wall + DAY, timeZone);
  let lo = wall - after;
  let hi = wall - before;
  if (lo > hi) [lo, hi] = [hi, lo];
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2000) * 1000;
    if (offsetAt(mid, timeZone) === after) hi = mid;
    else lo = mid;
  }
  return hi;
}

const displayFormats = new Map<string, Intl.DateTimeFormat>();
const abbrFormats = new Map<string, Intl.DateTimeFormat>();
/** Locales tried, in order, for a letter abbreviation when en-GB prints a GMT offset. */
const ABBR_LOCALES = ["en-US", "en-ZA", "en-AU"];

/** The first of en-US, en-ZA, en-AU that names the zone in letters (EDT, SAST, AEDT), or null. */
function letterAbbreviation(startsAt: number, timeZone: string): string | null {
  for (const locale of ABBR_LOCALES) {
    const key = `${locale}|${timeZone}`;
    let f = abbrFormats.get(key);
    if (f === undefined) {
      f = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" });
      abbrFormats.set(key, f);
    }
    const name = f.formatToParts(startsAt).find((p) => p.type === "timeZoneName")?.value;
    if (name !== undefined && /^[A-Z]{2,5}$/.test(name)) return name;
  }
  return null;
}

/**
 * An event's start in its own zone, like "Sat 24 Oct 2026, 8:00 PM BST".
 * The format is en-GB. Where en-GB only has a GMT offset ("GMT+2"), the
 * abbreviation comes from en-US, en-ZA or en-AU instead (EDT, SAST, AEDT),
 * and stays the offset when none of them has letters.
 */
export function formatEventTime(startsAt: number, timeZone: string): string {
  let f = displayFormats.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    });
    displayFormats.set(timeZone, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(startsAt)) p[part.type] = part.value;
  // en-GB writes September as "Sept".
  const month = p.month.slice(0, 3);
  const zone = /^GMT[+\-\u2212]/.test(p.timeZoneName)
    ? (letterAbbreviation(startsAt, timeZone) ?? p.timeZoneName)
    : p.timeZoneName;
  return `${p.weekday} ${p.day} ${month} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()} ${zone}`;
}
