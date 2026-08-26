#!/usr/bin/env node
// Local runner for the customer-migration skill evals.
//
// For one eval: seed its fixture into a fresh, ISOLATED temp workdir *outside*
// the repo — with the customer-migration skill copied into a local
// .claude/skills/ and a throwaway `git init` carrying the scenario's own
// remote — so the skill resolves but the model sees only the scenario's world
// (not the real assethub-spark checkout, whose real remotes/branch would
// otherwise make the model refuse to role-play a fake customer). Then run the
// skill headless via `claude -p`, judge the transcript + resulting workspace
// against the eval's criteria.json with a second `claude -p` call, and print a
// weighted score.
//
// Usage:
//   node run.mjs --eval <eval-name> [--label baseline] [--n 1]
//                [--model <model>] [--judge-model <model>] [--keep]
//   node run.mjs --all [--label baseline] [--n 1]
//                [--model <model>] [--judge-model <model>] [--keep]
//
// --all discovers every subdirectory of evals/ containing both a task.md and
// a criteria.json (i.e. every real eval, skipping runner/ and anything
// mid-authored), runs each in turn, and prints a combined summary table at
// the end. Failures in one eval don't stop the rest.
//
// No Tessl, no plugin packaging — just the local `claude` CLI.

import { spawn, execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  access,
  readdir,
  stat,
} from "node:fs/promises";
import { join, dirname, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALS_DIR = dirname(__dirname); // .../customer-migration/evals
const SKILL_DIR = dirname(EVALS_DIR); // .../.claude/skills/customer-migration
const SKELETON_DIR = join(__dirname, "skeleton"); // minimal fork skeleton
const RESULTS_ROOT = join(__dirname, "results");
// Default scenario git remote; a fixture may override via scenario.json.
const DEFAULT_ORIGIN = "git@github.com:acme-co/acme-portal.git";

const { values: args } = parseArgs({
  options: {
    eval: { type: "string" },
    all: { type: "boolean", default: false },
    label: { type: "string", default: "baseline" },
    n: { type: "string", default: "1" },
    model: { type: "string" },
    "judge-model": { type: "string", default: "sonnet" },
    keep: { type: "boolean", default: false },
  },
});

if (!args.eval && !args.all) {
  console.error("error: --eval <eval-name> or --all is required");
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Discover every real eval directory under evals/ (has task.md + criteria.json).
// Skips runner/ and anything mid-authored (missing one of the two files).
// ---------------------------------------------------------------------------
async function discoverEvals() {
  const entries = await readdir(EVALS_DIR, { withFileTypes: true });
  const names = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name === "runner" || e.name.startsWith(".")) continue;
    try {
      await access(join(EVALS_DIR, e.name, "task.md"));
      await access(join(EVALS_DIR, e.name, "criteria.json"));
      names.push(e.name);
    } catch {
      // not a real eval dir (no task.md/criteria.json) — skip silently
    }
  }
  return names.sort();
}

