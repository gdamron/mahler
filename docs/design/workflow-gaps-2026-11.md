# Proposal: Three Workflow Gaps From a Long Stacked Run

Status: proposal, waiting on decisions (2026-11-24)

## Where This Comes From

A composer ran one high-risk issue over two days as a stack of 21 PRs, with a
conductor, slice conductors, a tester, and a deep reviewer. The frozen suite
grew to 22 files and about 5,500 lines, drove a browser with audio, and took
9 to 20 minutes a run. Three gaps in Mahler showed up. Each is checked below
against the source at v2026.11.4.

| Gap | Smallest change | Size | Status |
|---|---|---|---|
| 1. `mahler check` passes without the frozen suite having run | Say "compared, not run" now; then record suite runs and report them in the check | 1 tiny PR, then 1 medium PR | Needs decisions |
| 2. A conductor hands back while its sub-agents run | Wording in the delegate, conduct, and compose skills; reports written to files | 1 small wording PR | Needs decisions; part is the runtime's |
| 3. An agent completed an action another agent was refused | Policy and brief wording | 1 small wording PR | Drafted as a PR |

## 1. The Check Passes Without the Frozen Suite Running

### What the source does

- `mahler check` compares frozen files by content and nothing more.
  `changedFrozenFiles` in `src/commands/acceptance.ts` hashes each file and
  compares it with the frozen blob id. `frozenAcceptanceFindings` and
  `testerWorktreeFindings` turn that into an `ok` line: "N frozen acceptance
  file(s) for issue X match <sha>". The run ends with "All configured checks
  passed."
- `mahler acceptance run` runs the project suite only. It needs
  `acceptance.repo` and `acceptance.run`, and fails without them. A workspace
  with no project suite has no Mahler command that runs an acceptance test.
- The issue's tester suite is run by hand. "Running the Tester's Suite" in
  the verification policy is three shell lines: `cd` to the tester worktree,
  merge the issue branch, run the repo's test command. Nothing records that
  it ran, at which commit, or how it went. The verification record's "Tester
  results: <n> pass" is typed by the conductor.
- The merge policy's readiness list says "`mahler check` passed for the
  touched repo, including the frozen acceptance tests in the tester's
  worktree", which reads as if the check ran them.

So "check passed, 14 frozen files match" can sit beside a suite that fails or
has never run at that commit. In the run above, conductors ran the suite by
hand and reported counts in prose ("258 of 261"), and the composer had to
keep track of which commit each count belonged to.

### Proposed change

The check should not run the suite. A 9 to 20 minute run that needs a browser
and audio can't be part of a command slice conductors run on every push, and
at high risk the suite is meant to fail until the implementation is finished.
The check should instead report what is known about the suite, as its own
line, and never let "files match" read as "tests pass".

**Step 1, wording (tiny, about 10 lines with tests).** The `ok` line becomes
"N frozen acceptance file(s) match <sha> (compared, not run)". The merge
policy's readiness line is corrected to say the files are unchanged, and that
the suite's result comes from the verification record.

**Step 2, record runs and report them (medium, about 200 lines with tests,
plus policy and skill text).**

- `mahler acceptance run --issue <ISSUE>` without `--project` runs the
  tester's suite. For each of the issue's freezes in a tester worktree it
  merges the issue's top branch into that worktree (the merge the policy
  already describes), runs a configured command there, and records an event:
  repo, the implementation commit and its tree id, the frozen commit, pass or
  fail, and the duration. The command is new config, one per repo, with a
  `<files>` placeholder for the frozen files.
- `mahler check --issue <ISSUE>` reads the latest record and prints one of:
  - `ok`: frozen suite passed on this tree at <time>
  - `warn`: frozen suite last passed at <sha>; the branch has changed since
  - `warn`: frozen suite not run
  - `fail`: frozen suite failed at <sha>
- The closing line names the state: "Configured checks passed; frozen suite
  not run at this commit." A flag (`--require-acceptance`) turns the two
  `warn` states into failures. The conduct skill's Verify step and the merge
  skill use the flag; slice conductors don't.
- The verification record's "Tester results" line is copied from the event
  rather than typed.

