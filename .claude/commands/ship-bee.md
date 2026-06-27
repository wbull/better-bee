---
description: Take a Better Bee change from an issue or prompt to an opened PR via the planner→implementer→verifier→shipper agent team.
---

Run the Better Bee ship pipeline for: **$ARGUMENTS**

Orchestrate these subagents in strict order, passing each one's JSON output to the next. Do not edit code or run git yourself — the agents own their steps.

1. Dispatch **bee-planner** with the input `$ARGUMENTS`. If it returns `{"error": ...}`, relay it and STOP.
2. Dispatch **bee-implementer** with the planner JSON.
3. Dispatch **bee-verifier** with the planner JSON (for `risk`) and the implementer JSON.
   - If `pass` is false: dispatch **bee-implementer** again with the verifier's `notes` appended to the plan, then re-run **bee-verifier**. Allow at most 2 implementer attempts total. If still failing, STOP, summarize, and leave the branch for manual inspection (no PR).
4. Once the verifier reports `pass: true`, dispatch **bee-shipper** with all prior outputs.
5. Report the returned `pr_url` to the user. Do not merge.

Guardrails (drift-guard, version-guard) run automatically as a commit hook — if the shipper is blocked, surface the hook message.
