# Provisional belief-framing playbook and bookkeeping

A portable [playbook bundle](joint-belief-framing/SKILL.md) plus a stdlib Python
checker/projector. Based on the [proposed methodology](../../docs/drafts/20261102-1947-llm-epistemics/belief-network-methodology.md),
not a completed human acceptance trial or evidence of reduced overload.

The bundle is deliberately outside automatic skill discovery. No global/project
settings, Nix package, service or installed skill is changed. Read the playbook
explicitly when using it; copying/registering it later is a separate action.

## Quick start

From the repository root, with Python 3.11+:

```bash
mkdir -p .local/belief-demo
tool=scripts/belief-workflow/joint-belief-framing/scripts/bookkeeping.py
example=scripts/belief-workflow/joint-belief-framing/examples/minimal.json
python3 "$tool" snapshot "$example" > .local/belief-demo/sealed.json
python3 "$tool" check .local/belief-demo/sealed.json
python3 "$tool" render .local/belief-demo/sealed.json > .local/belief-demo/current.md
python3 "$tool" diff .local/belief-demo/sealed.json .local/belief-demo/sealed.json
```

Use a new output path, never redirect onto an input. Commands only read their
explicit inputs and print results. They neither keep a store nor execute/follow
artifact references. See the complete [format/command contract](joint-belief-framing/references/format.md).

The synthetic example records a partial approval and an unsolicited instruction.
It does not claim approval of the entire proposal, an authenticated human actor,
or a successful delivered system.

## What to use it for

1. Retain exact source/proposal text and explicitly attributed interpretations.
2. Add new revisions rather than overwrite sources or claims.
3. Select current claim/dependency revisions and render a view without duplicating
   current text manually across documents.
4. Compare with a separately retained prior snapshot to catch accidental history
   edits; inspect changed selections and evidence that no longer matches them.
5. Keep semantic interpretation, unresolved choices and actual authorization in
   the human/agent workflow. Do not ask the tool to settle them.

All `by` labels and dispositions are declarations. Record-integrity success does
not authenticate input, ratify intent, prove faithful paraphrase, verify a report
or imply that a broad goal is supported. A source marked “answered” is not thereby
semantically resolved. There is no attention/overload score, timer or proxy metric.

## Validation

```bash
python3 -m unittest discover -s scripts/belief-workflow/tests -v
```

Tests exercise batch CLI contracts against real temporary files/processes. They
are Specified-origin software checks, not tests of human intent fidelity or
cognitive burden. No database/store interface is introduced merely to test it.

## Limits

- Cooperative editable files, not an exclusive authority ledger or security boundary.
- No semantic approval parser, conflict resolver, automatic goal support or execution gate.
- No artifact collector, report runner, graph UI, deployment, global installation or game code.
- Version 1 only; explicit 4 MiB input bound, no silent truncation.
- An internally consistent lie or two jointly rewritten snapshots can pass.
- No user private acceptance cases are bundled or needed.
