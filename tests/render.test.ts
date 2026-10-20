import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vitest";
import { BRIDGE_ACTIONS } from "@/lib/bridge-protocol";
import { buildUsercontentCsp } from "@/lib/profile/csp";
import {
  bridgeScript,
  escapeHtml,
  formatDate,
  playerScript,
  renderProfileDocument,
  type PublicCard,
  type PublicProfile,
} from "@/lib/profile/render";

const opts = { mainOrigin: "http://localhost:3000" };

const card = (username: string, kind: "fan" | "artist" = "fan"): PublicCard => ({
  username,
  displayName: username[0].toUpperCase() + username.slice(1),
  photoUrl: null,
  kind,
});

const base = (kind: "fan" | "artist"): PublicProfile => ({
  username: "jess",
  displayName: "Jess",
  kind,
  headline: "hi",
  location: "Cape Town",
  photoUrl: "https://cdn.example/p.jpg",
  aboutMe: "",
  whoIdLikeToMeet: "",
  profileViews: 10,
  lastLoginAt: Date.UTC(2026, 9, 18),
  memberSince: Date.UTC(2026, 8, 12),
  friendCount: 0,
  top8: [],
  comments: [],
  commentCount: 0,
  latestBulletin: null,
  tracks: [],
  shows: [],
  custom: { css: "", html: "", js: "" },
});

const fan = (over: Partial<PublicProfile> = {}): PublicProfile => ({ ...base("fan"), ...over });
const artist = (over: Partial<PublicProfile> = {}): PublicProfile => ({
  ...base("artist"),
  username: "lowveld",
  displayName: "Lowveld",
  ...over,
});
const c = (body: string, createdAt = Date.UTC(2026, 9, 19, 21, 14)) => ({
  author: card("nightjar", "artist"),
  body,
  createdAt,
});
const t = (title: string, autoplay = false) => ({
  id: `trk_${title.length}`,
  title,
  url: `https://media.example/${encodeURIComponent(title)}.mp3`,
  autoplay,
});

