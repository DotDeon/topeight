/**
 * The Online Now! badge: a small orange rounded box with a person icon and the
 * words "Online Now!". Original artwork, plain SVG paths in fixed markup.
 * Styling lives in PROFILE_CSS (.online-now) and components/OnlineNow.module.css.
 */
export const ONLINE_NOW_TEXT = "Online Now!";

/** Inner markup of the 12x12 person icon: a head and shoulders. */
export const ONLINE_ICON_INNER = '<circle cx="6" cy="3.6" r="2.4" fill="#fff"/><path d="M1.2 11.2c0-2.6 2.2-4.2 4.8-4.2s4.8 1.6 4.8 4.2z" fill="#fff"/>';

/** The badge as an HTML string for the profile document. Contains no user input. */
export function onlineNowHtml(): string {
  return `<span class="online-now"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">${ONLINE_ICON_INNER}</svg>${ONLINE_NOW_TEXT}</span>`;
}
