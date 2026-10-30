// Verifies the vendored third-party licence notices in `public/licenses/` stay
// present, stay in sync with the packages actually installed in `node_modules/`,
// and actually reach the production build output.
//
// Wrava bundles spelling dictionaries and the spellcheck engine into the
// shipped binary, so their licences must travel with the app. The list below is
// deliberately explicit and hand-maintained: it is the audit trail for "which
// third-party code do we redistribute?", and it is the thing a reviewer reads
// when a dependency is added. Do not replace it with a `node_modules` walk.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const licensesDir = "public/licenses";

// Every entry is a dependency whose code (or data) is compiled/bundled into the
// shipped desktop binary, which makes its licence a redistribution obligation.
// `vendored` is the file this repo publishes under `public/licenses/`;
// `licenseCandidates` are the filenames npm packages use, tried in order.
const bundledDependencies = [
  {
    // Hunspell en-US dictionary, imported by `src/spellingDictionaries.ts` and
    // loaded by nspell at runtime, so the .dic/.aff data ships in the binary.
    package: "dictionary-en",
    vendored: "dictionary-en.txt",
    licenseCandidates: ["LICENSE", "LICENSE.md", "license", "LICENCE", "LICENSE.txt"],
  },
  {
    // Hunspell en-GB dictionary, same path as above via `src/spellingEditors.ts`.
    package: "dictionary-en-gb",
    vendored: "dictionary-en-gb.txt",
    licenseCandidates: ["LICENSE", "LICENSE.md", "license", "LICENCE", "LICENSE.txt"],
  },
  {
    // The spellcheck engine itself, bundled with the editor via `nspell`.
    package: "nspell",
    vendored: "nspell.txt",
    licenseCandidates: ["LICENSE", "LICENSE.md", "license", "LICENCE", "LICENSE.txt"],
  },
  {
    // Transitive dependency of nspell (pulls in the Buffer shim), so it is
    // bundled too and inherits the same redistribution obligation.
    package: "is-buffer",
    vendored: "is-buffer.txt",
    licenseCandidates: ["LICENSE", "LICENSE.md", "license", "LICENCE", "LICENSE.txt"],
  },
];

// Escape hatch for packages that legitimately vendor a reformatted or abridged
// licence. Kept as an explicit, commented allowlist so a divergence is a
// reviewed decision rather than a silently weakened comparison. Currently
// empty: all four vendored notices are byte-identical to their packages after
// whitespace/line-ending normalization.
const reformattedLicenseAllowlist = new Set([
  // e.g. "some-package" // why the vendored text intentionally differs
]);

// Compares licence text ignoring differences that carry no legal meaning:
// CRLF vs LF, trailing whitespace, and runs of blank lines.
function normalize(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line !== "")
    .join("\n");
}

// Renders the first differing line as a diff rather than a bare false/true, so a
// stale or wrong licence is obvious at a glance.
function firstDifference(expected, actual) {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const shared = Math.min(expectedLines.length, actualLines.length);
  for (let index = 0; index < shared; index++) {
    if (expectedLines[index] !== actualLines[index]) {
      return [
        `      first difference at line ${index + 1}:`,
        `      - installed: ${JSON.stringify(expectedLines[index])}`,
        `      + vendored:  ${JSON.stringify(actualLines[index])}`,
      ].join("\n");
    }
  }
  if (expectedLines.length === actualLines.length) return "      lengths match but no line differs";
  const longer = expectedLines.length > actualLines.length ? expectedLines : actualLines;
  const side = expectedLines.length > actualLines.length ? "installed" : "vendored";
  return [
    `      first difference at line ${shared + 1} (only the ${side} copy has more lines):`,
    `      ${side}: ${JSON.stringify(longer[shared] ?? "<end of file>")}`,
  ].join("\n");
}