describe("renderProfileDocument (brief)", () => {
  test("escapes user text", () => {
    const html = renderProfileDocument(
      fan({ aboutMe: "</script><b>x", comments: [c("<img src=x onerror=alert(1)>")] }),
      opts,
    );
    expect(html).not.toContain("<img src=x onerror");
    expect(html).not.toMatch(/<\/script><b>x/);
  });

  test("fans never get custom JS or HTML", () => {
    const html = renderProfileDocument(
      fan({ custom: { css: "body{}", html: "<marquee>", js: "alert(1)" } }),
      opts,
    );
    expect(html).toContain("body{}");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("<marquee>");
  });

  test("artists get custom code and the player", () => {
    const html = renderProfileDocument(
      artist({
        custom: { css: "", html: "<marquee>hi</marquee>", js: "console.log(1)" },
        tracks: [t("Red Dust", true)],
      }),
      opts,
    );
    expect(html).toContain("<marquee>hi</marquee>");
    expect(html).toContain("console.log(1)");
    expect(html).toContain("Red Dust");
  });

  test("custom CSS cannot close its style block", () => {
    const html = renderProfileDocument(
      fan({ custom: { css: "</style><script>alert(1)</script>", html: "", js: "" } }),
      opts,
    );
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  test("image comments render as images", () => {
    expect(renderProfileDocument(fan({ comments: [c("https://x.com/a.gif")] }), opts)).toContain(
      '<img src="https://x.com/a.gif"',
    );
  });

  test("empty profile renders defaults", () => {
    const html = renderProfileDocument(fan({ photoUrl: null, comments: [], top8: [] }), opts);
    expect(html).toContain("has 0 friends");
    expect(html).toContain("default-photo");
  });

  test("csp", () => {
    const csp = buildUsercontentCsp("http://127.0.0.1:3000");
    expect(csp).toContain("connect-src http://127.0.0.1:3000");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain("allow-same-origin");
  });
});

function extractTopeightJson(html: string): string {
  const m = /window\.TOPEIGHT = ([^\n]*);\n/.exec(html);
  if (!m) throw new Error("window.TOPEIGHT not found");
  return m[1];
}

describe("fan facts", () => {
  const facts = (html: string) => /<div class="basic-info">([^]*?)<\/div>/.exec(html)![1];

  test("fans show gender, age and location on their own lines", () => {
    const html = renderProfileDocument(fan({ gender: "Female", age: 23 }), opts);
    expect(facts(html)).toContain("Female<br>23 years old<br>Cape Town");
  });

  test("missing parts are left out", () => {
    expect(facts(renderProfileDocument(fan({ age: 19 }), opts))).toContain('"hi"<br><br>19 years old<br>Cape Town<br><br>');
    expect(facts(renderProfileDocument(fan({ gender: "Male", location: "" }), opts))).toContain(
      '"hi"<br><br>Male<br><br>Profile Views',
    );
    expect(facts(renderProfileDocument(fan({ location: "" }), opts))).toContain('"hi"<br><br>Profile Views');
  });

  test("artists never show an age", () => {
    const html = renderProfileDocument(artist({ genre: "Rock", age: 30 }), opts);
    expect(facts(html)).not.toContain("years old");
    expect(facts(html)).toContain("Rock<br><br>Cape Town");
  });
});

describe("player report links", () => {
  test("every track row gets a Report link with its id, outside the play button", () => {
    const html = renderProfileDocument(
      artist({ tracks: [{ ...t("Red Dust", true), id: "k1" }, { ...t("Blue Smoke"), id: "k2" }] }),
      opts,
    );
    const rows = html.match(/<li>.*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('<a href="#" class="player-report" data-topeight-report-track="k1">Report</a>');
    expect(rows[1]).toContain('data-topeight-report-track="k2"');
    // The link sits after the button, so clicking it never reaches the play handler.
    for (const row of rows) expect(row).toMatch(/<\/button><a [^>]*data-topeight-report-track=/);
  });

  test("tracks without a playable URL get no Report link", () => {
    const html = renderProfileDocument(
      artist({ tracks: [{ ...t("Bad"), url: "javascript:alert(1)", id: "k9" }] }),
      opts,
    );
    expect(html).not.toContain('data-topeight-report-track="');
  });
});

describe("renderProfileDocument (hardening)", () => {
  test("window.TOPEIGHT JSON escapes </script> and U+2028/U+2029", () => {
    const p = artist({ aboutMe: "</script><script>alert(1)</script>\u2028\u2029&" });
    const html = renderProfileDocument(p, opts);
    const json = extractTopeightJson(html);
    expect(json).not.toMatch(/[<>&\u2028\u2029]/);
    expect(json).toContain("\\u003c/script\\u003e");
    expect(json).toContain("\\u2028");
    expect(json).toContain("\\u2029");
    expect(JSON.parse(json).aboutMe).toBe(p.aboutMe);
  });

  test("window.TOPEIGHT holds the public profile fields, minus custom code", () => {
    const p = artist({
      tracks: [t("Red Dust", true)],
      custom: { css: "", html: "", js: "window.SECRET_ISH=1" },
    });
    const data = JSON.parse(extractTopeightJson(renderProfileDocument(p, opts)));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { custom, ...rest } = p;
    expect(data).toEqual(rest);
  });

  test("window.TOPEIGHT comments carry bodyHtml, the same safe markup the page shows", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const pic = "https://x.com/a.gif";
    const p = fan({ comments: [c(evil), c(pic)] });
    const html = renderProfileDocument(p, opts);
    const json = extractTopeightJson(html);
    // The raw markup never appears in the JSON, not even JSON-escaped.
    expect(json).not.toContain("onerror=\"alert");
    expect(json).not.toContain("\\u003cimg src=x");
    const data = JSON.parse(json);
    expect(data.comments[0]).not.toHaveProperty("body");
    expect(data.comments[0].bodyHtml).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(data.comments[0].author).toEqual(card("nightjar", "artist"));
    expect(typeof data.comments[0].createdAt).toBe("number");
    expect(data.comments[1].bodyHtml).toBe('<img src="https://x.com/a.gif" alt="">');
    // Same markup as the rendered comment.
    expect(html).toContain(`<br>${data.comments[0].bodyHtml}</div>`);
  });

  test("comment image URL cannot inject attributes", () => {
    const html = renderProfileDocument(
      fan({ comments: [c('https://x.com/a.gif" onerror="alert(1)')] }),
      opts,
    );
    expect(html).not.toContain('" onerror="alert(1)');
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).toContain('<img src="https://x.com/a.gif"');
  });

  test("custom JS cannot close its script block, any case", () => {
    const html = renderProfileDocument(
      artist({ custom: { css: "", html: "", js: "x='</SCRIPT><img src=x onerror=alert(2)>'" } }),
      opts,
    );
    expect(html).not.toMatch(/<\/SCRIPT><img/i);
    expect(html).toContain("<\\/SCRIPT>");
  });

  test("custom CSS </STYLE uppercase is neutralised", () => {
    const html = renderProfileDocument(
      fan({ custom: { css: "</STYLE><b>x</b>", html: "", js: "" } }),
      opts,
    );
    expect(html).not.toContain("</STYLE><b>");
  });

  test("link tokens open in a new window with noopener noreferrer", () => {
    const html = renderProfileDocument(fan({ comments: [c("see https://x.com/page?a=1&b=2")] }), opts);
    expect(html).toContain(
      '<a href="https://x.com/page?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">',
    );
  });

  test("bridge script comes before the custom JS", () => {
    const html = renderProfileDocument(
      artist({ custom: { css: "", html: "", js: "window.ARTIST_MARKER=1" } }),
      opts,
    );
    const bridge = html.indexOf("window.topeight =");
    const custom = html.indexOf("window.ARTIST_MARKER=1");
    expect(bridge).toBeGreaterThan(-1);
    expect(custom).toBeGreaterThan(bridge);
  });

  test("bridge posts to the main origin only", () => {
    const html = renderProfileDocument(fan(), opts);
    expect(html).toContain('"http://localhost:3000"');
    expect(html).not.toMatch(/postMessage\([^)]*["']\*["']/);
  });

  test("contacting box and profile links carry bridge attributes", () => {
    const html = renderProfileDocument(
      fan({ top8: [card("tom")], comments: [c("hi")], commentCount: 57 }),
      opts,
    );
    for (const a of ["addFriend", "addComment", "report", "block", "forward", "message"]) {
      expect(html).toContain(`data-topeight-action="${a}"`);
    }
    expect(html).toContain('data-topeight-navigate="tom">');
    expect(html).toContain('data-topeight-navigate="nightjar">');
    expect(html).toContain('data-topeight-navigate="jess" data-topeight-page="comments">View All<');
    expect(html).toContain('data-topeight-navigate="jess" data-topeight-page="friends">');
    expect(html).not.toMatch(/data-topeight-navigate="[^"]*\//);
    expect(html).toContain("Displaying 1 of 57 comments");
  });

  test("shows at most 10 comments", () => {
    const comments = Array.from({ length: 12 }, (_, i) => c(`comment-${i}-x`));
    const html = renderProfileDocument(fan({ comments, commentCount: 12 }), opts);
    expect(html).toContain("comment-9-x");
    expect(html).not.toContain("comment-10-x");
    expect(html).toContain("Displaying 10 of 12 comments");
  });

  test("a comment count over 1000 shows as 1000+", () => {
    expect(renderProfileDocument(fan({ commentCount: 1000 }), opts)).toContain("Displaying 0 of 1,000 comments");
    expect(renderProfileDocument(fan({ commentCount: 1001 }), opts)).toContain("Displaying 0 of 1000+ comments");
  });

  test("no tracks means no player", () => {
    expect(renderProfileDocument(artist({ tracks: [] }), opts)).not.toContain('id="topeight-player"');
    expect(renderProfileDocument(fan({ tracks: [t("x")] }), opts)).not.toContain(
      'id="topeight-player"',
    );
    const html = renderProfileDocument(artist({ tracks: [t("Red Dust", true)] }), opts);
    expect(html).toContain('id="topeight-player"');
    expect(html).toContain("pointerdown");
  });

  test("document basics", () => {
    const html = renderProfileDocument(fan(), opts);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).not.toContain("<base");
  });

  test("profile.css comes before custom CSS", () => {
    const html = renderProfileDocument(fan({ custom: { css: ".custom-marker{}", html: "", js: "" } }), opts);
    expect(html.indexOf("Verdana")).toBeGreaterThan(-1);
    expect(html.indexOf(".custom-marker{}")).toBeGreaterThan(html.indexOf("Verdana"));
  });

  test("photo URLs are escaped in attributes", () => {
    const html = renderProfileDocument(fan({ photoUrl: 'https://x/"onload="alert(1)' }), opts);
    expect(html).not.toContain('"onload="');
  });
});

describe("URL schemes and escaping", () => {
  test("a javascript: photo URL becomes the default photo", () => {
    const html = renderProfileDocument(fan({ photoUrl: "javascript:alert(1)" }), opts);
    expect(html).toContain("default-photo");
    expect(html).not.toContain('src="javascript:');
  });

  test("a data: track URL produces no player", () => {
    const html = renderProfileDocument(
      artist({ tracks: [{ id: "trk_x", title: "x", url: "data:audio/mpeg;base64,AAAA", autoplay: true }] }),
      opts,
    );
    expect(html).not.toContain('id="topeight-player"');
    expect(html).not.toContain('src="data:');
  });

  test("a track id cannot break out of its report attribute", () => {
    const html = renderProfileDocument(
      artist({ tracks: [{ ...t("Song", true), id: '"><img src=x onerror=alert(1)>' }] }),
      opts,
    );
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain('data-topeight-report-track="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"');
  });

  test("markup in names, headline, venue and track title is escaped", () => {
    const evil = "<b onmouseover=alert(1)>x</b>";
    const html = renderProfileDocument(
      artist({
        displayName: evil,
        headline: evil,
        shows: [{ date: "2026-10-24", venue: evil, city: evil }],
        tracks: [t(evil, true)],
        top8: [{ ...card("tom"), displayName: evil }],
      }),
      opts,
    );
    expect(html).not.toContain("<b onmouseover");
    expect(html).toContain("&lt;b onmouseover=alert(1)&gt;x&lt;/b&gt;");
  });
});

type Posted = { msg: unknown; origin: string };

/** Runs the real bridge script against a tiny fake DOM. */
function runBridge() {
  const posted: Posted[] = [];
  const docListeners: Record<string, Array<(e: unknown) => void>> = {};
  const winListeners: Record<string, Array<() => void>> = {};
  let observed: (() => void) | null = null;
  const env = { top: 0, scrollHeight: 900, marginBottom: "0px" };
  class FakeElement {
    constructor(private attrs: Record<string, string>) {}
    getAttribute(name: string) {
      return name in this.attrs ? this.attrs[name] : null;
    }
    closest() {
      return this;
    }
  }
  const body = {
    getBoundingClientRect: () => ({ top: env.top }),
    get scrollHeight() {
      return env.scrollHeight;
    },
  };
  const window = {
    innerHeight: 150,
    scrollY: 0,
    parent: { postMessage: (msg: unknown, origin: string) => posted.push({ msg, origin }) },
    addEventListener: (type: string, fn: () => void) => (winListeners[type] ??= []).push(fn),
    topeight: undefined as unknown as {
      request: (a: unknown) => void;
      navigate: (u: unknown, p?: unknown) => void;
      reportTrack: (id: unknown) => void;
    },
  };
  const document = {
    body,
    addEventListener: (type: string, fn: (e: unknown) => void) => (docListeners[type] ??= []).push(fn),
  };
  runInNewContext(bridgeScript("http://localhost:3000"), {
    window,
    document,
    Element: FakeElement,
    ResizeObserver: class {
      constructor(cb: () => void) {
        observed = cb;
      }
      observe() {}
    },
    requestAnimationFrame: (fn: () => void) => fn(),
    getComputedStyle: () => ({ marginBottom: env.marginBottom }),
  });
  for (const fn of docListeners.DOMContentLoaded ?? []) fn({});
  const messages = () => posted.map((p) => JSON.parse(JSON.stringify(p.msg)));
  const click = (attrs: Record<string, string>) => {
    let prevented = false;
    for (const fn of docListeners.click ?? [])
      fn({ target: new FakeElement(attrs), preventDefault: () => (prevented = true) });
    return prevented;
  };
  return { env, window, posted, messages, click, resize: () => observed?.() };
}

describe("bridge script", () => {
  test("posts the content height to the main origin on load", () => {
    const b = runBridge();
    expect(b.messages()).toEqual([{ type: "topeight:resize", height: 900 }]);
    expect(b.posted[0].origin).toBe("http://localhost:3000");
  });

  test("includes body offset and bottom margin, rounds up", () => {
    const b = runBridge();
    b.env.top = 8;
    b.env.scrollHeight = 500;
    b.env.marginBottom = "8.4px";
    b.resize();
    expect(b.messages().at(-1)).toEqual({ type: "topeight:resize", height: 517 });
  });

  test("shrinks, and ignores changes under 2px", () => {
    const b = runBridge();
    b.env.scrollHeight = 901;
    b.resize();
    expect(b.posted).toHaveLength(1);
    b.env.scrollHeight = 400;
    b.resize();
    expect(b.messages().at(-1)).toEqual({ type: "topeight:resize", height: 400 });
  });

  test("does not chase content sized from the viewport", () => {
    const b = runBridge();
    // body { min-height: 100vh; padding-bottom: 20px } with little content
    b.env.scrollHeight = b.window.innerHeight + 20;
    b.resize();
    expect(b.messages().at(-1)).toEqual({ type: "topeight:resize", height: 170 });
    const count = b.posted.length;
    for (let i = 0; i < 5; i++) {
      b.window.innerHeight = 170; // parent applied the height
      b.env.scrollHeight = b.window.innerHeight + 20;
      b.resize();
    }
    expect(b.posted).toHaveLength(count);
  });

  test("click delegation posts action and navigate messages", () => {
    const b = runBridge();
    expect(b.click({ "data-topeight-action": "addFriend" })).toBe(true);
    b.click({ "data-topeight-navigate": "tom" });
    b.click({ "data-topeight-navigate": "jess", "data-topeight-page": "comments" });
    b.click({ "data-topeight-navigate": "jess", "data-topeight-page": "../admin" });
    b.click({ "data-topeight-action": "deleteAccount" });
    expect(b.click({ "data-topeight-report-track": "k57abc" })).toBe(true);
    b.click({ "data-topeight-report-track": "" });
    b.click({ "data-topeight-report-track": "x".repeat(65) });
    expect(b.messages().slice(1)).toEqual([
      { type: "topeight:action", action: "addFriend" },
      { type: "topeight:navigate", username: "tom" },
      { type: "topeight:navigate", username: "jess", page: "comments" },
      { type: "topeight:navigate", username: "jess" },
      { type: "topeight:reportTrack", trackId: "k57abc" },
    ]);
  });

  test("window.topeight.reportTrack posts only string ids of 1 to 64 characters", () => {
    const b = runBridge();
    b.window.topeight.reportTrack("k57abc");
    b.window.topeight.reportTrack("x".repeat(64));
    b.window.topeight.reportTrack("x".repeat(65));
    b.window.topeight.reportTrack("");
    b.window.topeight.reportTrack(42);
    b.window.topeight.reportTrack({ toString: () => "k1" });
    expect(b.messages().slice(1)).toEqual([
      { type: "topeight:reportTrack", trackId: "k57abc" },
      { type: "topeight:reportTrack", trackId: "x".repeat(64) },
    ]);
  });

  test("window.topeight API validates its input", () => {
    const b = runBridge();
    b.window.topeight.request("block");
    b.window.topeight.navigate("tom", "friends");
    b.window.topeight.navigate(42);
    b.window.topeight.navigate("");
    expect(b.messages().slice(1)).toEqual([
      { type: "topeight:action", action: "block" },
      { type: "topeight:navigate", username: "tom", page: "friends" },
    ]);
  });

  test("action list comes from BRIDGE_ACTIONS", () => {
    expect(bridgeScript("http://x")).toContain(`var ACTIONS = ${JSON.stringify(BRIDGE_ACTIONS)};`);
  });
});

describe("helpers", () => {
  test("escapeHtml", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
  test("formatDate is UTC and deterministic", () => {
    expect(formatDate(Date.UTC(2026, 9, 19, 21, 14))).toBe("19 Oct 2026 9:14 PM");
    expect(formatDate(Date.UTC(2026, 9, 18, 0, 5))).toBe("18 Oct 2026 12:05 AM");
    expect(formatDate(Date.UTC(2026, 9, 18, 12, 0))).toBe("18 Oct 2026 12:00 PM");
  });
});

describe("csp", () => {
  test("matches the global constraint exactly", () => {
    expect(buildUsercontentCsp("https://u.example")).toBe(
      "default-src 'none'; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; media-src * data: blob:; frame-src *; font-src * data:; connect-src https://u.example; form-action 'none'; base-uri 'none'",
    );
  });
});

describe("cspMeta option", () => {
  const profile = base("fan");

  test("inserts the meta tag first in head, escaped", () => {
    const csp = buildUsercontentCsp("http://127.0.0.1:3000");
    const html = renderProfileDocument(profile, { ...opts, cspMeta: csp });
    expect(html).toContain(`<head>\n<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">\n<meta charset="utf-8">`);
  });

  test("escapes quotes so the content attribute cannot be closed early", () => {
    const html = renderProfileDocument(profile, { ...opts, cspMeta: `x"><script>alert(1)</script>` });
    expect(html).not.toContain(`<script>alert(1)</script>`);
    expect(html).toContain(`content="x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"`);
  });

  test("no meta tag by default", () => {
    expect(renderProfileDocument(profile, opts)).not.toContain("http-equiv");
  });
});

describe("player protection", () => {
  const html = renderProfileDocument(
    artist({ tracks: [{ ...t("Red Dust", true), id: "k1" }] }),
    { ...opts, usercontentOrigin: "http://127.0.0.1:3000" },
  );

  test("the audio element hides the download control", () => {
    expect(html).toMatch(/<audio id="topeight-player"[^>]* controlsList="nodownload"/);
  });

  test("rows carry their track id and the player knows where to refresh URLs", () => {
    expect(html).toContain('data-track-id="k1"');
    expect(html).toContain('data-tracks-url="http://127.0.0.1:3000/lowveld?format=tracks"');
  });

  test("no refresh URL without a usercontent origin", () => {
    const plain = renderProfileDocument(artist({ tracks: [t("Red Dust", true)] }), opts);
    expect(plain).not.toContain('data-tracks-url="');
  });
});

/** Runs the player script against a tiny fake DOM. */
function runPlayer(tracksUrl: string | null = "http://127.0.0.1:3000/lowveld?format=tracks") {
  type Handler = (e: Record<string, unknown>) => void;
  const el = (attrs: Record<string, string> = {}) => {
    const listeners: Record<string, Handler[]> = {};
    return {
      attrs,
      listeners,
      textContent: "",
      style: {},
      classList: { add() {}, remove() {} },
      getAttribute: (k: string) => (k in attrs ? attrs[k] : null),
      setAttribute: (k: string, v: string) => {
        attrs[k] = String(v);
      },
      addEventListener: (type: string, fn: Handler) => {
        (listeners[type] ??= []).push(fn);
      },
      querySelector: () => el(),
      querySelectorAll: () => [] as unknown[],
      contains: () => false,
      getBoundingClientRect: () => ({ left: 0, width: 1 }),
      fire(type: string) {
        const ev = { prevented: false, target: null, preventDefault: () => (ev.prevented = true) };
        for (const fn of listeners[type] ?? []) fn(ev);
        return ev;
      },
    };
  };
  const items = [
    el({ "data-src": "https://old/1", "data-track-id": "k1" }),
    el({ "data-src": "https://old/2", "data-track-id": "k2" }),
  ];
  const ui = el({ "data-autoplay": "-1", ...(tracksUrl ? { "data-tracks-url": tracksUrl } : {}) });
  ui.querySelectorAll = () => items;
  const audio = Object.assign(el(), {
    src: "https://old/1",
    paused: true,
    currentTime: 0,
    duration: NaN,
    play: () => Promise.resolve(),
    pause() {},
  });
  const doc = el();
  const fetches: string[] = [];
  let reply: unknown = { tracks: [{ id: "k1", url: "https://new/1" }, { id: "k2", url: "javascript:x" }] };
  const intervals: number[] = [];
  runInNewContext(playerScript, {
    document: Object.assign(doc, {
      getElementById: (id: string) => (id === "topeight-player-ui" ? ui : id === "topeight-player" ? audio : null),
    }),
    fetch: (url: string) => {
      fetches.push(url);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(reply) });
    },
    setInterval: (_fn: () => void, ms: number) => intervals.push(ms),
    Node: class {},
    isFinite,
    Math,
    Number,
    Array,
    Promise,
  });
  doc.fire("DOMContentLoaded");
  return {
    ui,
    audio,
    items,
    fetches,
    intervals,
    setReply: (r: unknown) => (reply = r),
    settle: () => new Promise((r) => setTimeout(r, 0)),
  };
}

describe("player script", () => {
  test("blocks the context menu over the player", () => {
    const p = runPlayer();
    expect(p.ui.fire("contextmenu").prevented).toBe(true);
  });

  test("on an audio error it fetches ?format=tracks and retries with the fresh URL", async () => {
    const p = runPlayer();
    p.audio.fire("error");
    expect(p.fetches).toEqual(["http://127.0.0.1:3000/lowveld?format=tracks"]);
    await p.settle();
    expect(p.items[0].attrs["data-src"]).toBe("https://new/1");
    expect(p.audio.src).toBe("https://new/1");
    // Only http(s) URLs are taken from the response.
    expect(p.items[1].attrs["data-src"]).toBe("https://old/2");
  });

  test("a second error before playback recovers does not loop", async () => {
    const p = runPlayer();
    p.audio.fire("error");
    await p.settle();
    p.audio.fire("error");
    await p.settle();
    expect(p.fetches).toHaveLength(1);
    p.audio.fire("playing");
    p.audio.fire("error");
    expect(p.fetches).toHaveLength(2);
  });

  test("refreshes the URLs every 12 minutes", () => {
    expect(runPlayer().intervals).toEqual([12 * 60 * 1000]);
  });

  test("does nothing extra without a refresh URL", () => {
    const p = runPlayer(null);
    p.audio.fire("error");
    expect(p.fetches).toEqual([]);
    expect(p.intervals).toEqual([]);
  });
});

