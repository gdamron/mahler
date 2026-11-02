# Installed Mahler Files

This directory contains runtime configuration and policies installed by the Mahler CLI.

- `config.json`: workspace-specific Mahler configuration.
- `policies/`: canonical workflow policies used by all agents.
- `agents/profiles/`: role and capability profiles.
- `agents/`: workspace-local adapter notes for supported runtimes.
- `decisions/`: append-only ledger of recorded Tier-1 deviations (see `mahler decide`), with a generated `INDEX.md`.
- `knowledge/`: what agents and humans have learned about the code, tools, and project, one fact per note (see `mahler learn` and `policies/knowledge.md`). The path is `knowledge.path` in `config.json`.

Native agent artifacts are generated outside .harness:

- `.agents/skills/`: Codex project skills.
- `.codex/agents/`: Codex project agents.
- `.claude/skills/`: Claude project skills.
- `.claude/agents/`: Claude project agents.

See `custom/README.md` to adapt policies, skills, or profiles for this workspace.
