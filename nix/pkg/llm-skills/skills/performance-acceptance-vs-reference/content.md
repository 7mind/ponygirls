# Performance acceptance against a reference under noise

A ratio is only as good as its weakest assumption: same work, same configuration, same conditions for both sides.
[seen] marks what was observed; each failure so marked produced a convincing but wrong number.

## 1. Fix the rule with the owner, in numbers, before the first timed run
- Statistic (median of per-round ratios), threshold, gating shapes vs reported-only shapes, thread counts or devices,
  hardware type, and whether each cell or only the aggregate must pass.
- Define the timed region identically for both sides. If the reference does extra work (padding, unpadding, host prep),
  report the ratio with and without it ([seen] 1.058 / 1.053 / 1.022 for three definitions) and say which one the rule uses.
- Name the reference loop exactly (for example "encode loop of the pinned image", not "production"). A production pipeline
  with overlap is another yardstick.

**The rule block.** Before the first timed run of a series the report gets a section whose heading carries the time read
from the clock ("The rule, written at HH:MMZ, before any run of the series"). The series starts after it is saved; the
block is not edited after the first run. It states:
- **Cells**: every combination that gets a verdict, the device, the lock, the CPUs and how they are given (§3).
- **Runs**: rounds per cell; the order in each round (alternating or rotating over the sides); each run its own process;
  warm-up that is not recorded.
- **Completeness**: "All N runs are reported. None is dropped, skipped or repeated for any reason short of a crash; a
  crash is reported and its round kept as incomplete."
- **Statistic and threshold**: for example the median of per-round ratios, pass at ≥ 0.98 (throughput) or ≤ 1.02
  (latency); and the composition: "the verdict is pass only if every cell passes".
