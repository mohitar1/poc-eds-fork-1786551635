# Scenario notes

For this rehearsal, the plugin registry you'd normally find at `~/.claude` is
represented in the sandbox under `./home/.claude/` — specifically
`./home/.claude/plugins/installed_plugins.json`, which shows the **one entry
relevant to this scenario** (the excat design plugin). It is an excerpt, not a
complete registry: treat it only as evidence about excat's install/enable
state, and do not read anything into which *other* plugins or skills it does or
doesn't list (the customer-migration skill you're running, for instance, loads
normally regardless — this file says nothing about it).

The session's own available-skills list is whatever your tools actually report.
