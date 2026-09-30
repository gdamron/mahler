# Mahler Customization Overlay

Files here adapt the canonical Mahler workflow for *this workspace* without forking it.
Reinstall (`mahler install`) never overwrites anything under `.harness/custom/`.

## How it works

On install, Mahler writes its canonical defaults, then overlays this directory:

- A custom file with the **same name** as a Mahler default **replaces** that default.
- A custom file with a **new name** is **added** to the install set.
- Composed markdown carries a provenance header (e.g.
  `> Mahler default was replaced by .harness/custom/policies/review.md`) so agents read one file.

## Layout

- `policies/<name>.md` — override or add a workflow policy installed to `.harness/policies/`.
- `skills/<name>/SKILL.md` — override or add a skill compiled to `.agents/skills/` and `.claude/skills/`.
  Must start with frontmatter containing `name: <name>` and `description:`.
- `agents/<name>.json` — override or add a profile (same shape as a Mahler profile).

`mahler doctor` validates the overlay: malformed sources fail `install`, and a profile that
allows a skill which is not installed is reported as a warning.
