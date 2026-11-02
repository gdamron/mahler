---
name: write-issue
description: Write an issue or local task that an agent can implement and a tester can verify without seeing the code — its outcome, acceptance criteria, risk, non-goals, and size.
---

# Write Issue

Agents write most issues, and the issue is the spec. The implementer builds
from it, the tester writes acceptance tests from it without seeing the code,
and the merge decision checks against it. A vague criterion turns into a
dispute later; a missing one turns into behavior nobody tested.

## Triggers

- the compose skill's Plan and Specify steps
- a set-aside review finding that becomes new work
- work agreed with the human in conversation (a local task)
- "write an issue for X", "split this into issues"

## Required Policies

- judgment
- risk
- verification
- issue-selection

## Allowed Commands

- `mahler linear-template issue` and `mahler linear-template task`
- `mahler task <slug> --agent <agent> --task-file <task.json>`
- Linear MCP to create or update issues and their labels, when your role
  allows it: a composer creates the issues in its plan; a conductor proposes
  follow-up issues to its parent rather than creating them

## Shape of an Issue

1. **Title:** the outcome, not the work ("Reject malformed emails at signup",
   not "Update validation").
2. **Context:** one or two sentences on why, naming the project criteria it
   serves (P1, P2, ...) when the project has them.
3. **Acceptance criteria:** see below.
4. **Non-goals:** what a reasonable implementer might do that this issue
   should not.
5. **Protected areas and risk notes:** code or behavior to leave alone, and
   known hazards.
6. **Risk:** a risk label and a one-line reason naming the deciding dimension
   (see the risk policy). A project's risk label is the floor.
7. **Dependencies:** blocking issues, and interfaces shared with other issues
   (put the shared contract in the composer's `Specifications`).
8. **High risk only:** how the change ships and how it is undone.

## Acceptance Criteria

Each criterion is one behavior that a tester can check from outside the
code.

- **Behavior, with its trigger and result.** "Given a situation, when
  something happens, then this result" is one way to write it. The form is
  optional; the three parts are not.
- **One behavior each.** An "and" joining two outcomes usually means two
  criteria.
- **Concrete values.** Name the inputs, outputs, messages or codes, limits,
  and timings. "Handles errors" can't be tested; "exits 2 with `service
  unavailable` after two retries" can.
- **The edges this change creates.** Empty, missing, too large, repeated,
  concurrent, or unauthorized, as they apply.
- **What must not change,** when breaking existing behavior is the risk.
- **No implementation.** Leave out function, file, and library names and the
  approach, unless they are the public interface.

| Weak | Testable |
|---|---|
| Email validation works | Submitting signup with an email missing `@` shows "Enter a valid email" and sends no request |
| Handle upstream errors gracefully | When the rates API returns 503, `sync` retries twice, then exits 2 with `service unavailable` |
| Make the parser faster | Parsing `fixtures/large.json` (10 MB) takes under 2 s in CI, and the output is byte-identical to before |

## Check Before Handing It On

For each criterion:

- Could a tester who never sees the code write a test for it that fails
  today?
- Would two implementers who both meet it build things that behave the same
  for a user? If not, it leaves too much open.

For the whole issue:

- Does meeting every criterion deliver the outcome in the title?
- Is every criterion needed for that outcome?

## Size

- One issue is one deliverable that can merge on its own. If the criteria
  fall into groups that could ship separately, split the issue.
- Aim for one PR or a short stack. If you expect more than about three PRs,
  it is probably several issues.
- When the work can't be described as behavior yet, write a spike issue
  first, whose deliverable is a written finding, not code.

## Required Outputs

- A Linear issue with its risk label, or a task file in the shape printed by
  `mahler linear-template task`
- `mahler issue` and `mahler task` warn when a brief has no criteria or no
  risk level: fix the issue rather than starting work

## Stop Conditions

- the outcome or a criterion needs a product or scope decision only the human
  can make: use the interview skill
- you are a conductor and the issue is new work: propose it to your parent
