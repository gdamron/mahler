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
- `acceptance-priorities.md` — optional. What this workspace most wants acceptance tests to
  protect (for example: the paths users depend on, failures that are hard to notice). It adds
  to the verification policy instead of replacing it: the tester weights its tests toward it,
  and the conductor never drops a test that covers it. Plain prose or a short list.

`mahler doctor` validates the overlay: malformed sources fail `install`, and a profile that
allows a skill which is not installed is reported as a warning.
