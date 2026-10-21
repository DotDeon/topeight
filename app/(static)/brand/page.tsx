import styles from "./brand.module.css";

export const metadata = { title: "Brand assets - TopEight" };

type Asset = { file: string; size: string; surface: "blue" | "white" | "checker" };

// Sizes match what scripts/build-brand.mjs writes. Run `npm run brand` to regenerate.
const ASSETS: Asset[] = [
  { file: "topeight-logo.svg", size: "179 x 34", surface: "blue" },
  { file: "topeight-logo-on-blue.svg", size: "207 x 62", surface: "white" },
  { file: "topeight-logo-dark.svg", size: "179 x 34", surface: "white" },
  { file: "topeight-logo-slogan.svg", size: "179 x 45", surface: "blue" },
  { file: "topeight-logo-slogan-on-blue.svg", size: "207 x 73", surface: "white" },
  { file: "topeight-icon.svg", size: "100 x 100", surface: "white" },
  { file: "topeight-icon-transparent.svg", size: "44 x 24", surface: "blue" },
  { file: "icon-16.png", size: "16 x 16", surface: "white" },
  { file: "icon-32.png", size: "32 x 32", surface: "white" },
  { file: "icon-48.png", size: "48 x 48", surface: "white" },
  { file: "apple-touch-icon.png", size: "180 x 180", surface: "white" },
  { file: "icon-192.png", size: "192 x 192", surface: "white" },
  { file: "icon-512.png", size: "512 x 512", surface: "white" },
  { file: "logo-on-blue@2x.png", size: "640 x 190", surface: "white" },
  { file: "og-image.png", size: "1200 x 630", surface: "white" },
  { file: "favicon.ico", size: "16, 32 and 48", surface: "white" },
];

const COLORS = [
  { name: "Brand blue", hex: "#003399" },
  { name: "Orange", hex: "#ff9933" },
  { name: "Pale blue", hex: "#dbe6f7" },
  { name: "White", hex: "#ffffff" },
];

export default function BrandPage() {
  return (
    <div className="prose">
      <h1>Brand assets</h1>
      <p>
        The TopEight logo, icons and social image. Keep the orange tile first, do not stretch the
        logo, and leave clear space around it.
      </p>
      <p>
        <a href="/brand/topeight-brand.zip" download className={styles.zip}>
          Download everything (topeight-brand.zip)
        </a>
      </p>

      <h2>Files</h2>
      <ul className={styles.grid}>
        {ASSETS.map((a) => (
          <li key={a.file} className={styles.item}>
            <div className={`${styles.preview} ${a.surface === "blue" ? styles.blue : styles.white}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/brand/${a.file}`} alt={a.file} className={styles.img} />
            </div>
            <div className={styles.name}>{a.file}</div>
            <div className={styles.size}>{a.size} px</div>
            <a href={`/brand/${a.file}`} download>
              Download
            </a>
          </li>
        ))}
      </ul>

      <h2>Colors</h2>
      <ul className={styles.swatches}>
        {COLORS.map((c) => (
          <li key={c.hex} className={styles.swatch}>
            <span className={styles.chip} style={{ background: c.hex }} />
            {c.name} <code>{c.hex}</code>
          </li>
        ))}
      </ul>

      <h2>Font</h2>
      <p>
        The wordmark is set in Nunito ExtraBold and the slogan in Nunito Regular.{" "}
        <a href="https://fonts.google.com/specimen/Nunito" target="_blank" rel="noopener noreferrer">
          Nunito
        </a>{" "}
        is free under the SIL Open Font License. The SVG files have the text converted to paths, so
        you do not need to install it.
      </p>
    </div>
  );
}