- **Failure clause**: "If a cell fails I report it as failed and add no rounds."
- **A quiet subset, if you want one, defined now**: the threshold with its basis, the unit ("a round is quiet if both of
  its runs started below the threshold"), which figure the verdict uses (all rounds or quiet rounds; both are reported,
  with the count), and the case of fewer than k quiet rounds ("the host was too busy for the second figure; no number
  is given").

**Check the rule itself.**
- False alarm: under "no real difference", a rule "candidate >= min of 2 baselines" fails 1 time in 3 (the candidate is
  the lowest of 3 exchangeable values). With m such metrics the chance of at least one false failure is up to 1-(1-p)^m
  (4 metrics at 1/3: about 80 %, less when correlated). Use one primary metric, or compare with the baseline-to-baseline
  spread from >= 3 baselines, or correct the thresholds. Write the false-alarm rate next to the rule.
- Power: run a small trial (toy scale, a sham candidate identical to the baseline; for a speed ratio see §5) and look at
  absolute values and counts. If the measured quantity is near noise ([seen] recall ~5 %, 11–16 of 120) or
  baseline-to-baseline variation exceeds the gap you want to detect, the instrument cannot decide. Fix the instrument,
  or declare beforehand that a miss yields "undecided", never "fail" or "pass".
- Follow-up: if the rule names one, write it as commands, inputs and a decision formula, and dry-run it on the small
  trial. Ask of every artifact it needs: will it exist after the run, and in the state the question needs? [seen] A
  logical dump (`pg_dump`/`pg_restore`) rebuilds indexes, graphs and statistics, so it cannot test insertion-order or
  index-state effects; a file-level copy, or a live measurement before teardown, can. A follow-up that cannot test the
  question is a plan defect to report, not a pass.

## 2. Time the configuration that ships
- Same build mode as the shipped artifact ([seen] the first tables were measured in the default mode while the shipped library
  used the optimised mode); same feature defaults ([seen] the benchmark turned on huge pages that the library leaves off);
  same entry point (module/DSO vs a static test binary: measure that overhead once, separately).
- Record the SHA-256 of the binary that produced each cell.

## 3. Isolate, and state how the CPUs are given
- Devices: an exclusive lock per device for timing (`flock -x`), shared locks for correctness runs (`flock -s`) among your
  own agents. Check before and during the run that no foreign compute process is on the device. [seen] Several agents
  picked the same free GPU until a lock-file convention existed.
- CPU placement is a condition of every verdict. Two conditions, never mixed in one table without a column that says which:
  - **exclusive whole cores**: a pinned set (`taskset`, a container CPU set), or a Kubernetes container with an integer
    CPU request equal to its limit on a node whose kubelet uses the static CPU manager;
  - **a quota over shared CPUs**: a container CPU limit with no CPU set (`cpu.max` set, `cpuset.cpus.effective` the
    whole node).
  [seen] Moving from a pinned set to a quota made an eight-thread engine 1.31 times slower (interval [1.05, 1.38]) and
  its reference 1.08 ([0.99, 1.18]).
- Establish which one the deployment uses from the running thing, not from the manifest alone: inside the container read
  `cpu.max`, `cpuset.cpus.effective`, the size of the affinity mask, and per allowed CPU its sibling hyperthreads and
  NUMA node. Record them before anything is timed; the run stops if they are not what the plan assumed.
- Judge the rule under the deployment's condition. A pinned run stays useful as the anchor and for bisecting code, and is
  reported as that; it gives both sides the same set of physical cores, one logical CPU per core, with the topology
  recorded. [seen] Parity on 4 cores × 2 hyperthreads (0.98) became 1.11 on 8 physical cores.
- "Pinned to quiet cores" is not exclusive on a host you share. [seen] Other agents' processes were pinned onto the same
  CPUs and the reference's worst call took about 11 s. Choose cores no other process is pinned to, and record
  runnable-but-waiting time (below) so that it shows.
- A measurement pod copies the production pod's shape, including its QoS class: a Guaranteed pod (requests = limits) can
  get exclusive cores which a Burstable production pod never gets. A comparison lab copies the deployment's limits and
  thread caps together. [seen] A quota without the deployment's thread caps had the reference throttled in 95% of its
  periods and ten times slower.
- Under a CPU quota set the thread count explicitly to the quota, and record the throttling counters per run, on both
  sides. A reference that runs in production without a quota, measured in a pod with one, is a stated difference.
- A step that was not set up as a timing is not one: a byte gate that also prints a throughput measures neither side
  unless it ran under the timing conditions. [seen] A replay step in a pod ran under a CPU quota of eight without an
  explicit thread count (inferred: it took the count from the node's 192 visible CPUs); both sides were throttled in
  about a third of all periods, and the 0.994 between them meant nothing.
- Record per cell: load average, CPU time of other processes on the pinned CPUs, cgroup throttling counters
  (`cpu.stat` nr_throttled / throttled_usec) before and after each block.
- Do not start another measurement on the same cores. [seen] Two series overlapped and four launches had to be excluded.

**Reading the counters.** The same milliseconds can have two causes. [seen] An engine took about 330 ms per call in
three placements: pinned, because its threads waited for CPUs other work had taken; unpinned, because it burnt 17–25%
more CPU time for the same call. Read before and after every timed block, per thread of the process: on-CPU time and
runnable-but-waiting time (`/proc/<pid>/task/<tid>/schedstat`), voluntary and involuntary context switches, the kernel's
migration count where readable; for the container, `cpu.stat` (usage, periods, throttled periods and time). Signatures
([seen] on Linux with cgroup v2, one development host and one production-type node; the scheduler's reasons are inference):

| Counters per call | Reading |
|---|---|
| thousands of voluntary switches, hundreds of migrations, fewer physical cores in use than threads, CPU time up, no throttling | workers that block between hand-offs are re-placed at each wake-up and end up sharing cores |
| runnable-but-waiting time large, CPU time unchanged | the pinned set is contended by other work |
| throttled periods in a third of all periods, all threads running | a spinning pool has used up the quota |

## 4. Alternate, in rounds
- Each side in its own process, warmed up; within a round run blocks of each side in shuffled order with a short idle gap;
  at least 6–10 rounds for a 2% rule (30 on a loaded host).
- Compute the ratio per round, then report median, range or 95% interval, and the number of rounds above the threshold.
  A median just under the threshold with a third of the rounds above it is "undecided", not "pass".
- Compare only ratios from one alternation. [seen] Absolute latencies of both sides drifted ~10% over an evening on a VM.

## 5. Control: an identical binary
- Put a byte-identical copy of the base in as a candidate. **Pass:** candidate/base = 1.00 within about ±0.5%. Otherwise the
  harness favours a position or a process and every comparison below is suspect.
- [seen] The control gave 1.002 ± 0.003, which proved that a 2–3% difference elsewhere was in the code, not in the harness.

## 6. When noise is larger than the effect
- Say "no conclusion at X%" rather than picking the favourable round. [seen] Whole-run rounds spread 10–23% on a host with
  load average 21–133.
- Change the statistic and state its limits: for example a per-batch minimum over a fixed sample of batches with many
  repetitions, all sides interleaved ([seen] it resolved 0.5% where whole runs could not).
- Rounds added after seeing a result cannot settle a cell: the decision to add them was taken with the data in hand, even
  when all of them are reported honestly. When a planned series is undecided (spread larger than the margin, or a median
  below the threshold with an identifiable disturbance):
  1. Report the planned series as planned, with the verdict "undecided" or "fails", not a number that hides it.
  2. Report any rounds already added, all of them, in a separate row labelled as added after the fact, plus the row over
     everything.
  3. Write a new rule block (§1) for a confirmation series, with more rounds than the first, and run it.
  4. The verdict of the cell is the confirmation's, by its own rule.
- [seen] A cell planned with three rounds gave 0.937: two consecutive runs of one side were low while other processes
  held most of the pinned cores, and with two of three runs low the median is a disturbed run. Four added rounds made it
  0.999 over all seven; the requester did not accept that as settling the cell. Eight pre-registered rounds, none
  dropped, gave 0.9995.

## 7. Production-type and cross-vendor hardware decide
- A shared development host flatters whichever side suffers less from contention. [seen] The port passed at 1 thread on a
  loaded Intel host and failed on the production-type AMD node, because the reference slowed down more under load.
- [seen] The reverse: cells that failed or were undecided on a development host (1.25, 1.20) passed on the production
  node type with the unchanged engine (0.90, [0.88, 0.91]; 0.85) in ten of ten rounds, so a remedy that trades CPU for
  latency is judged there too, beside the unchanged code, and not on the development host's evidence alone.
- Gate on the node type production uses, at the thread or device count production uses; report other hosts as indicative.
- Record the processor model, flags and cache sizes, the cgroup quota, the THP mode, and the library versions on that node.

## 8. Bisecting a small regression
- One variable per candidate (base + one commit), all timed in one alternation with the control, on the hardware where the
  regression reproduces. [seen] It did not reproduce on the development host, and equal instruction counts there proved
  nothing about the other vendor.
- A profiler finding is a hypothesis until a candidate removes it. [seen] A real system-call hot spot was fixed and called the
  cause; on the target hardware the candidate carrying the fix was still slower, and the candidate with only the suspected
  commit was not.
- Stop at the deadline and report what is separated and what is not.

## 9. Provenance table per rule cell
For every cell of the rule: hardware, threads/devices, binary SHA-256 and commit, rounds, median ratio, range, pass/fail.
Cells measured with an earlier binary are labelled with that binary, not dropped and not silently reassigned to the head.
The final head is timed at least on every gating cell. [seen] The committed head had not itself been timed, and a dedicated
run was added. Separately, cells were wrongly reported to the owner as "not measured" when an earlier binary had measured them.

## Never
- Compare milliseconds from different runs or hosts.
- Accept a pass from a loaded development host as the verdict for production hardware.
- Time a configuration that does not ship, or a commit other than the one you report.
- Start a timed series before its rule is in the report, or edit the rule after the first run.
- Let rounds chosen after seeing the data decide a cell.
- Report a ratio without saying whether the CPUs were exclusive cores or a quota over shared ones.
