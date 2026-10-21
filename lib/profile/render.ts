import { BRIDGE_ACTIONS, BRIDGE_PAGES, MAX_TRACK_ID_LENGTH, type BridgePage } from "@/lib/bridge-protocol";
import { tokenizeComment } from "@/lib/validation";
import { moodLabel, moodSvg } from "@/lib/moodSvg";
import { MOOD_ICONS } from "@/lib/moods";
import { onlineNowHtml } from "@/lib/onlineBadge";
import { PROFILE_CSS } from "./profile-css";
import type { PublicCard, PublicProfile } from "./types";

export type { PublicCard, PublicProfile } from "./types";

export type RenderOptions = {
  mainOrigin: string;
  /** A CSP for a <meta http-equiv> tag, put first in <head>. For srcdoc previews, which get no CSP header. */
  cspMeta?: string;
  /** The usercontent origin. When set, the player refreshes its signed URLs from `<origin>/<username>?format=tracks`. */
  usercontentOrigin?: string;
  /** Leave the "Add to my profile" links off. Set when the viewer is looking at their own page. */
  hidePick?: boolean;
};

/** How often the player fetches fresh playback URLs. They live 15 minutes. */
export const PLAYBACK_REFRESH_MS = 12 * 60 * 1000;

const MAX_COMMENTS = 10;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------- escaping

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for HTML element content and double-quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/** JSON that is safe inside an inline <script>: no `<`, `>`, `&`, U+2028 or U+2029. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

/**
 * Stops custom CSS from closing its <style> element. Every `</` becomes `<\/`,
 * which covers `</style` in any case. CSS reads `\/` as `/` in strings, URLs
 * and identifiers, so valid stylesheets keep their meaning.
 */
function neutraliseStyle(css: string): string {
  return css.replace(/<\//g, "<\\/");
}

/** Stops custom JS from closing its <script> element. */
function neutraliseScript(js: string): string {
  return js.replace(/<\/(script)/gi, "<\\/$1");
}

/** Escaped text with newlines kept as line breaks. */
function textHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

/** Only http(s) URLs may appear in src attributes we write. */
function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- formatting

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "19 Oct 2026 9:14 PM", always UTC. */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  const h = d.getUTCHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${hour12}:${pad2(d.getUTCMinutes())} ${h < 12 ? "AM" : "PM"}`;
}

/** "18/10/2026", always UTC. */
function formatDay(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** "2026-10-24" to "24 Oct 2026". Anything else is shown as given. */
function formatShowDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return value;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${m[3]} ${month} ${m[1]}` : value;
}

