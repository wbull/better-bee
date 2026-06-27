# Better Bee — Agentic Ship Pipeline

**Date:** 2026-06-27
**Status:** Design (approved in brainstorming, pending spec review)
**Repo home:** `/Users/wbull/git/better-bee` (canonical, committed)

## 1. Purpose

Let a single prompt or GitHub issue be handed to a team of role-specialized
agents that take a change from idea to a reviewable Pull Request: **plan →
implement → test/verify → open PR**. A human merge of the PR is the ship step
(Tampermonkey auto-delivers from `main`).

The design is shaped by two facts about this project:

1. **Shipping is instant and effectively irreversible.** A merge to `main`
   auto-updates every installed user via the `@updateURL`/`@downloadURL` headers.
   There is no staging. → The pipeline never pushes to `main`; it stops at a PR.
2. **The unit tests have a structural blind spot.** Pure functions are
   *copy-pasted* from `better_bee.user.js` into the `test_*.mjs` files, so a
   changed function can keep passing against a stale copy. → A deterministic
   drift guard and a real browser-verification step compensate.

## 2. Non-goals (YAGNI)

- No direct-to-`main` automation, no auto-merge.
- No separate beta/dev channel delivery (the existing `better_bee.dev.user.js`
  is out of scope for this pipeline).
- No build step (the `.user.js` file remains the deliverable).
- No parallel multi-approach exploration in v1 (possible later via Orca
  worktrees / the Workflow orchestrator — see §8).

## 3. Architecture

```
/ship-bee "<issue # | issue URL | free prompt>"
        │
        ▼
🧭 Planner ──▶ 🔨 Implementer ──▶ 🧪 Verifier ──▶ 🚀 Shipper ──▶ PR opened
                   ▲                   │                         (human merge = ship)
                   └──── fail, retry ◀─┘ (bounded: 2 attempts)

  guardrail hooks (run by the harness, not the agents):
   • drift-guard    — blocks commit/PR if a pure fn in source ≠ its copy in test_*.mjs
   • version-guard  — blocks a commit that edits the script without bumping @version
```

- **Vehicle:** a repo-committed slash command (`.claude/commands/ship-bee.md`)
  that orchestrates four custom subagents (`.claude/agents/bee-*.md`) in
  sequence. Orchestration is model-driven (the command file instructs the main
  agent to dispatch each subagent and pass artifacts forward).
- **Autonomy boundary:** Planner → Implementer → Verifier run unattended. The
  Shipper opens a PR and stops. Review + merge is human.
- **Plan gate:** none mid-run — the plan is captured in the PR body and reviewed
  alongside the diff.

## 4. Entry point: `/ship-bee`

Argument parsing:

- Matches `^#?\d+$` or a `github.com/.../issues/\d+` URL → fetch with
  `gh issue view <n> --json title,body,comments`. The PR will later reference
  `Closes #<n>`.
- Otherwise → treat the argument as the free-text task description.

The command file documents the pipeline and tells the main agent to run the four
subagents in order, forwarding each one's structured output to the next, and to
surface the final PR URL.

## 5. The four agents

Each is a Claude Code subagent under `.claude/agents/` with a **minimal** tool
grant.

### 5.1 🧭 bee-planner  (tools: Read, Grep, Glob, Bash[`gh`,`git`])  — read-only on code
**Input:** issue/prompt.
**Work:**
- If an issue ref, fetch it via `gh issue view`.
- Locate the target `// Module N` section in `better_bee.user.js` (the file is
  organized Module 1–5; reading top-to-bottom is the intended navigation).
- Enumerate the **pure functions** that will change and map each to the
  `test_*.mjs` file that holds its copy (mirror-pairs).
- Flag header changes needed: `@version` bump (always for user-visible change),
  and any new `@connect`/`@grant`.
- **Classify risk.** `high` if the change touches any of: `WORD_LIST_SELECTORS`,
  the shared `MutationObserver`, `gmFetch`/`GM_xmlhttpRequest`/`@connect`, or
  NYT-DOM reads (`unsafeWindow.gameData`). Otherwise `low`.

**Output (structured):**
```json
{
  "task_summary": "…",
  "issue_ref": 123,                     // or null
  "target_module": "Module 5: Hint System",
  "mirror_pairs": [ { "fn": "buildHintQueue", "test_file": "test_build_hint_queue.mjs" } ],
  "header_changes": { "version_bump": "minor", "connect_add": [], "grant_add": [] },
  "risk": "high",
  "plan_steps": [ "…" ]
}
```

### 5.2 🔨 bee-implementer  (tools: Read, Edit, Bash)
**Input:** planner output.
**Work:**
- Apply the edits to `better_bee.user.js`.
- For each mirror-pair, copy the updated function body into the matching
  `test_*.mjs` so source and test agree.
- Bump the `@version` line (line ~4) per `header_changes.version_bump`.
- Apply any `@connect`/`@grant` additions.

**Output:** list of files changed + the new version string.

### 5.3 🧪 bee-verifier  (tools: Bash, Read, Chrome MCP `mcp__claude-in-chrome__*`)
**Input:** planner output (for `risk`) + implementer output.
**Work:**
1. Run `npm test`. Any failure → return failure (see retry loop).
2. **Always:** open `sandbox.html` in Chrome via the MCP, exercise the affected
   UI, capture a screenshot.