// ---------------------------------------------------------------------------
// Run one `claude -p` invocation, return the parsed result JSON.
// ---------------------------------------------------------------------------
function claude({ prompt, cwd, permissionMode, jsonSchema, model }) {
  return new Promise((resolve, reject) => {
    const cliArgs = ["-p", prompt, "--output-format", "json"];
    if (permissionMode) cliArgs.push("--permission-mode", permissionMode);
    if (model) cliArgs.push("--model", model);
    if (jsonSchema) cliArgs.push("--json-schema", JSON.stringify(jsonSchema));

    const child = spawn("claude", cliArgs, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(
          new Error(`claude exited ${code}\nstderr:\n${err}\nstdout:\n${out}`)
        );
      }
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error(`could not parse claude JSON output: ${e}\n${out}`));
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Load the eval's spec files.
// ---------------------------------------------------------------------------
async function loadEval(name) {
  const dir = join(EVALS_DIR, name);
  const taskMd = await readFile(join(dir, "task.md"), "utf8");
  const criteria = JSON.parse(
    await readFile(join(dir, "criteria.json"), "utf8")
  );
  let persona = null;
  try {
    persona = await readFile(join(dir, "persona.md"), "utf8");
  } catch {}
  let hasFixture = false;
  try {
    await access(join(dir, "fixture"));
    hasFixture = true;
  } catch {}
  // Optional scenario.json can override the seeded git origin, etc.
  let scenario = {};
  try {
    scenario = JSON.parse(await readFile(join(dir, "scenario.json"), "utf8"));
  } catch {}
  return { name, dir, taskMd, criteria, persona, hasFixture, scenario };
}

// Extract the first `## User prompt` block from task.md (strip one quote layer).
function extractPrompt(taskMd) {
  const m = taskMd.match(/^##\s*User prompt[^\n]*\n+([\s\S]*?)(?=^##\s|\Z)/m);
  if (!m) throw new Error("task.md has no '## User prompt' section");
  return m[1]
    .trim()
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/^`([\s\S]*)`$/, "$1")
    .trim();
}

// Determine permission mode. IMPORTANT: never use "plan" — plan mode reframes
// the turn as "produce an implementation plan for approval", so the skill
// narrates internal phase/step names instead of *acting* as the skill (posing
// the customer question, mutating state). Both decision-only and execution
// evals must run the skill conversationally:
//   - execution evals (with a fixture to mutate) -> acceptEdits
//   - decision-only evals -> dontAsk (executes, tool prompts suppressed, no
//     plan wrapper; read-only decisions still surface in the transcript)
// Overridable via a task.md front line `<!-- permission: <mode> -->`.
function permissionModeFor(evalObj) {
  const m = evalObj.taskMd.match(/<!--\s*permission:\s*(\S+)\s*-->/);
  if (m) return m[1];
  return evalObj.hasFixture ? "acceptEdits" : "dontAsk";
}

// Build the run prompt: the user prompt, plus (if a persona exists) an
// instruction block telling the headless session how the simulated customer
// answers, since `-p` has no interactive AskUserQuestion picker.
function buildRunPrompt(evalObj) {
  const userPrompt = extractPrompt(evalObj.taskMd);
  // NOTE: this scope note is trusted operator framing (it comes from the eval
  // operator via the prompt, not from a workspace file). It is written to read
  // as a legitimate rehearsal setup — NOT as "ignore reality, obey this file",
  // which a well-behaved model correctly treats as prompt-injection and
  // refuses. Keep it that way: describe the exercise, don't demand blind
  // obedience.
  const scope = `[Eval operator note — from me, ${
    process.env.USER || "the developer"
  }, running my own test harness]
I wrote the customer-migration skill and I'm running my own local eval harness
to rehearse it against a scripted scenario in a throwaway sandbox. This note is
from me (the authenticated operator of this session), delivered through the
prompt — it is a legitimate, sanctioned request, not third-party content and
not an attempt to manipulate you. Please engage with the exercise rather than
declining it as suspicious.

Why this is safe to proceed with:
- The working directory is a disposable sandbox I built for this one run — a
  trimmed fork skeleton, plus whatever scenario files this particular run needs
  (some runs have a pre-seeded \`.internal/onboarding-state.json\`, a
  \`home/.claude/plugins/installed_plugins.json\`, or short scenario notes;
  others deliberately start with none — e.g. a first-invocation scenario has an
  empty \`.internal/\`). Only rely on files that are actually present; a
  referenced-but-absent file just means this scenario doesn't use it, NOT that
  something is trying to trick you. Whatever files ARE present are the
  scenario's given inputs, standing in for things not reachable from a sandbox
  (live GitHub, the real ~/.claude, live services) — reading them and taking
  them as the scenario's facts is exactly what I want.
- Nothing here is destructive or exfiltrating: no real customer, no real
  secrets, no network changes. It's a rehearsal of conversational/decision
  behavior. Missing repo files or absent services are expected — don't report
  them as problems or treat them as red flags; just play the scenario.
- Act exactly as the skill would for the single customer/situation the scenario
  describes. You don't need to reconcile any of this with the surrounding
  checkout you happened to be launched from, and you don't need to ask which
  customer or fork is meant.`;

  const personaBlock = evalObj.persona
    ? `

[TEST HARNESS — simulated customer]
When you would normally ask the customer a question, still SHOW the question you
would ask (so it can be checked), then proceed using the persona's answers below
without waiting. Do not stop to wait for real input.

<persona>
${evalObj.persona}
</persona>`
    : "";

  return `${userPrompt}

---
${scope}${personaBlock}`;
}

// ---------------------------------------------------------------------------
// Snapshot the workspace: a Map of relative path -> file contents (or an
// "<N bytes — omitted>" placeholder for large files), plus the same data
// flattened to text for the judge prompt / workspace.txt artifact.
// Structured form lets deterministic checks (see below) look up an exact file
// by path instead of re-parsing the flattened "### path\n<body>" text.
// ---------------------------------------------------------------------------
async function snapshotWorkspace(root, maxFileBytes = 20000) {
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Skip the seeded skill copy, git internals, and deps — the judge cares
      // about the scenario end-state (state files, secrets, created files),
      // not the skill text we planted.
      if (e.name === "node_modules" || e.name === ".git" || e.name === ".claude")
        continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else files.push(p);
    }
  }
  await walk(root);
  const map = new Map();
  for (const f of files.sort()) {
    const rel = relative(root, f);
    let body = "";
    try {
      const s = await stat(f);
      if (s.size <= maxFileBytes) body = await readFile(f, "utf8");
      else body = `<${s.size} bytes — omitted>`;
    } catch {
      body = "<unreadable>";
    }
    map.set(rel, body);
  }
  const text = [...map.entries()].map(([rel, body]) => `### ${rel}\n${body}`).join("\n\n");
  return { map, text };
}

