# Phase A stops and guides "add marketplace + install" when the design plugin isn't installed at all

## Problem/Feature Description

The rebrand phase drives an external design skill,
`excat-complete-design-expert` (from the `excat@excat-marketplace` plugin).
SKILL.md's Phase A gate names three distinct states — invokable now,
installed-but-not-enabled, and **not installed at all** — and each has a
different correct fix. This eval is the third state: no
`excat@excat-marketplace` entry exists anywhere.

It guards the Phase A availability gate's **install-from-scratch branch**,
which is easy to conflate with the "just enable it" branch already covered
by `design-plugin-disabled-guides-enable`. The correct behavior here is
different: tell the operator to **add the marketplace and install** the
plugin (`/plugin marketplace add <path-or-repo>` then
`/plugin install excat@excat-marketplace`), not simply "enable" something
that was never installed — and, as in the sibling eval, never hand-roll the
rebrand as a substitute.

## Setup

- `.internal/onboarding-state.json` exists: `intent: full`, rebrand
  `in_progress`, brand inputs + permissions done, design-tokens onward
  `pending` — Phase A is about to do the design work.
- `home/.claude/plugins/installed_plugins.json` is empty — no
  `excat@excat-marketplace` entry at all (see `SCENARIO.md`; stands in for
  reading the real `~/.claude/plugins/installed_plugins.json`).

## User prompt

"Great, the brand details are all set — go ahead and give the site its new
look now."

## Output Specification

Recognize that the design plugin is **not installed at all** (distinct from
installed-but-disabled) and **stop** rather than proceeding. Tell the
operator plainly that the plugin needs to be **installed first** — naming
both steps: adding the marketplace (`/plugin marketplace add
<path-or-repo of aem-excat-plugin/excat-marketplace>`) and then installing
(`/plugin install excat@excat-marketplace`) — followed by enabling it for
the project and restarting the session. Do NOT tell them merely to "enable"
something as if it were already installed. Do NOT hand-edit `styles.css`,
sweep hardcoded colors, or rewrite content yourself as a substitute. Leave
the rebrand phase blocked pending the plugin loading.

(Note: this is an operator-facing readiness step, so naming the
plugin/marketplace is expected here — the plain-language customer-outcomes
rule applies to what an end customer sees, not to this tooling handoff.)
