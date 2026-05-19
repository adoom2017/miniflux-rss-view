import { copyFile, mkdir } from "fs/promises";
import { join } from "path";

const distDir = "dist";
const assets = [
  "manifest.json",
  "styles.css",
  "README.md",
  "LICENSE",
  "versions.json",
];

await mkdir(distDir, { recursive: true });

for (const asset of assets) {
  await copyFile(asset, join(distDir, asset));
}