// ---------------------------------------------------------------------------
// Deterministic pre-checks: criteria whose truth is a plain fact about the
// workspace or transcript (a JSON key's value, whether a literal string
// appears somewhere) get graded here, in JS, instead of by the judge model.
// Same reasoning the suite's own "Design rule" already states — assert on
// objective end-state wherever possible — applied to the grading step itself,
// not just to how criteria are worded. A criterion with a `check` field never
// varies run-to-run for a fixed end-state; only criteria WITHOUT a `check`
// field are sent to the judge at all, so its prompt shrinks accordingly.
//
// Supported check types:
//   { type: "jsonPath", file, path, equals }       — dot-path lookup, ===
//   { type: "jsonPath", file, path, notEquals }     — dot-path lookup, !==
//   { type: "fileContains", file, value | ref }     — file: null scans every
//                                                      snapshot file
//   { type: "fileNotContains", file, value | ref }  — same, inverted
//   { type: "transcriptContains", value | ref }
//   { type: "transcriptNotContains", value | ref }
//
// `value` is a literal string; `ref` is a dot-path into the eval's own
// scenario.json (e.g. "secretValue") for values that must stay in sync with
// task.md's prompt rather than being duplicated into criteria.json.
// ---------------------------------------------------------------------------
function resolveCheckValue(check, scenario) {
  if (check.value !== undefined) return check.value;
  if (check.ref !== undefined) {
    const v = check.ref.split(".").reduce((o, k) => o?.[k], scenario);
    if (v === undefined) {
      throw new Error(`check.ref "${check.ref}" not found in scenario.json`);
    }
    return v;
  }
  throw new Error(`check has neither "value" nor "ref": ${JSON.stringify(check)}`);
}