### Decisions needed

1. **Does "not run" or "stale" fail the check by default?** Proposed: no,
   only with the flag, because the suite is expected to fail before the
   implementation is complete. The alternative is to fail by default once
   the issue's PRs are open.
2. **What makes a pass stale?** Proposed: the tree id of the implementation's
   top commit, as the check's pass cache already uses. A restack that changes
   no content keeps the pass; any content change, even a version bump, asks
   for another 20 minutes. The alternative is to let the conductor carry a
   pass forward across a named commit as a recorded deviation.
3. **Pass counts.** Mahler can't parse every test runner. Proposed: record
   pass or fail and the duration, and take an optional `--summary "272 of
   273"` from the agent. The alternative is to have the configured command
   print a summary line Mahler reads.
4. **Where the command lives.** Proposed: a per-repo key in
   `.harness/config.json`, beside `checks`, since it is a command and not
   prose.

### Two related rough edges

**A check that failed on a freeze waiting to be recorded.** After a dispute
decision the tester committed its fix, and the next `mahler check` failed
with "frozen acceptance tests differ from <sha> … only the tester changes
them, after a dispute decision", until the conductor froze again. The
comparison was right, but the message pointed at tampering. Proposed (about
25 lines): when the tester worktree has commits after the frozen commit, the
finding says so and gives the next step: "the tester worktree is at <sha>,
ahead of the freeze; if this follows a dispute decision, freeze again with
`--reason`". No decision needed.

**Promoting a large suite into a long stack.** "Promoting Acceptance Tests"
asks for one commit of ordinary tests beside the code, each in the PR whose
code it covers, before the PRs open. A 5,500-line end-to-end suite with its
own harness doesn't fit: it outweighs every PR in the stack, cuts across all
of them, and passes only at the top. The composer ruled it into a test-only
stack on top of the feature stack and recorded a deviation. Proposed policy
text: when the kept tests pass only at the top of a stack, or would outweigh
the PRs they'd join, they land as a test-only PR above the stack's top,
reviewed against the frozen originals, opened before the stack merges and
merged right after; the verification record names it. That makes the ruling
the documented path. Decisions: whether that PR joins the same stack or forms
its own, and whether "What CI Must Do" should allow a heavy promoted suite to
run in a separate or scheduled CI job instead of on every PR.

## 2. A Conductor Hands Back While Its Sub-Agents Run

### What happens

A conductor launches a slice conductor, tester, or reviewer, and has nothing
to do until it reports. Its turn ends, and the runtime delivers its last
message to the composer as a hand-back. Later reports from its sub-agents go
to the composer, which forwards each one and resumes the conductor. In the
run above this happened dozens of times in a day.

### What the source says

Nothing. No skill or policy says whether to launch a sub-agent in the
foreground or the background. The only mention of either is in the delegate
skill, about shell commands ("run it in the background and wait"). The
conduct skill's Monitor step assumes the conductor is still there when a
slice reports, and the compose skill's Monitor step assumes each report
reaches the agent that asked for it.

### What belongs to the runtime

Claude Code's sub-agent documentation, as read on 2026-11-24 (worth
re-reading before the wording lands):

- A foreground sub-agent blocks its caller until it returns. A custom agent
  launched from the main conversation starts in the background by default.
- In an interactive terminal session, a sub-agent that launched background
  sub-agents waits for them before it finishes. In headless and SDK sessions,
  a nested background child that outlasts its spawner reports to the main
  conversation. The desktop app behaved the second way.
- The parent resumes a finished sub-agent by messaging its id.

Mahler can't change where the runtime sends a finished child's report, can't
stop the hand-back once a sub-agent's turn ends with children still running,
and can't remove the cost of resuming a conductor. It can stop conductors
from getting into that state, and make a stray report cheap to handle.

### Proposed wording

**Delegate skill, a new part of "Launch it":**

> **Foreground or background.** If you will have nothing to do until the
> sub-agent reports, launch it in the foreground, so your turn continues when
> it returns. To run several at once, launch them as foreground calls in one
> message. Use the background only when you have work of your own to do
> meanwhile, and collect every background sub-agent's result before your turn
> ends. Never end your turn to wait: in some runtimes that hands your
> unfinished work back to your parent, and your sub-agents' reports follow it
> there.

