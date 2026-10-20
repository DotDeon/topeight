import { describe, expect, test } from "vitest";
import { formatEventTime, isTimeOfDay, isTimeZone, toUtc } from "../lib/eventTime";

const utc = (iso: string) => Date.parse(iso);

describe("toUtc", () => {
  test("Africa/Johannesburg has no DST", () => {
    expect(toUtc("2026-10-24", "20:00", "Africa/Johannesburg")).toBe(utc("2026-10-24T18:00:00Z"));
    expect(toUtc("2026-01-15", "09:30", "Africa/Johannesburg")).toBe(utc("2026-01-15T07:30:00Z"));
  });

  test("Europe/London either side of the October change", () => {
    expect(toUtc("2026-10-24", "20:00", "Europe/London")).toBe(utc("2026-10-24T19:00:00Z"));
    expect(toUtc("2026-10-26", "20:00", "Europe/London")).toBe(utc("2026-10-26T20:00:00Z"));
    expect(toUtc("2026-03-28", "12:00", "Europe/London")).toBe(utc("2026-03-28T12:00:00Z"));
    expect(toUtc("2026-03-30", "12:00", "Europe/London")).toBe(utc("2026-03-30T11:00:00Z"));
  });

  test("America/New_York summer and winter", () => {
    expect(toUtc("2026-07-04", "21:00", "America/New_York")).toBe(utc("2026-07-05T01:00:00Z"));
    expect(toUtc("2026-12-31", "23:59", "America/New_York")).toBe(utc("2027-01-01T04:59:00Z"));
  });

  test("a spring-forward gap time resolves to the first valid instant after the gap", () => {
    // 02:00-03:00 does not exist in New York on 8 March 2026; 03:00 EDT is 07:00Z.
    expect(toUtc("2026-03-08", "02:30", "America/New_York")).toBe(utc("2026-03-08T07:00:00Z"));
    expect(toUtc("2026-03-08", "02:00", "America/New_York")).toBe(utc("2026-03-08T07:00:00Z"));
    expect(toUtc("2026-03-08", "03:00", "America/New_York")).toBe(utc("2026-03-08T07:00:00Z"));
    // 01:00-02:00 does not exist in London on 29 March 2026; 02:00 BST is 01:00Z.
    expect(toUtc("2026-03-29", "01:30", "Europe/London")).toBe(utc("2026-03-29T01:00:00Z"));
  });

  test("a fall-back ambiguous time resolves to the earlier offset", () => {
    // 01:30 happens twice in New York on 1 November 2026; the first is EDT.
    expect(toUtc("2026-11-01", "01:30", "America/New_York")).toBe(utc("2026-11-01T05:30:00Z"));
    // 01:30 happens twice in London on 25 October 2026; the first is BST.
    expect(toUtc("2026-10-25", "01:30", "Europe/London")).toBe(utc("2026-10-25T00:30:00Z"));
    expect(toUtc("2026-10-25", "02:00", "Europe/London")).toBe(utc("2026-10-25T02:00:00Z"));
  });

  test("UTC", () => {
    expect(toUtc("2026-10-24", "00:00", "UTC")).toBe(utc("2026-10-24T00:00:00Z"));
  });
});

describe("isTimeZone", () => {
  test("accepts IANA names and rejects junk and raw offsets", () => {
    for (const z of ["Africa/Johannesburg", "Europe/London", "America/New_York", "UTC", "America/Argentina/Buenos_Aires"]) {
      expect(isTimeZone(z)).toBe(true);
    }
    for (const z of ["", "Mars/Olympus", "not a zone", "+02:00", "-05:00", "x".repeat(65)]) {
      expect(isTimeZone(z)).toBe(false);
    }
  });
});

describe("isTimeOfDay", () => {
  test("HH:MM on a 24 hour clock", () => {
    for (const s of ["00:00", "09:05", "23:59"]) expect(isTimeOfDay(s)).toBe(true);
    for (const s of ["24:00", "9:05", "12:60", "12:5", "noon", "12:00:00"]) expect(isTimeOfDay(s)).toBe(false);
  });
});

describe("formatEventTime", () => {
  test("Europe/London shows BST and GMT", () => {
    expect(formatEventTime(utc("2026-10-24T19:00:00Z"), "Europe/London")).toBe("Sat 24 Oct 2026, 8:00 PM BST");
    expect(formatEventTime(utc("2026-10-26T20:00:00Z"), "Europe/London")).toBe("Mon 26 Oct 2026, 8:00 PM GMT");
  });

  test("UTC, midnight, noon and September", () => {
    expect(formatEventTime(utc("2026-09-01T00:05:00Z"), "UTC")).toBe("Tue 1 Sep 2026, 12:05 AM UTC");
    expect(formatEventTime(utc("2026-09-01T12:00:00Z"), "UTC")).toBe("Tue 1 Sep 2026, 12:00 PM UTC");
  });

  test("Africa/Johannesburg shows its local time with an abbreviation", () => {
    // Node 22's ICU prints GMT+2 for this zone in en-GB; a browser may print SAST.
    expect(formatEventTime(utc("2026-10-24T18:00:00Z"), "Africa/Johannesburg")).toMatch(
      /^Sat 24 Oct 2026, 8:00 PM (GMT\+2|SAST)$/,
    );
  });
});
