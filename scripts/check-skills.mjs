#!/usr/bin/env node
// Verifies skills/<pkg>/** and llms.txt against the package: size budgets, banned words,
// subpath imports, and imported / called identifiers exist in the BUILT type declarations.
// Run after `npm run build`. No dependencies. Copy unchanged into each package repo.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const short = pkg.name.split("/").pop();
const skillDir = join(root, "skills", short);
const errors = [];
const fail = (file, msg) => errors.push(`${file}: ${msg}`);

const LIMITS = { description: 400, body: 6 * 1024, reference: 8 * 1024, llms: 3 * 1024 };
const BANNED = /\b(deprecated|legacy|formerly|backward[- ]compat\w*|old way|migration)\b/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

// ---- collect files
const files = [];
const skillMd = join(skillDir, "SKILL.md");
if (!existsSync(skillMd)) fail("skills", `missing skills/${short}/SKILL.md`);
else files.push({ path: skillMd, kind: "skill" });
const refDir = join(skillDir, "references");
if (existsSync(refDir)) {
  for (const f of readdirSync(refDir).filter((n) => n.endsWith(".md"))) {
    files.push({ path: join(refDir, f), kind: "reference" });
  }
}
const llms = join(root, "llms.txt");
if (!existsSync(llms)) fail("llms.txt", "missing");
else files.push({ path: llms, kind: "llms" });

// ---- export map -> type declaration files
const exportsMap = pkg.exports ?? {};
const subpaths = Object.keys(exportsMap).filter((k) => k !== "./package.json");
function typesFileFor(key) {
  const entry = exportsMap[key];
  const cand = [];
  const walk = (v) => {
    if (typeof v === "string") cand.push(v);
    else if (v && typeof v === "object") {
      if (v.types) walk(v.types);
      for (const k of Object.keys(v)) if (k !== "types") walk(v[k]);
    }
  };
  walk(entry);
  for (const c of cand) {
    const base = c.replace(/\.(m|c)?js$/, "");
    for (const ext of [".d.mts", ".d.ts", ".d.cts"]) {
      const p = join(root, `${base}${ext}`);
      if (existsSync(p)) return p;
    }
    if (/\.d\.(m|c)?ts$/.test(c) && existsSync(join(root, c))) return join(root, c);
  }
  return null;
}
const exportCache = new Map();
function exportedNames(key) {
  if (exportCache.has(key)) return exportCache.get(key);
  const file = typesFileFor(key);
  if (!file) {
    exportCache.set(key, null);
    return null;
  }
  const src = readFileSync(file, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const p = part.trim().replace(/^type\s+/, "");
      if (!p) continue;
      const as = p.split(/\s+as\s+/);
      names.add((as[1] ?? as[0]).trim());
    }
  }
  for (const m of src.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum|namespace)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(m[1]);
  }
  exportCache.set(key, names);
  return names;
}
function matchSubpath(sub) {
  const key = sub === "" ? "." : `.${sub}`;
  if (exportsMap[key]) return key;
  for (const k of subpaths) {
    if (k.endsWith("/*") && key.startsWith(k.slice(0, -1))) return k;
  }
  return null;
}
const union = new Set();
for (const k of subpaths) {
  if (k.includes("*")) continue;
  const n = exportedNames(k);
  if (n) for (const x of n) union.add(x);
}
if (![...subpaths].some((k) => !k.includes("*") && exportedNames(k))) {
  fail("build", "no type declarations found; run `npm run build` first");
}

// member / method names declared anywhere in dist (engine.close(), repo.check(), ...)
const members = new Set();
(function scan(dir) {
  if (!existsSync(dir)) return;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) scan(p);
    else if (/\.d\.(m|c)?ts$/.test(n)) {
      for (const m of readFileSync(p, "utf8").matchAll(/\b([A-Za-z_$][\w$]*)\??\s*[(:<]/g)) members.add(m[1]);
    }
  }
})(join(root, "dist"));

