# Risk Policy

Risk decides how much verification a change gets before an agent merges it
(see the verification policy). It does not decide who merges; the merge policy
does that. Every issue and local task has one of three levels: low, medium, or
high.

## Levels

- **Low:** small, easy to undo, and easy to notice if wrong, with a clear
  spec. Typical: documentation, test-only changes, small bug fixes with
  covering tests, and internal refactors fully covered by existing tests.
- **Medium:** the default. It changes behavior that users or other code rely
  on, stays within one area, and a revert undoes it.
- **High:** hard to undo, hard to notice, wide reach, or an unclear spec.
  Typical: authentication, authorization, payments, secrets or cryptography,
  data migrations or schema, data deletion, infrastructure, deploy or CI
  configuration, a public API or cross-repo contract others consume, a
  dependency upgrade across a major version, and concurrency or real-time
  paths.

## Classifying

Rate the change on four dimensions. The highest one sets the level.

- **Blast radius:** who or what breaks if it is wrong. One internal function
  is low; one feature is medium; many users, other repos, or other teams is
  high.
- **Reversibility:** how it is undone. A revert is low or medium; anything a
  revert can't fix (migrated or deleted data, a published contract, a sent
  message) is high.
- **Detectability:** how soon a failure would show. A test or an obvious
  error is low; a wrong result someone has to notice is medium; silent
  corruption or a failure only under load or timing is high.
- **Spec clarity:** how well the criteria pin down the behavior. Precise
  criteria are low; criteria that leave choices to the implementer are
  medium; criteria that need interpretation, or none at all, are high.

When unsure between two levels, take the higher one.

## When Risk Is Set

Risk is set when the work is written down, before anyone implements it.

- An agent that writes an issue adds one of the labels in `risk.labels` in
  `.harness/config.json` and gives a one-line reason in the description that
  names the deciding dimension.
- A local task carries it in its brief (`mahler task --risk`, or `risk` in the
  task file).
- A risk label on a Linear project applies to every issue in it, as a floor.
- If an issue arrives with no level, the conductor classifies it before
  starting, records the level and reason in `HANDOFF.md`, and adds the label
  in Linear when it can.

The level that applies is the highest of the issue's labels, its project's
labels, and the task brief's `risk` field. `AGENT_SESSION.md` shows it under
`## Risk and Verification`.

## Risk Only Goes Up

Any agent may raise the level at any time when it learns something: while
implementing, reviewing, or preparing to merge. Record the new level and why
in `HANDOFF.md`, and update the label or brief. Raising the level means
completing the higher level's verification before merge. If high-risk
acceptance tests could not be frozen before implementation because the risk
was found later, the tester still writes them from the spec and the record
says they came after.

Lowering the level is a Tier 1 deviation. Only the composer or the human may
lower it, only before implementation starts, and the reason goes in the
decision ledger. After implementation starts, the level never goes down.

## Before Merging

The composer checks every PR against these signals and raises the level when
one matches:

- At least **medium**: it touches the issue's `protectedAreas` or relates to
  its `riskNotes`; it exceeds roughly 300 lines of non-test changes; changed
  behavior lacks covering tests; or the reviewer rated any finding critical,
  even if it was fixed.
- **High**: it touches any of the high-risk areas listed above.

## Writing Issues

Agents write most issues, so an issue must be enough for a tester who never
sees the code:

- A risk label and its one-line reason.
- Acceptance criteria stated as observable behavior: inputs, outputs, error
  cases, and limits, not implementation steps. When the project has criteria
  IDs (P1, P2, ...), name the ones the issue serves.
- Non-goals and protected areas.
- For high risk, how the change ships and how it is undone (see the
  verification policy).
