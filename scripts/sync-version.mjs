import { readFile, writeFile } from "fs/promises";

const packageJsonPath = "package.json";
const manifestPath = "manifest.json";
const versionsPath = "versions.json";
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const packageJson = await readJson(packageJsonPath);
const manifest = await readJson(manifestPath);
const versions = await readJson(versionsPath);
const version = packageJson.version;

if (!semverPattern.test(version)) {
  throw new Error(`package.json version must be a semver value, got ${version}`);
}

if (!manifest.minAppVersion) {
  throw new Error("manifest.json must define minAppVersion");
}

manifest.version = version;
versions[version] = manifest.minAppVersion;

await writeJson(manifestPath, manifest);
await writeJson(versionsPath, versions);

console.log(`Synced manifest.json and versions.json to ${version}`);
