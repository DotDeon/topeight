#!/usr/bin/env node
// Generates the seed media and uploads it to R2.
//
//   node scripts/seed-media.mjs            generate files, upload when R2_* vars are set
//   node scripts/seed-media.mjs --dry-run  generate files and print what would upload
//
// Silent MP3s go to scripts/seed-audio/ (committed, made with ffmpeg).
// Avatar PNGs go to a temp directory at run time and are never committed.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const audioDir = join(here, "seed-audio");
const avatarDir = join(tmpdir(), "openspace-seed-avatars");

// Keep in sync with SEED_USERNAMES in convex/seed.ts.
const USERNAMES = [
  "lowveld", "nightjar", "papermoons", "djfynbos", "thestatickids",
  "jess", "marco", "thandi", "kyle", "ren", "lerato", "pieter", "aisha",
];
const COLOURS = [
  [0, 51, 153], [102, 152, 203], [255, 102, 0], [153, 0, 102], [0, 102, 68],
  [102, 51, 153], [180, 60, 40], [40, 110, 140],
];

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Minimal PNG encoder: solid colour square with a lighter block in the middle. */
export function solidPng(size, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = [];
  const lo = Math.floor(size * 0.3);
  const hi = Math.floor(size * 0.7);
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const inner = x >= lo && x < hi && y >= lo && y < hi;
      row[1 + x * 3] = inner ? Math.min(255, r + 70) : r;
      row[2 + x * 3] = inner ? Math.min(255, g + 70) : g;
      row[3 + x * 3] = inner ? Math.min(255, b + 70) : b;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const files = [];

mkdirSync(audioDir, { recursive: true });
for (const n of [1, 2, 3]) {
  const path = join(audioDir, `silence-${n}.mp3`);
  if (!existsSync(path)) {
    execFileSync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", "3",
        "-ac", "1", "-b:a", "32k", "-map_metadata", "-1", "-fflags", "+bitexact", path],
    );
  }
  files.push({ path, key: `seed/silence-${n}.mp3`, type: "audio/mpeg" });
}

mkdirSync(avatarDir, { recursive: true });
USERNAMES.forEach((name, i) => {
  const path = join(avatarDir, `avatar-${name}.png`);
  writeFileSync(path, solidPng(96, COLOURS[i % COLOURS.length]));
  files.push({ path, key: `seed/avatar-${name}.png`, type: "image/png" });
});

const required = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_BUCKET"];
const missing = required.filter((k) => !process.env[k]);
const dryRun = process.argv.includes("--dry-run");

if (dryRun || missing.length > 0) {
  if (!dryRun) console.log(`R2 variables missing (${missing.join(", ")}), skipping upload.`);
  for (const f of files) {
    console.log(`would upload ${f.key} (${readFileSync(f.path).length} bytes, ${f.type})`);
  }
} else {
  const { PutObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  for (const f of files) {
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: f.key,
        Body: readFileSync(f.path),
        ContentType: f.type,
      }),
    );
    console.log(`uploaded ${f.key}`);
  }
}
