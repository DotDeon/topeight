// Builds the TopEight brand kit into public/brand/. Run with `npm run brand`.
// Text is converted to paths with opentype.js so the SVGs need no installed fonts.
// The Nunito variable font is downloaded into a temp dir, used, and deleted. It is never committed.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as opentypeNs from "opentype.js";

const opentype = opentypeNs.parse ? opentypeNs : opentypeNs.default;
import { Resvg } from "@resvg/resvg-js";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "brand");
const FONT_URL = "https://github.com/google/fonts/raw/main/ofl/nunito/Nunito%5Bwght%5D.ttf";

const BLUE = "#003399";
const ORANGE = "#ff9933";
const PALE_BLUE = "#dbe6f7";

const FONT_SIZE = 32;
const SLOGAN_SIZE = 10;
const GAP = 11;
const TRACKING = -0.04; // em
const SLOGAN = "remember when the internet was fun?";

const tmp = mkdtempSync(path.join(tmpdir(), "topeight-brand-"));
let font;
try {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`Font download failed: ${res.status}`);
  const file = path.join(tmp, "Nunito.ttf");
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  const b = readFileSync(file);
  font = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const n = (v) => +v.toFixed(2);

// opentype.js toPathData can emit NaN for some values, so serialise the commands ourselves.
function pathData(cmds) {
  return cmds
    .map((c) => {
      const pts = { M: ["x", "y"], L: ["x", "y"], Q: ["x1", "y1", "x", "y"], C: ["x1", "y1", "x2", "y2", "x", "y"], Z: [] }[c.type];
      return c.type + pts.map((k) => n(c[k])).join(" ");
    })
    .join("");
}

/** Lays out text glyph by glyph (variable weight, tracking) and returns an SVG path plus its bounds. */
function textPath(text, x, baseline, size, weight, tracking, fill) {
  let cx = x;
  const d = [];
  const box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  for (const ch of text) {
    const g = font.variation.getTransform(font.charToGlyph(ch), { wght: weight });
    const p = g.getPath(cx, baseline, size);
    if (p.commands.length) {
      const bb = p.getBoundingBox();
      box.x1 = Math.min(box.x1, bb.x1);
      box.y1 = Math.min(box.y1, bb.y1);
      box.x2 = Math.max(box.x2, bb.x2);
      box.y2 = Math.max(box.y2, bb.y2);
      d.push(pathData(p.commands));
    }
    cx += (g.advanceWidth * size) / font.unitsPerEm + tracking * size;
  }
  return { svg: `<path fill="${fill}" d="${d.join("")}"/>`, box, end: cx - tracking * size };
}

const COLS = [0, 11.5, 23, 34.5];
const ROWS = [0, 13.5];
function grid(first, rest) {
  let s = "";
  ROWS.forEach((y, r) =>
    COLS.forEach((x, c) => {
      s += `<rect x="${x}" y="${y}" width="9.5" height="10.5" rx="2" fill="${r === 0 && c === 0 ? first : rest}"/>`;
    }),
  );
  return s;
}

/** Icon + wordmark (+ optional slogan) in a local coordinate space where the icon sits at 0,0. */
function logoGroup({ tiles, name, slogan }) {
  // Wordmark block: name line, then slogan, centred on the icon's vertical middle (y = 12).
  const nameLine = textPath("topeight", 0, 0, FONT_SIZE, 800, TRACKING, name);
  const x0 = 44 + GAP;
  const nameTop = nameLine.box.y1;
  let blockTop = nameTop;
  let blockBottom = nameLine.box.y2;
  let nameBase = 0;
  let sloganBase = null;
  if (slogan) {
    sloganBase = nameBase + FONT_SIZE * 0.28 + SLOGAN_SIZE; // sits just below the descenders
    blockBottom = sloganBase + SLOGAN_SIZE * 0.25;
  }
  const blockMid = (blockTop + blockBottom) / 2;
  const shift = 12 - blockMid;
  nameBase += shift;
  if (sloganBase !== null) sloganBase += shift;

  const nm = textPath("topeight", x0, nameBase, FONT_SIZE, 800, TRACKING, name);
  let inner = grid(ORANGE, tiles) + nm.svg;
  const boxes = [{ x1: 0, y1: 0, x2: 44, y2: 24 }, nm.box];
  if (slogan) {
    const sl = textPath(SLOGAN, x0 + 2, sloganBase, SLOGAN_SIZE, 400, 0, slogan);
    inner += sl.svg;
    boxes.push(sl.box);
  }
  const bb = boxes.reduce((a, b) => ({
    x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2),
  }));
  return { inner, x: bb.x1, y: bb.y1, w: bb.x2 - bb.x1, h: bb.y2 - bb.y1 };
}

const svgDoc = (w, h, body, label = "TopEight") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}" role="img" aria-label="${label}">${body}</svg>\n`;

/** Logo with transparent background, tight to the artwork plus a little padding. */
function logoSvg(opts, pad = 2, bg = null) {
  const g = logoGroup(opts);
  const w = g.w + pad * 2;
  const h = g.h + pad * 2;
  const body = `${bg ? `<rect width="${n(w)}" height="${n(h)}" rx="${bg.rx}" fill="${BLUE}"/>` : ""}<g transform="translate(${n(pad - g.x)} ${n(pad - g.y)})">${g.inner}</g>`;
  return { svg: svgDoc(w, h, body), w, h };
}

const files = new Map(); // name -> Buffer | string
const dims = {};
const add = (name, content, w, h) => {
  files.set(name, content);
  if (w) dims[name] = [Math.round(w), Math.round(h)];
};