function findInstalledLicense(dependency) {
  const packageDir = path.join(root, "node_modules", dependency.package);
  if (!existsSync(packageDir)) {
    return { error: `package ${dependency.package} is declared as bundled but is not installed` };
  }
  // Resolve the candidate names against the entries that actually exist. The
  // candidates differ only in case and extension, and a case-sensitive
  // filesystem will not open `LICENSE` when the file is named `license`, so
  // matching the real name is what makes this work on Linux and macOS runners
  // as well as on Windows.
  let entries = [];
  try {
    entries = readdirSync(packageDir);
  } catch (error) {
    return { error: `could not read node_modules/${dependency.package}: ${error.message}` };
  }
  const byName = new Map(entries.map((name) => [name.toLowerCase(), name]));
  // The sweep is the fallback, so an unexpected `License.txt` or `LICENSE-MIT`
  // still resolves instead of silently reporting "licence not found".
  const match =
    dependency.licenseCandidates
      .map((name) => byName.get(name.toLowerCase()))
      .find(Boolean) ?? entries.filter((name) => /^licen[cs]e/i.test(name)).sort()[0];
  if (!match) return { error: `no licence file found in node_modules/${dependency.package}` };
  const contents = read(path.join("node_modules", dependency.package, match));
  return { path: `node_modules/${dependency.package}/${match}`, contents };
}

const nodeModules = path.join(root, "node_modules");
if (!existsSync(nodeModules)) {
  console.error("node_modules is missing, so the installed licences cannot be verified.");
  console.error("Run `npm install` first; this check compares `public/licenses/` against");
  console.error("the licence text actually shipped by each installed package.");
  process.exit(1);
}

const failures = [];

// 1. Completeness: every bundled dependency has a non-empty vendored notice.
for (const dependency of bundledDependencies) {
  const relative = path.posix.join(licensesDir, dependency.vendored);
  if (!existsSync(path.join(root, relative))) {
    failures.push(`${relative} is missing (required for bundled dependency ${dependency.package}).`);
    continue;
  }
  if (statSync(path.join(root, relative)).size === 0) {
    failures.push(`${relative} is empty (required for bundled dependency ${dependency.package}).`);
  }
}

// 2. Provenance: each vendored notice is the licence the installed package ships.
for (const dependency of bundledDependencies) {
  const relative = path.posix.join(licensesDir, dependency.vendored);
  if (!existsSync(path.join(root, relative))) continue;
  const installed = findInstalledLicense(dependency);
  if (installed.error) {
    failures.push(installed.error);
    continue;
  }
  const expected = normalize(installed.contents);
  const actual = normalize(read(relative));
  if (expected !== actual) {
    if (reformattedLicenseAllowlist.has(dependency.package)) {
      continue;
    }
    failures.push(
      [
        `${relative} does not match ${installed.path}.`,
        firstDifference(expected, actual),
        "      Re-vendor the licence text, or record an explicit reason in",
        "      reformattedLicenseAllowlist in scripts/check-licenses.mjs.",
      ].join("\n"),
    );
  }
}

// Orphan sweep: a vendored notice with no owner in the auditable list means
// either a stale leftover or a bundled dependency someone forgot to declare.
const vendoredFiles = readdirSync(path.join(root, licensesDir)).filter((name) => name !== ".gitkeep");
const knownVendored = new Set(bundledDependencies.map((dependency) => dependency.vendored));
for (const name of vendoredFiles) {
  if (!knownVendored.has(name)) {
    failures.push(
      `${licensesDir}/${name} is not in the bundledDependencies list in scripts/check-licenses.mjs.`,
    );
  }
}

// 3. Wiring: `public/` is Vite's default publicDir, copied verbatim into the
// build output. Confirm the config has not opted out or redirected it somewhere
// that would drop the notices, and prove the resolved directory contains them.
const viteConfigText = read("vite.config.ts");
const publicDirMatch = viteConfigText.match(/^\s*publicDir\s*:\s*([^,\n]+)/m);
if (publicDirMatch && /false/.test(publicDirMatch[1])) {
  failures.push("vite.config.ts sets publicDir: false, so public/licenses/ is not copied into the build.");
} else {
  const publicDir = publicDirMatch
    ? publicDirMatch[1].trim().replace(/^["'`]|[`"']$/g, "")
    : "public"; // Vite's default.
  const resolvedLicenses = path.join(root, publicDir, "licenses");
  if (!existsSync(resolvedLicenses)) {
    failures.push(
      `vite.config.ts resolves publicDir to "${publicDir}", but ${path.join(publicDir, "licenses")} does not exist.`,
    );
  } else {
    for (const dependency of bundledDependencies) {
      if (!existsSync(path.join(resolvedLicenses, dependency.vendored))) {
        failures.push(`${path.join(publicDir, "licenses", dependency.vendored)} is not reachable in the build output.`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Bundled dependency licence check failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Vendored licences are complete, match the installed packages, and ship via ${licensesDir}/ (${bundledDependencies.map((d) => d.package).join(", ")}).`,
);