import { describe, expect, test } from "vitest";
import { eventFormReady } from "@/components/events/EventForm";

const filled = { title: "Gig", localDate: "2026-10-24", localTime: "20:00", venue: "Club", city: "Durban" };

describe("eventFormReady", () => {
  test("anyone else needs a title, date, time, venue and city", () => {
    expect(eventFormReady({ ...filled, venueCity: null, rosterLoaded: true })).toBe(true);
    expect(eventFormReady({ ...filled, venue: " ", venueCity: null, rosterLoaded: true })).toBe(false);
  });

  test("a venue waits for its roster, so a save can't wipe the lineup", () => {
    const venue = { ...filled, venue: "", city: "", venueCity: "Cape Town" };
    expect(eventFormReady({ ...venue, rosterLoaded: false })).toBe(false);
    expect(eventFormReady({ ...venue, rosterLoaded: true })).toBe(true);
    expect(eventFormReady({ ...venue, venueCity: " ", rosterLoaded: true })).toBe(false);
  });
});