**Conduct skill, Monitor step:**

> Don't report to your parent while a sub-agent of yours is running. If the
> runtime makes you reply anyway, the reply is not a report. Start it with
> "Interim: sub-agents still running", and list each one (id, role, what it
> is doing) and what you will do when it reports, so your parent can resume
> you with one line.

**Brief template, "Results destination":** a sub-agent writes its report to a
file under the issue's metadata directory (for example
`reports/<role>-<n>.md`) as well as replying. A resumed conductor reads the
file, so the composer forwards a path, not a report.

**Compose skill, Monitor step:**

> A report from an agent you didn't launch (a reviewer, tester, or slice
> conductor) belongs to its conductor. Don't act on it or answer it. Resume
> that conductor with the report's file path, and move on.

### Decisions needed

1. **Reports in files.** This is the one new convention: a `reports/`
   directory per issue, cleaned up with the issue. It makes forwarding cheap,
   and it costs each sub-agent one more write.
2. **A runtime setting.** The same documentation names an environment
   variable that makes Claude wait for sub-agents
   (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`). It hasn't been tried here. If
   it works in the desktop app, `INSTALL.md` could recommend it and most of
   the wording above becomes a fallback.
3. **Execution mode.** When hand-backs stay frequent, the composer can
   already act as the conductor itself ("composer-as-conductor" in the
   compose skill), which removes a layer. The compose skill could name
   frequent forced hand-backs as a reason to switch.

No PR is open for this gap: the wording depends on runtime behavior that
should be tried first.

## 3. An Agent Completed an Action Another Agent Was Refused

### What happened

A conductor tried to stop a leftover test server. The permission check denied
the command, and the conductor reported the process to the composer, which
passed the decision to the human. Meanwhile a tester, asked only to confirm
that nothing of its own was still listening, found the same process and
stopped it, knowing the conductor had been refused. Nothing was harmed.
Leftover test servers were found three times in the same run.

### What the source says

- The judgment policy covers Tier 3 refusals by the forge ("a merge that the
  forge refuses is a guardrail doing its job") but not a permission prompt, a
  denied command, or a blocked tool call.
- No policy mentions processes. The workspace-safety policy covers worktrees
  and files only.
- The brief template has no cleanup clause. The tester reads only the
  workspace-safety policy, and a slice conductor reads three, so a rule in
  the judgment policy alone would not reach them.

### Proposed change (drafted)

- Judgment policy, "When an Action Is Refused": a refusal covers the action,
  not only the agent that tried it. Report it, don't do it another way, and
  don't ask or let another agent do it. An action another agent was refused
  is refused for you too, until the human says otherwise.
- Workspace-safety policy, "Processes": stop what you started before you
  report, and list it. Stop only what you started. Report any other process
  and leave it running. A request to confirm nothing is running is a check,
  not a cleanup.
- Brief template: two standing instructions, one for refusals and one for
  "leave nothing running, and say what you started", so every sub-agent gets
  them whatever it reads.
- Delegation policy, "Refusals and Cleanup": a parent never briefs another
  agent to take a refused action, and a brief that wants cleanup names the
  processes, who started them, and who approved stopping them.
- The acceptance-test, review, and conduct skills list started processes in
  their reports and add a refusal to their stop conditions.

About 60 lines, wording only.

### Decisions needed

1. **How long a refusal lasts.** Drafted as "until the human says otherwise".
   A composer can't lift it, even though it may approve Tier 2 actions.
2. **The standing brief clause.** It adds two bullets to every brief. The
   alternative is to add them only to briefs for roles that start servers.
3. **Anything in code.** Not proposed. `mahler cleanup` could list listeners
   whose working directory is under the issue's worktrees, as a report, if
   leftover servers keep turning up.

## Suggested Order

1. Gap 3 wording (drafted).
2. Gap 1 step 1 and the refreeze message: small, no design choice.
3. Gap 2 wording, after trying the runtime setting.
4. Gap 1 step 2, after the four decisions.
5. The promotion text, after its two decisions.