const white = { tiles: "#fff", name: "#fff" };
const dark = { tiles: BLUE, name: BLUE };

let r;
r = logoSvg(white); add("topeight-logo.svg", r.svg, r.w, r.h);
r = logoSvg({ ...white, slogan: PALE_BLUE }, 2); add("topeight-logo-slogan.svg", r.svg, r.w, r.h);
r = logoSvg(dark); add("topeight-logo-dark.svg", r.svg, r.w, r.h);
r = logoSvg(white, 16, { rx: 12 }); add("topeight-logo-on-blue.svg", r.svg, r.w, r.h); const onBlue = r;
r = logoSvg({ ...white, slogan: PALE_BLUE }, 16, { rx: 12 }); add("topeight-logo-slogan-on-blue.svg", r.svg, r.w, r.h);

// Icon only
const iconBody = (rx) => {
  const s = 64 / 44;
  return `<rect width="100" height="100" rx="${rx}" fill="${BLUE}"/><g transform="translate(18 ${n(50 - (24 * s) / 2)}) scale(${n(s)})">${grid(ORANGE, "#fff")}</g>`;
};
const iconSvg = svgDoc(100, 100, iconBody(20));
add("topeight-icon.svg", iconSvg, 100, 100);
add("topeight-icon-transparent.svg", svgDoc(44, 24, grid(ORANGE, "#fff")), 44, 24);

const render = (svg, width) =>
  new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } }).render().asPng();

const squareFull = svgDoc(100, 100, iconBody(0)); // iOS applies its own rounding
for (const s of [16, 32, 48]) add(`icon-${s}.png`, render(iconSvg, s), s, s);
add("apple-touch-icon.png", render(squareFull, 180), 180, 180);
add("icon-192.png", render(iconSvg, 192), 192, 192);
add("icon-512.png", render(iconSvg, 512), 512, 512);

const at2x = render(onBlue.svg, 640);
const png = new Resvg(onBlue.svg, { fitTo: { mode: "width", value: 640 } }).render();
add("logo-on-blue@2x.png", at2x, png.width, png.height);

// Open Graph image: blue background, centred logo with slogan.
{
  const g = logoGroup({ ...white, slogan: PALE_BLUE });
  const scale = 720 / g.w;
  const tx = (1200 - g.w * scale) / 2 - g.x * scale;
  const ty = (630 - g.h * scale) / 2 - g.y * scale;
  const body = `<rect width="1200" height="630" fill="${BLUE}"/><g transform="translate(${n(tx)} ${n(ty)}) scale(${n(scale)})">${g.inner}</g>`;
  add("og-image.png", render(svgDoc(1200, 630, body), 1200), 1200, 630);
}

// favicon.ico, PNG entries at 16, 32 and 48.
{
  const sizes = [16, 32, 48];
  const pngs = sizes.map((s) => files.get(`icon-${s}.png`));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e[0] = s; e[1] = s;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });
  add("favicon.ico", Buffer.concat([head, ...entries, ...pngs]));
}

add("README.txt", `TopEight brand kit

Colors
  Brand blue     #003399
  Orange         #ff9933  (the first tile)
  Pale blue      #dbe6f7  (slogan on dark backgrounds)
  White          #ffffff

Font
  Nunito, ExtraBold for the wordmark and Regular for the slogan.
  Nunito is licensed under the SIL Open Font License 1.1.
  https://fonts.google.com/specimen/Nunito
  https://openfontlicense.org
  Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito).
  All text in the SVG files is already converted to paths, so you do not need to install the font.

Files
  topeight-logo.svg                 Logo for dark backgrounds, transparent.
  topeight-logo-on-blue.svg         Logo on a brand blue rounded rectangle.
  topeight-logo-dark.svg            Logo for light backgrounds.
  topeight-logo-slogan.svg          Logo with slogan for dark backgrounds, transparent.
  topeight-logo-slogan-on-blue.svg  Logo with slogan on brand blue.
  topeight-icon.svg                 Grid icon on a brand blue rounded square.
  topeight-icon-transparent.svg     Grid icon with no background.
  icon-16/32/48/192/512.png         Square icons.
  apple-touch-icon.png              180 px icon with no rounded corners.
  logo-on-blue@2x.png               Logo on blue, 640 px wide.
  og-image.png                      1200 x 630 social sharing image.
  favicon.ico                       16, 32 and 48 px.

Usage
  Do not stretch, skew, recolor or rotate the logo.
  Keep clear space around it equal to at least the height of one grid tile.
  The orange tile is always the first one, top left.
  Use the white logo on dark or blue backgrounds and the dark logo on light backgrounds.
  Do not set the slogan in another font or place it away from the wordmark.
`);

// Write only what changed, so repeated runs leave the tree clean.
mkdirSync(OUT, { recursive: true });
let changed = false;
for (const [name, content] of files) {
  const p = path.join(OUT, name);
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (!existsSync(p) || !readFileSync(p).equals(buf)) {
    writeFileSync(p, buf);
    changed = true;
  }
}

const zipPath = path.join(OUT, "topeight-brand.zip");
if (changed || !existsSync(zipPath)) {
  rmSync(zipPath, { force: true });
  const names = [...files.keys()].sort();
  execFileSync("zip", ["-X", "-q", "topeight-brand.zip", ...names], { cwd: OUT });
}
const stale = readdirSync(OUT).filter((f) => f !== "topeight-brand.zip" && !files.has(f));
if (stale.length) console.warn("Unexpected files in public/brand:", stale.join(", "));
console.log(JSON.stringify(dims, null, 1));