function jsonPathLookup(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function runDeterministicCheck(check, { workspaceMap, transcript, scenario }) {
  switch (check.type) {
    case "jsonPath": {
      const raw = workspaceMap.get(check.file);
      if (raw === undefined) {
        return { pass: false, evidence: `${check.file} not found in workspace` };
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { pass: false, evidence: `${check.file} is not valid JSON` };
      }
      const actual = jsonPathLookup(parsed, check.path);
      if ("equals" in check) {
        const pass = actual === check.equals;
        return {
          pass,
          evidence: `${check.file}: ${check.path} === ${JSON.stringify(actual)} (expected ${JSON.stringify(check.equals)})`,
        };
      }
      if ("notEquals" in check) {
        const pass = actual !== check.notEquals;
        return {
          pass,
          evidence: `${check.file}: ${check.path} === ${JSON.stringify(actual)} (expected != ${JSON.stringify(check.notEquals)})`,
        };
      }
      throw new Error(`jsonPath check needs "equals" or "notEquals": ${JSON.stringify(check)}`);
    }
    case "fileContains":
    case "fileNotContains": {
      const needle = resolveCheckValue(check, scenario);
      const wantContains = check.type === "fileContains";
      if (check.file) {
        const raw = workspaceMap.get(check.file) ?? "";
        const found = raw.includes(needle);
        return {
          pass: found === wantContains,
          evidence: `${check.file} ${found ? "contains" : "does not contain"} the checked value`,
        };
      }
      // file: null (or omitted) -> scan every file in the snapshot.
      for (const [rel, body] of workspaceMap) {
        if (body.includes(needle)) {
          return {
            pass: !wantContains,
            evidence: `${rel} contains the checked value`,
          };
        }
      }
      return {
        pass: wantContains ? false : true,
        evidence: "checked value not found in any workspace file",
      };
    }
    case "transcriptContains":
    case "transcriptNotContains": {
      const needle = resolveCheckValue(check, scenario);
      const wantContains = check.type === "transcriptContains";
      const found = transcript.includes(needle);
      return {
        pass: found === wantContains,
        evidence: `transcript ${found ? "contains" : "does not contain"} the checked value`,
      };
    }
    default:
      throw new Error(`unknown check.type: ${check.type}`);
  }
}

// Split an eval's checklist into deterministic verdicts (computed now, in JS)
// and the remaining criteria (no `check` field) that still need the judge.
function runDeterministicChecks(evalObj, ctx) {
  const verdicts = [];
  const remaining = [];
  for (const c of evalObj.criteria.checklist) {
    if (!c.check) {
      remaining.push(c);
      continue;
    }
    const { pass, evidence } = runDeterministicCheck(c.check, ctx);
    verdicts.push({ name: c.name, pass, evidence: `[deterministic] ${evidence}` });
  }
  return { verdicts, remaining };
}

// ---------------------------------------------------------------------------
// Judge one run against criteria.json → per-item pass/fail + weighted score.
// ---------------------------------------------------------------------------
const JUDGE_SCHEMA = {
  type: "object",
  required: ["verdicts"],
  additionalProperties: false,
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "pass", "evidence"],
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          pass: { type: "boolean" },
          evidence: { type: "string" },
        },
      },
    },
  },
};

async function judge(evalObj, remainingCriteria, transcript, workspaceSnapshot, model) {
  if (remainingCriteria.length === 0) return [];

  const checklist = remainingCriteria
    .map((c) => `- name: ${c.name}\n  (max_score ${c.max_score}) ${c.description}`)
    .join("\n");

  const prompt = `You are grading ONE run of an agent eval named "${evalObj.name}".
Grade each checklist item as a BINARY pass/fail against what actually happened.
(Some criteria for this eval were already graded deterministically in code and
are not shown to you — only judge the items listed below.)

Rules:
- Judge only what the item states; no partial credit.
- "pass" needs positive evidence in the transcript or the workspace snapshot.
  If you cannot find evidence either way, that is a FAIL — say "no evidence".
- For file/state items, trust the workspace snapshot's actual file contents
  over any claim in the transcript.
- Evidence must be concrete: a short quote from the transcript, or a file
  path + value from the workspace snapshot.

Eval context: ${evalObj.criteria.context}

Checklist:
${checklist}

<agent-transcript>
${transcript}
</agent-transcript>

<workspace-snapshot>
${workspaceSnapshot || "(no fixture / empty workspace)"}
</workspace-snapshot>

Return JSON matching the schema: one verdict per checklist item, using the
item's exact "name".`;

  const res = await claude({
    prompt,
    cwd: __dirname,
    permissionMode: "plan",
    jsonSchema: JUDGE_SCHEMA,
    model,
  });
  let parsed;
  try {
    parsed = JSON.parse(res.result);
  } catch {
    throw new Error(`judge did not return parseable JSON:\n${res.result}`);
  }
  return parsed.verdicts;
}