3. **If `risk == high`:** verify against the live NYT Spelling Bee page in the
   user's Chrome session, then drive a minimal puzzle interaction (e.g. type a
   word, trigger a hint with `?`) and capture a screenshot.

   **Decided approach — shimmed injection (option a).** The script depends on
   greasemonkey APIs (`GM_xmlhttpRequest`, `GM_addStyle`,
   `GM_getValue`/`GM_setValue`, `GM_registerMenuCommand`) and `unsafeWindow`,
   none of which exist in a normal page context, so raw injection of the IIFE
   via `javascript_tool` would throw on the first `GM_*` call. The verifier
   therefore defines lightweight `GM_*` shims on the page **before** injecting:
   - `GM_xmlhttpRequest` → `fetch` (restricted to the `@connect` host allow-list)
   - `GM_addStyle` → inject a `<style>` element
   - `GM_getValue`/`GM_setValue` → `localStorage`
   - `GM_registerMenuCommand` → no-op (records the label for assertion only)
   - `unsafeWindow` → `window`

   The shim block is a small, reusable helper (defined once in the verifier
   agent's instructions / a snippet file) and is a known maintenance surface:
   when a new `GM_*` grant is added to the userscript header, the shim set must
   gain a matching entry. **Fallback:** if the shims cannot reproduce the
   specific behavior under test, the verifier reports sandbox-only coverage and
   says so explicitly in the PR (it never silently claims a live pass).

**Output:** `{ pass: bool, npm_test_output, screenshots: [paths], notes }`.

**Retry loop:** on failure, return control to the Implementer with the failure
detail. Bounded to **2 implementer attempts**; after that the pipeline stops,
summarizes, and leaves the branch for manual inspection (no PR).

### 5.4 🚀 bee-shipper  (tools: Bash[`git`,`gh`])
**Input:** all prior outputs.
**Work:**
- Create a branch `ship/<slug>-v<version>`.
- Commit with subject `v<version>: <task_summary>` (matches existing convention).
- Push; open a PR whose body contains: the plan, `npm test` output, screenshots
  (attached to the PR conversation, **not committed** per repo policy), risk
  level, and `Closes #<n>` when an issue drove it.
- **Does not merge.** Returns the PR URL.

## 6. Guardrail hooks (deterministic, in `.claude/settings.json`)

Run by the harness, not the agents, so they cannot be skipped.

### 6.1 drift-guard — `scripts/check-drift.mjs`
A drift manifest maps `function name → test file`. The script extracts each named
function from both `better_bee.user.js` and its test file, normalizes whitespace,
and exits non-zero on any mismatch (printing a unified diff). Wired as a
**PreToolUse** hook matching `git commit` / `gh pr create` Bash calls; also added
to `npm test` so drift fails locally too.

### 6.2 version-guard — `scripts/check-version-bump.mjs`
If `better_bee.user.js` differs from `HEAD` but its `@version` line does not, exit
non-zero. Same PreToolUse hook bundle.

> Manifest maintenance: when a new pure function gains a test copy, add it to the
> drift manifest. A missing entry means that function is simply not drift-checked
> (fail-open for unlisted functions, fail-closed for listed ones).

## 7. Repo layout

```
better-bee/
├─ .claude/
│  ├─ commands/ship-bee.md
│  ├─ agents/bee-planner.md
│  ├─ agents/bee-implementer.md
│  ├─ agents/bee-verifier.md
│  ├─ agents/bee-shipper.md
│  └─ settings.json            # registers the two hooks
├─ scripts/
│  ├─ check-drift.mjs
│  └─ check-version-bump.mjs
└─ docs/superpowers/specs/2026-06-27-bee-ship-pipeline-design.md
```

## 8. Future extensions (not in v1)

- **Parallel exploration:** run the Implementer across N Orca worktrees (fan one
  prompt to several approaches), verify each, open the best as the PR.
- **Determinism:** port the orchestration to the Workflow scripting tool for
  fully scripted pipeline/retry/verification stages.
- **CI mirror:** a GitHub Action that runs `npm test` + drift-guard on every PR,
  so the gates hold even for hand-made PRs.

## 9. Error handling summary

| Situation | Behavior |
|---|---|
| Planner can't locate the module | Stop, ask the user. |
| Verifier fails after 2 implementer retries | Stop, summarize, leave branch, no PR. |
| `gh` not authenticated | Shipper stops with the exact `gh auth login` hint. |
| Drift / missing version bump | Hook blocks the commit with a diff/message. |
| Live-NYT verify flaky (login/puzzle) | Note it in the PR; fall back to sandbox result; do not silently pass. |

## 10. Success criteria

- `/ship-bee "<issue|prompt>"` produces a PR with: a correct `@version` bump,
  source/test parity (drift-guard green), passing `npm test`, and at least a
  sandbox screenshot (plus a live-NYT screenshot for high-risk changes).
- A change that breaks a copied test function cannot reach a PR.
- A script edit without a version bump cannot be committed.
- No path in the pipeline pushes to or merges `main`.
</content>
</invoke>