function formatCount(n: number): string {
  return String(Math.max(0, Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** getPublicProfile counts at most 1001 comments; anything over 1000 shows as "1000+". */
const MAX_COUNTED_COMMENTS = 1000;

function formatCommentTotal(n: number): string {
  return n > MAX_COUNTED_COMMENTS ? `${MAX_COUNTED_COMMENTS}+` : formatCount(n);
}

// ---------------------------------------------------------------- pieces

function photo(url: string | null, className: string): string {
  const src = safeUrl(url);
  if (!src) return `<div class="${className} default-photo">No Photo</div>`;
  return `<img class="${className}" src="${escapeHtml(src)}" alt="">`;
}

function navLink(username: string, label: string, page?: BridgePage): string {
  const pageAttr = page ? ` data-topeight-page="${page}"` : "";
  return `<a href="#" data-topeight-navigate="${escapeHtml(username)}"${pageAttr}>${label}</a>`;
}

function actionLink(action: string, label: string): string {
  return `<a href="#" data-topeight-action="${action}">${label}</a>`;
}

/** Plain text with image URLs as <img> and other http(s) URLs as links. */
function richText(body: string): string {
  return tokenizeComment(body)
    .map((token) => {
      if (token.type === "text") return textHtml(token.value);
      const url = escapeHtml(token.url);
      if (token.type === "image") return `<img src="${url}" alt="">`;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    })
    .join("");
}

function detailsRows(rows: Array<[string, string | undefined]>): string {
  return rows
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${textHtml(v!)}</td></tr>`)
    .join("");
}

type PlayerRow = { id: string; title: string; url: string; autoplay: boolean; by?: PublicCard };

/**
 * The rows the player shows. The profile song (if it has a playable URL) comes
 * first, labelled with its artist. Fans get only that; artists follow it with
 * their own tracks, skipping their own song if they picked it.
 */
function playerRows(p: PublicProfile): PlayerRow[] {
  const song = p.profileSong && safeUrl(p.profileSong.url) !== null ? p.profileSong : null;
  const rows: PlayerRow[] = song
    ? [{ id: song.id, title: song.title, url: song.url!, autoplay: true, by: song.artist }]
    : [];
  if (p.kind !== "artist") return rows;
  for (const t of p.tracks) {
    if (safeUrl(t.url) === null || t.id === song?.id) continue;
    rows.push({ id: t.id, title: t.title, url: t.url!, autoplay: song ? false : t.autoplay });
  }
  return rows;
}

function playerRow(t: PlayerRow, i: number, current: boolean, hidePick: boolean): string {
  const report = `<a href="#" class="player-report" data-topeight-report-track="${escapeHtml(t.id)}">Report</a>`;
  const button = `<button type="button" class="player-track${current ? " current" : ""}" data-index="${i}" data-track-id="${escapeHtml(t.id)}" data-src="${escapeHtml(t.url)}"><span><span class="mark">&#9654; </span>${escapeHtml(t.title)}</span><span class="dur"></span></button>`;
  // Links sit outside the button, so clicking them never toggles playback.
  if (t.by) {
    // Reports the artist's track. No pick link: the visitor already sees it as this profile's song.
    return `<li class="player-song">${button}<span class="player-by"> by ${navLink(t.by.username, escapeHtml(t.by.displayName))}</span>${report}</li>`;
  }
  const pick = hidePick
    ? ""
    : ` <a href="#" class="player-pick" data-topeight-pick-track="${escapeHtml(t.id)}">Add to my profile</a>`;
  return `<li>${button}${report}${pick}</li>`;
}

function renderPlayer(p: PublicProfile, name: string, opts: RenderOptions): string {
  const tracks = playerRows(p);
  if (tracks.length === 0) return "";
  const autoplay = tracks.findIndex((t) => t.autoplay);
  const first = autoplay >= 0 ? autoplay : 0;
  const items = tracks.map((t, i) => playerRow(t, i, i === first, opts.hidePick === true || p.shareSongs === false)).join("");
  const refresh = opts.usercontentOrigin
    ? ` data-tracks-url="${escapeHtml(`${opts.usercontentOrigin.replace(/\/+$/, "")}/${encodeURIComponent(p.username)}?format=tracks`)}"`
    : "";
  return `<div class="player" id="topeight-player-ui" data-autoplay="${autoplay}"${refresh}>
<b>${name}</b> &middot; music player
<audio id="topeight-player" preload="metadata" controlsList="nodownload" src="${escapeHtml(tracks[first].url)}"></audio>
<div class="player-controls"><button type="button" class="player-play">Play</button><button type="button" class="player-mute">Mute</button><span class="player-time">0:00</span></div>
<div class="player-bar"><i></i></div>
<ul class="player-tracks">${items}</ul>
</div>`;
}

/** "Mood: <icon> text". The icon comes from fixed markup keyed by a known id; the text is escaped. */
function moodLine(mood: PublicProfile["mood"]): string {
  const icon = MOOD_ICONS.find((i) => i === mood?.icon);
  if (!mood || !icon) return "";
  return `<span class="mood">Mood: ${moodSvg(icon)} ${escapeHtml(mood.text || moodLabel(icon))}</span>`;
}

function renderLeft(p: PublicProfile, opts: RenderOptions): string {
  const name = escapeHtml(p.displayName);
  const isArtist = p.kind === "artist";
  // Fans: gender, age and location on their own lines in one block, as in 2006.
  const who = isArtist
    ? [escapeHtml(p.genre ?? ""), textHtml(p.location)]
    : [
        [
          escapeHtml(p.gender?.trim() ?? ""),
          p.age !== undefined ? `${formatCount(p.age)} years old` : "",
          textHtml(p.location.trim()),
        ]
          .filter(Boolean)
          .join("<br>"),
      ];
  const facts = [
    p.headline ? `"${escapeHtml(p.headline)}"` : "",
    moodLine(p.mood),
    ...who,
    `Profile Views: ${formatCount(p.profileViews)}`,
    `Last Login: ${formatDay(p.lastLoginAt)}`,
  ].filter(Boolean);

  let host = opts.mainOrigin;
  try {
    host = new URL(opts.mainOrigin).host;
  } catch {
    /* keep as given */
  }

  const details = isArtist
    ? `<div class="details"><h5>${name}'s General Info</h5><table>${detailsRows([
        ["Member Since", formatDay(p.memberSince)],
        ["Band Members", p.band?.members],
        ["Influences", p.band?.influences],
        ["Sounds Like", p.band?.soundsLike],
        ["Record Label", p.band?.recordLabel],
        ["Type of Label", p.band?.labelType],
      ])}</table></div>`
    : `<div class="details"><h5>${name}'s Interests</h5><table>${detailsRows([
        ["Member Since", formatDay(p.memberSince)],
        ["General", p.interests?.general],
        ["Music", p.interests?.music],
        ["Movies", p.interests?.movies],
        ["Television", p.interests?.television],
        ["Books", p.interests?.books],
        ["Heroes", p.interests?.heroes],
      ])}</table></div>`;

  return `<div class="profile-left">
<h1 class="name">${name}</h1>
<div class="basic"><div class="basic-photo">${photo(p.photoUrl, "photo-main")}${p.online ? onlineNowHtml() : ""}</div><div class="basic-info">${facts.join("<br><br>")}</div></div>
<div class="view-my">View My: <span class="soon" title="Coming soon">Pics</span> | <span class="soon" title="Coming soon">Videos</span></div>
${renderPlayer(p, name, opts)}
<div class="contact"><h5>Contacting ${name}</h5><table>
<tr><td>&#9993; ${actionLink("message", "Send Message")}</td><td>&#10010; ${actionLink("addFriend", "Add to Friends")}</td></tr>
<tr><td>&#10148; ${actionLink("forward", "Forward to Friend")}</td><td>&#9733; ${actionLink("favorite", "Add to Favorites")}</td></tr>
<tr><td>&#9888; ${actionLink("report", "Report")}</td><td>&#10006; ${actionLink("block", "Block User")}</td></tr>
</table></div>
<div class="profile-url"><b>TopEight URL:</b><br>${escapeHtml(host)}/${escapeHtml(p.username)}</div>
${details}
</div>`;
}

function renderRight(p: PublicProfile): string {
  const name = escapeHtml(p.displayName);
  const isArtist = p.kind === "artist";
  const parts: string[] = [`<div class="extended">${name} is in your extended network</div>`];

  if (isArtist && p.shows.length > 0) {
    const rows = p.shows
      .map(
        (s) =>
          `<tr><td>${escapeHtml(formatShowDate(s.date))}</td><td>${escapeHtml(s.venue)}</td><td>${escapeHtml(s.city)}</td></tr>`,
      )
      .join("");
    parts.push(
      `<div class="section-title">Upcoming Shows</div><div class="blurb shows"><table>${rows}</table></div>`,
    );
  }

  if (p.latestBlog) {
    parts.push(
      `<div class="section-title">${name}'s Latest Blog Entry</div><div class="blurb blog"><b>${navLink(p.username, escapeHtml(p.latestBlog.title), "blog")}</b> (${formatDate(p.latestBlog.createdAt)})</div>`,
    );
  }

  const customHtml = isArtist ? p.custom.html : "";
  let blurbs = `<b>About me:</b><br>${textHtml(p.aboutMe)}${customHtml}`;
  if (!isArtist || p.whoIdLikeToMeet.trim()) {
    blurbs += `<br><br><b>Who I'd like to meet:</b><br>${textHtml(p.whoIdLikeToMeet)}`;
  }
  parts.push(`<div class="section-title">${name}'s Blurbs</div><div class="blurb about">${blurbs}</div>`);

  const friends = p.top8
    .slice(0, 8)
    .map(
      (f) =>
        `<div class="top8-friend">${navLink(f.username, `${photo(f.photoUrl, "photo")}${escapeHtml(f.displayName)}`)}${f.online ? onlineNowHtml() : ""}</div>`,
    )
    .join("");
  parts.push(
    `<div class="section-title">${name}'s Friend Space</div><div class="top8"><div class="top8-count"><b>${name} has ${formatCount(p.friendCount)} friends.</b></div>${friends}<div class="top8-all">${navLink(p.username, `View All of ${name}'s Friends`, "friends")}</div></div>`,
  );

  const shown = p.comments.slice(0, MAX_COMMENTS);
  const comments = shown
    .map(
      (c) =>
        `<div class="comment"><div class="comment-who">${navLink(c.author.username, escapeHtml(c.author.displayName))}${navLink(c.author.username, photo(c.author.photoUrl, "photo"))}</div><div class="comment-what"><b>${formatDate(c.createdAt)}</b><br>${richText(c.body)}</div></div>`,
    )
    .join("");
  parts.push(
    `<div class="section-title">${name}'s Friends Comments</div><div class="comments"><div class="comments-head"><b>Displaying ${shown.length} of ${formatCommentTotal(Math.max(p.commentCount, shown.length))} comments</b> ( ${navLink(p.username, "View All", "comments")} | ${actionLink("addComment", "Add Comment")} )</div>${comments}</div>`,
  );

  return `<div class="profile-right">${parts.join("\n")}</div>`;
}

// ---------------------------------------------------------------- scripts

/**
 * In-iframe half of the bridge (see lib/bridge-protocol.ts). Runs before any
 * custom code. It holds its own references, so artist code replacing
 * window.topeight does not change what the Contacting box links do.
 */
export function bridgeScript(mainOrigin: string): string {
  return `(function () {
  var ORIGIN = ${scriptJson(mainOrigin)};
  var ACTIONS = ${scriptJson(BRIDGE_ACTIONS)};
  var PAGES = ${scriptJson(BRIDGE_PAGES)};
  var MAX_TRACK_ID = ${MAX_TRACK_ID_LENGTH};
  function post(msg) { try { window.parent.postMessage(msg, ORIGIN); } catch (e) {} }
  function request(action) {
    if (ACTIONS.indexOf(action) === -1) return;
    post({ type: "topeight:action", action: action });
  }
  function navigate(username, page) {
    if (typeof username !== "string" || !username) return;
    var msg = { type: "topeight:navigate", username: username };
    if (PAGES.indexOf(page) !== -1) msg.page = page;
    post(msg);
  }
  function reportTrack(trackId) {
    if (typeof trackId !== "string" || !trackId || trackId.length > MAX_TRACK_ID) return;
    post({ type: "topeight:reportTrack", trackId: trackId });
  }
  function pickSong(trackId) {
    if (typeof trackId !== "string" || !trackId || trackId.length > MAX_TRACK_ID) return;
    post({ type: "topeight:pickSong", trackId: trackId });
  }
  window.topeight = { request: request, navigate: navigate, reportTrack: reportTrack, pickSong: pickSong };
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;
    var el = t.closest("[data-topeight-action],[data-topeight-navigate],[data-topeight-report-track],[data-topeight-pick-track]");
    if (!el) return;
    e.preventDefault();
    var action = el.getAttribute("data-topeight-action");
    var track = el.getAttribute("data-topeight-report-track");
    var pick = el.getAttribute("data-topeight-pick-track");
    if (action !== null) request(action);
    else if (track !== null) reportTrack(track);
    else if (pick !== null) pickSong(pick);
    else navigate(el.getAttribute("data-topeight-navigate"), el.getAttribute("data-topeight-page"));
  });

  // Height of the content, not the viewport: body's offset from the top of
  // the document (its margin, including collapsed child margins), plus
  // body.scrollHeight (padding box plus any overflowing descendants; in
  // standards mode this is the body box, never the viewport), plus the
  // bottom margin.
  function measure() {
    var b = document.body;
    var top = b.getBoundingClientRect().top + (window.scrollY || 0);
    var bottom = parseFloat(getComputedStyle(b).marginBottom) || 0;
    return Math.ceil(top + b.scrollHeight + bottom);
  }
  var lastHeight = -1;
  var lastViewport = -1;
  var queued = false;
  function sendSize() {
    queued = false;
    if (!document.body) return;
    var height = measure();
    var viewport = window.innerHeight;
    if (lastHeight >= 0) {
      if (Math.abs(height - lastHeight) < 2) return;
      // Content that grew by exactly what the viewport grew is sized from
      // the viewport (min-height: 100vh and friends). Posting it would loop.
      if (viewport !== lastViewport && Math.abs(height - lastHeight - (viewport - lastViewport)) < 2) return;
    }
    lastHeight = height;
    lastViewport = viewport;
    post({ type: "topeight:resize", height: height });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sendSize);
  }
  document.addEventListener("DOMContentLoaded", function () {
    if (typeof ResizeObserver === "function") new ResizeObserver(schedule).observe(document.body);
    schedule();
  });
  window.addEventListener("load", schedule);
})();`;
}

/**
 * Player behaviour. Does nothing when the document has no player. Playback URLs
 * are signed for 15 minutes, so the player fetches fresh ones from
 * data-tracks-url every 12 minutes and when the audio fails to load (once per
 * failure, until playback works again), adding the frame pass from its own
 * address when there is one. No download control, no context menu.
 */
export const playerScript = `document.addEventListener("DOMContentLoaded", function () {
  var ui = document.getElementById("topeight-player-ui");
  var audio = document.getElementById("topeight-player");
  if (!ui || !audio) return;
  var playBtn = ui.querySelector(".player-play");
  var muteBtn = ui.querySelector(".player-mute");
  var bar = ui.querySelector(".player-bar");
  var fill = ui.querySelector(".player-bar i");
  var time = ui.querySelector(".player-time");
  var items = Array.prototype.slice.call(ui.querySelectorAll(".player-track"));
  var autoplay = Number(ui.getAttribute("data-autoplay"));
  var current = Math.max(0, autoplay);
  var tracksUrl = ui.getAttribute("data-tracks-url");
  // A private profile's frame carries ?pass=; the refresh must send it too, or it gets a 404.
  // The pass isn't renewed here. On a visit longer than its 2 hours the refresh gets a
  // 404, so playback stops once the last signed URLs expire, until the frame reloads.
  if (tracksUrl) {
    var pass = null;
    try { pass = new URLSearchParams(location.search).get("pass"); } catch (e) { pass = null; }
    if (pass) tracksUrl += "&pass=" + encodeURIComponent(pass);
  }
  var pending = null;
  var retried = false;
  ui.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  function refresh() {
    if (!tracksUrl || typeof fetch !== "function") return Promise.resolve(false);
    if (pending) return pending;
    pending = fetch(tracksUrl, { credentials: "omit", cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        pending = null;
        if (!data || !Array.isArray(data.tracks)) return false;
        var urls = {};
        data.tracks.forEach(function (t) {
          if (t && typeof t.id === "string" && typeof t.url === "string" && /^https?:[/][/]/i.test(t.url)) urls[t.id] = t.url;
        });
        items.forEach(function (item) {
          var u = urls[item.getAttribute("data-track-id")];
          if (u) item.setAttribute("data-src", u);
        });
        return true;
      })
      .catch(function () { pending = null; return false; });
    return pending;
  }
  if (tracksUrl) setInterval(refresh, ${PLAYBACK_REFRESH_MS});
  function fmt(s) {
    if (!isFinite(s) || s < 0) return "0:00";
    s = Math.floor(s);
    return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }
  function select(i, play) {
    if (i < 0 || i >= items.length) return;
    items[current].classList.remove("current");
    current = i;
    items[current].classList.add("current");
    retried = false;
    audio.src = items[current].getAttribute("data-src");
    if (play) audio.play().catch(function () {});
  }
  playBtn.addEventListener("click", function () {
    if (audio.paused) audio.play().catch(function () {}); else audio.pause();
  });
  muteBtn.addEventListener("click", function () { audio.muted = !audio.muted; });
  bar.addEventListener("click", function (e) {
    if (!isFinite(audio.duration)) return;
    var r = bar.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
  });
  items.forEach(function (item, i) {
    item.addEventListener("click", function () { select(i, true); });
  });
  audio.addEventListener("play", function () { playBtn.textContent = "Pause"; });
  audio.addEventListener("pause", function () { playBtn.textContent = "Play"; });
  audio.addEventListener("volumechange", function () { muteBtn.textContent = audio.muted ? "Unmute" : "Mute"; });
  audio.addEventListener("loadedmetadata", function () {
    items[current].querySelector(".dur").textContent = fmt(audio.duration);
  });
  audio.addEventListener("timeupdate", function () {
    var d = audio.duration;
    fill.style.width = isFinite(d) && d > 0 ? (audio.currentTime / d) * 100 + "%" : "0";
    time.textContent = fmt(audio.currentTime) + (isFinite(d) ? " / " + fmt(d) : "");
  });
  audio.addEventListener("playing", function () { retried = false; });
  audio.addEventListener("error", function () {
    if (retried || !tracksUrl) return;
    retried = true;
    var at = audio.currentTime;
    var resume = !audio.paused;
    refresh().then(function (ok) {
      var src = items[current].getAttribute("data-src");
      if (!ok || !src) return;
      audio.src = src;
      if (at > 0) {
        var seek = function () { audio.removeEventListener("loadedmetadata", seek); audio.currentTime = at; };
        audio.addEventListener("loadedmetadata", seek);
      }
      if (resume) audio.play().catch(function () {});
    });
  });
  audio.addEventListener("ended", function () {
    if (current + 1 < items.length) select(current + 1, true);
  });
  if (autoplay >= 0) {
    var armed = true;
    document.addEventListener("pointerdown", function (e) {
      if (!armed) return;
      armed = false;
      if (e.target instanceof Node && ui.contains(e.target)) return;
      if (audio.paused) audio.play().catch(function () {});
    }, true);
  }
});`;

// ---------------------------------------------------------------- document

/**
 * Full HTML document for a profile, served from the usercontent origin into
 * a sandboxed iframe. TopEight scripts sit in <head> so custom HTML in the
 * body cannot swallow them. Fans get custom CSS only.
 */
export function renderProfileDocument(p: PublicProfile, opts: RenderOptions): string {
  const isArtist = p.kind === "artist";
  const customJs = isArtist ? p.custom.js : "";
  // custom is left out: it is already in the document and can be 100 KB.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { custom, ...data } = p;
  // Comments go in as the same safe HTML the page shows, never raw, so artist
  // code that drops them into innerHTML gets escaped text.
  const publicData = {
    ...data,
    comments: p.comments.slice(0, MAX_COMMENTS).map((c) => ({
      author: c.author,
      bodyHtml: richText(c.body),
      createdAt: c.createdAt,
    })),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
${opts.cspMeta ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(opts.cspMeta)}">\n` : ""}<meta charset="utf-8">
<title>${escapeHtml(p.displayName)} | TopEight</title>
<style>${PROFILE_CSS}</style>
<style>${neutraliseStyle(p.custom.css)}</style>
<script>
window.TOPEIGHT = ${scriptJson(publicData)};
${bridgeScript(opts.mainOrigin)}
${playerScript}
</script>
</head>
<body>
<div class="profile">
${renderLeft(p, opts)}
${renderRight(p)}
</div>
${customJs ? `<script>\n${neutraliseScript(customJs)}\n</script>\n` : ""}</body>
</html>
`;
}