function score(criteria, verdicts) {
  const byName = new Map(verdicts.map((v) => [v.name, v]));
  let earned = 0;
  let total = 0;
  const rows = [];
  for (const c of criteria.checklist) {
    total += c.max_score;
    const v = byName.get(c.name);
    const pass = v?.pass === true;
    if (pass) earned += c.max_score;
    rows.push({
      name: c.name,
      max: c.max_score,
      pass,
      evidence: v?.evidence ?? "no verdict returned",
    });
  }
  return { earned, total, pct: total ? Math.round((earned / total) * 100) : 0, rows };
}

// ---------------------------------------------------------------------------
// One run: seed → run skill → snapshot → judge → score.
// ---------------------------------------------------------------------------
async function runOnce(evalObj, i) {
  const runDir = join(RESULTS_ROOT, args.label, evalObj.name, `run-${i}`);
  await mkdir(runDir, { recursive: true });

  // Seed a fresh ISOLATED workspace OUTSIDE the repo, so the model sees only the
  // scenario's world — not the real assethub-spark checkout it was launched
  // from (whose real git remotes/branch would otherwise make it refuse to
  // role-play a fake customer, or bleed real facts into the run).
  const workRoot = await mkdtemp(join(tmpdir(), "cm-eval-"));

  // Make the customer-migration skill resolvable in isolation by copying it
  // into a local .claude/skills/ (verified: `claude -p` finds it there).
  await mkdir(join(workRoot, ".claude", "skills"), { recursive: true });
  await cp(SKILL_DIR, join(workRoot, ".claude", "skills", "customer-migration"), {
    recursive: true,
    // don't copy the evals dir into the skill copy (avoids recursion/noise)
    filter: (src) => !src.includes(`${sep}evals${sep}`) && !src.endsWith(`${sep}evals`),
  });

  // Lay down a minimal but real-looking portal skeleton (package.json, .nvmrc,
  // README, local.sh, styles/, cloudflare/) so the sandbox reads as a genuine
  // fork rather than "an empty dir with nothing to migrate" — which otherwise
  // makes the model refuse the scenario as fabricated.
  await cp(SKELETON_DIR, workRoot, { recursive: true });

  // Give the scenario its own throwaway git repo + remote + an initial commit,
  // so `git remote -v` returns the scenario's origin (not the real repo's) and
  // the fork has plausible history.
  let origin = DEFAULT_ORIGIN;
  if (evalObj.scenario?.origin) origin = evalObj.scenario.origin;
  try {
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: workRoot });
    execFileSync("git", ["remote", "add", "origin", origin], { cwd: workRoot });
    execFileSync("git", ["add", "-A"], { cwd: workRoot });
    execFileSync(
      "git",
      ["-c", "user.email=eval@local", "-c", "user.name=eval", "commit", "-q", "-m", "initial fork"],
      { cwd: workRoot }
    );
  } catch (e) {
    console.warn(`  (git seed failed, continuing: ${e.message})`);
  }

  // Lay the fixture on top (state files, marker files, scenario-specific stubs)
  // — it overrides the skeleton where they overlap.
  if (evalObj.hasFixture) {
    await cp(join(evalObj.dir, "fixture"), workRoot, { recursive: true });
  }

  const runPrompt = buildRunPrompt(evalObj);
  const permissionMode = permissionModeFor(evalObj);

  console.log(`  run-${i}: skill (${permissionMode}) …`);
  const runRes = await claude({
    prompt: runPrompt,
    cwd: workRoot,
    permissionMode,
    model: args.model,
  });
  const transcript = runRes.result ?? "";
  await writeFile(join(runDir, "transcript.txt"), transcript);
  await writeFile(join(runDir, "run.json"), JSON.stringify(runRes, null, 2));

  const { map: workspaceMap, text: workspaceSnapshot } = await snapshotWorkspace(workRoot);
  await writeFile(join(runDir, "workspace.txt"), workspaceSnapshot);

  const { verdicts: deterministicVerdicts, remaining } = runDeterministicChecks(evalObj, {
    workspaceMap,
    transcript,
    scenario: evalObj.scenario,
  });

  console.log(
    `  run-${i}: judge (${remaining.length}/${evalObj.criteria.checklist.length} criteria; ` +
      `${deterministicVerdicts.length} graded deterministically) …`
  );
  const judgeVerdicts = await judge(
    evalObj,
    remaining,
    transcript,
    workspaceSnapshot,
    args["judge-model"]
  );
  const verdicts = [...deterministicVerdicts, ...judgeVerdicts];
  const result = score(evalObj.criteria, verdicts);
  await writeFile(
    join(runDir, "score.json"),
    JSON.stringify({ verdicts, ...result }, null, 2)
  );

  if (!args.keep) await rm(workRoot, { recursive: true, force: true });
  return { runDir, ...result };
}