// ---- checks
const subRe = new RegExp(`${pkg.name.replace("/", "\\/")}((?:\\/[\\w.*\\-]+)*)`, "g");
for (const { path, kind } of files) {
  const rel = path.slice(root.length + 1).replaceAll("\\", "/");
  let text = readFileSync(path, "utf8");
  let body = text;
  if (kind === "skill") {
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!fm) fail(rel, "missing frontmatter");
    else {
      body = text.slice(fm[0].length);
      const d = fm[1].match(/^description:\s*(?:>-?\s*\n)?([\s\S]*?)(?=\n\w[\w.-]*:|$)/m);
      const desc = (d?.[1] ?? "").replace(/\s*\n\s*/g, " ").replace(/^["']|["']$/g, "").trim();
      if (!desc) fail(rel, "missing description");
      else if (desc.length > LIMITS.description) {
        fail(rel, `description ${desc.length} chars > ${LIMITS.description}`);
      }
      if (!/name:\s*\S+/.test(fm[1])) fail(rel, "frontmatter needs name");
      if (!/minVersion/.test(fm[1])) fail(rel, "frontmatter needs metadata.minVersion");
    }
    const bytes = Buffer.byteLength(body, "utf8");
    if (bytes > LIMITS.body) fail(rel, `body ${bytes} B > ${LIMITS.body}`);
    for (const r of files.filter((f) => f.kind === "reference")) {
      const name = r.path.split(/[\\/]/).pop();
      if (!body.includes(`references/${name}`)) fail(rel, `reference ${name} not linked`);
    }
  } else {
    const bytes = Buffer.byteLength(text, "utf8");
    const lim = kind === "llms" ? LIMITS.llms : LIMITS.reference;
    if (bytes > lim) fail(rel, `size ${bytes} B > ${lim}`);
  }
  if (BANNED.test(text)) fail(rel, `banned word: ${text.match(BANNED)[0]}`);
  if (text.includes("—") || text.includes("–")) fail(rel, "em/en dash found");
  if (EMOJI.test(text)) fail(rel, "emoji found");

  // subpath mentions
  for (const m of text.matchAll(subRe)) {
    const sub = m[1].replace(/\.+$/, "");
    if (sub === "" && !exportsMap["."]) continue; // bare package name, no root entry
    if (!matchSubpath(sub)) fail(rel, `subpath not exported: ${pkg.name}${sub}`);
  }
  // import statements
  const importRe = new RegExp(
    `import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+["']${pkg.name.replace("/", "\\/")}((?:\\/[\\w.*\\-]+)*)["']`,
    "g",
  );
  for (const m of text.matchAll(importRe)) {
    const key = matchSubpath(m[2]);
    if (!key) continue; // reported above
    const names = exportedNames(key);
    if (!names) continue;
    for (const part of m[1].split(",")) {
      const n = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (n && !names.has(n)) fail(rel, `${n} not exported by ${pkg.name}${m[2]}`);
    }
  }
  // inline call tokens: `name()` checked against the line's single subpath, else the union
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("import ")) continue;
    const others = [...line.matchAll(/@classytic\/([\w-]+)/g)].some((x) => `@classytic/${x[1]}` !== pkg.name);
    if (others) continue;
    const subs = new Set([...line.matchAll(subRe)].map((x) => x[1].replace(/\.+$/, "")));
    const key = subs.size === 1 ? matchSubpath([...subs][0]) : null;
    const pool = key && !key.includes("*") ? exportedNames(key) : union;
    if (!pool) continue;
    for (const t of line.matchAll(/`([A-Za-z_$][\w$]*)\(\)`/g)) {
      if (!pool.has(t[1]) && !(members.has(t[1]) && !key)) fail(rel, `${t[1]}() not exported${key ? ` by ${pkg.name}${[...subs][0]}` : ""}`);
    }
  }
}

if (errors.length) {
  console.error(`check-skills FAILED (${errors.length})`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`check-skills ok: ${files.length} files, ${union.size} exported names`);
