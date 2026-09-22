// Verifies that the version number is identical across every file that
// declares it, so a release can never ship with a mismatched installer
// version, Tauri identifier version, or Cargo package version.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

function cargoPackageVersion(text) {
  const match = text.match(/^\[package\][^[]*?\nversion\s*=\s*"([^"]+)"/m);
  return match?.[1];
}

function cargoLockVersion(text, packageName) {
  const match = text.match(new RegExp(`name = "${packageName}"\\nversion = "([^"]+)"`));
  return match?.[1];
}

const sources = {
  "package.json": JSON.parse(read("package.json")).version,
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  "src-tauri/Cargo.toml": cargoPackageVersion(read("src-tauri/Cargo.toml")),
  "src-tauri/Cargo.lock": cargoLockVersion(read("src-tauri/Cargo.lock"), "wrava"),
};

const versions = new Set(Object.values(sources));
if (versions.size !== 1 || [...versions][0] === undefined) {
  console.error("Version numbers do not match across the project:");
  for (const [file, version] of Object.entries(sources)) {
    console.error(`  ${file}: ${version ?? "(not found)"}`);
  }
  process.exit(1);
}

const [version] = versions;
const newsHeadings = [...read("NEWS.md").matchAll(/^## (\d+\.\d+\.\d+) - /gm)].map((match) => match[1]);
if (!newsHeadings.includes(version)) {
  console.error(
    `NEWS.md has no "## ${version} - yyyy-mm-dd" entry for the current version (${version}).`,
  );
  console.error("Add a dated entry before releasing, or move it out of Unreleased.");
  process.exit(1);
}

console.log(`Version ${version} is consistent across package.json, tauri.conf.json, Cargo.toml, Cargo.lock and NEWS.md.`);