// Run one eval end-to-end (n reps) and print its own detail block, same shape
// as the single-eval path. Returns the average pct (or null if every rep
// errored) so --all can build a final summary table.
async function runEval(name, n) {
  const evalObj = await loadEval(name);
  console.log(`\neval: ${evalObj.name}  (label=${args.label}, n=${n})`);

  const runs = [];
  for (let i = 1; i <= n; i++) {
    try {
      runs.push(await runOnce(evalObj, i));
    } catch (e) {
      console.error(`  run-${i}: ERROR — ${e.message}`);
    }
  }

  if (runs.length === 0) {
    console.log("  (no successful runs)");
    return null;
  }

  console.log("\n  === results ===");
  for (const r of runs) {
    console.log(`    ${r.pct}%  (${r.earned}/${r.total})  ${r.runDir}`);
  }
  const last = runs[runs.length - 1];
  console.log("\n    checklist (last run):");
  for (const row of last.rows) {
    console.log(
      `     ${row.pass ? "✅" : "❌"}  [${row.max}] ${row.name} — ${row.evidence}`
    );
  }
  const avg = Math.round(runs.reduce((a, r) => a + r.pct, 0) / runs.length);
  console.log(`\n    average: ${avg}%`);
  return avg;
}

// ---------------------------------------------------------------------------
async function main() {
  const n = Math.max(1, parseInt(args.n, 10) || 1);

  if (args.all) {
    const names = await discoverEvals();
    if (names.length === 0) {
      console.error("error: no evals discovered under " + EVALS_DIR);
      process.exit(2);
    }
    console.log(`discovered ${names.length} evals: ${names.join(", ")}`);

    const summary = [];
    for (const name of names) {
      const avg = await runEval(name, n);
      summary.push({ name, avg });
    }

    console.log("\n\n=== summary (all evals) ===");
    for (const { name, avg } of summary) {
      console.log(`  ${avg === null ? " ERR" : String(avg).padStart(4) + "%"}  ${name}`);
    }
    const scored = summary.filter((s) => s.avg !== null);
    if (scored.length > 0) {
      const overall = Math.round(scored.reduce((a, s) => a + s.avg, 0) / scored.length);
      console.log(`\n  overall average: ${overall}%  (${scored.length}/${summary.length} evals scored)`);
    }
    return;
  }

  await runEval(args.eval, n);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
