// Generates iPhone PWA launch screens (public/splash/*.png) from the app icon.
// Run from the repo root after changing the icon:  node apps/web/scripts/make-splash.mjs
// Sizes come from lib/splash-sizes.mjs, which app/layout.tsx also uses for `startupImage`.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SPLASH_SIZES } from "../lib/splash-sizes.mjs";

const pub = fileURLToPath(new URL("../public/", import.meta.url));
const BG = "#f2f2f7";

await mkdir(`${pub}splash`, { recursive: true });
for (const s of SPLASH_SIZES) {
  const w = s.width * s.ratio;
  const h = s.height * s.ratio;
  const iconSize = Math.round(w * 0.28);
  const icon = await sharp(`${pub}icons/icon-512.png`).resize(iconSize, iconSize).png().toBuffer();
  await sharp({ create: { width: w, height: h, channels: 3, background: BG } })
    .composite([{ input: icon, top: Math.round((h - iconSize) / 2), left: Math.round((w - iconSize) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(`${pub}splash/${w}x${h}.png`);
  console.log(`splash/${w}x${h}.png`);
}
