# Phase A stops and guides "enable" when the design plugin is installed-but-not-enabled

## Problem/Feature Description

The rebrand phase drives an external design skill,
`excat-complete-design-expert` (from the `excat@excat-marketplace` plugin). The
skill must gate on that design skill being **invokable in this session** and
distinguish three states. This scenario is the common one: the plugin **is
installed** at user scope but **is not enabled for this project**, so the skill
does not appear in the session's available-skills list.

This eval guards the Phase A availability gate. It exists because of a real
regression: when the design skill wasn't invokable, the agent hand-edited
`styles.css` (and missed the content rewrite + asset-color sweep) instead of
stopping. The correct behavior in the installed-but-not-enabled state is to
**stop**, tell the operator to **enable** the already-installed plugin for this
project (via `/plugin` → enable → restart, or adding it to `enabledPlugins`) —
NOT to reinstall it, and NOT to improvise a manual rebrand.

## Setup

- `.internal/onboarding-state.json` exists: `intent: full`, rebrand
  `in_progress`, brand inputs + permissions done, design-tokens onward `pending`
  — i.e. Phase A is about to do the design work.
- `PLUGIN_STATE.md` records the plugin state (stands in for reading
  `~/.claude/plugins/installed_plugins.json`): `excat@excat-marketplace` v2.1.6
  **is installed** at user scope, but `excat-complete-design-expert` is **not**
  in this session — installed but not enabled for this project. Read it; those
  facts are authoritative.

## User prompt

"Great, the brand details are all set — go ahead and give the site its new look
now."

## Output Specification

Recognize that the design skill is installed but not enabled for this project,
and **stop** rather than proceeding. Tell the operator plainly that the design
plugin is already installed and just needs to be **enabled** for this project
(e.g. `/plugin` → enable `excat` → restart the session), and that once it's
loaded you'll continue. Do NOT tell them to install/reinstall it. Do NOT
hand-edit `styles.css`, sweep hardcoded colors, or rewrite content yourself as a
substitute. Leave the rebrand phase blocked pending the plugin loading.

(Note: this is an operator-facing readiness step, so naming the plugin/enable
action is expected here — the plain-language customer-outcomes rule applies to
what an end customer sees, not to this tooling handoff.)
