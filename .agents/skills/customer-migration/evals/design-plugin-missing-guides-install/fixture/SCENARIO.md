# Scenario notes

The plugin registry you'd normally find at `~/.claude` is represented in the
sandbox under `./home/.claude/` — specifically
`./home/.claude/plugins/installed_plugins.json`, which is **empty**: no
`excat@excat-marketplace` entry at all. This is the "not installed at all"
state, distinct from "installed but not enabled for this project." Treat this
file as authoritative about excat's install state only — it says nothing
about which other plugins or skills are or aren't present (the
customer-migration skill you're running loads normally regardless).

The session's own available-skills list is whatever your tools actually
report.
