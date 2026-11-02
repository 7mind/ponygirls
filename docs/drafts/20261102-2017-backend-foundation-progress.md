# Unified backend foundation — execution log

## Scope and authority

User approved the next implementation slice and requested subagents/worktrees. Subsequent clarification: backward API/codec compatibility is unnecessary because there are no independent deployments. Target one current contract and coordinate owned client changes; do not build legacy adapters or retain historical wire versions. Persisted data, credential secrecy, authorization and durability remain correctness requirements. No live activation or database migration in this slice.

Base: `0ebe81ad49a4a0583216ecf1fdeb7f0bbbf95382` (main observed 2026-11-02). Unrelated epistemics documents committed since the planning baseline are preserved.

## Work allocation

All writers use separate precreated Git worktrees under the main checkout's ignored `.worktrees/`; harness `workspace_path` routing was denied, so children were explicitly restricted to their absolute assigned worktrees using `isolation:none`.

- Integration/docs/validation: `wt-ponygirls-backend-foundation`, branch `feature/backend-foundation`.
- Common sbt/Nix build: `wt-ponygirls-backend-build`, branch `feature/backend-build`, subagent `8091c0a3-6b1a-41c0-b6c0-8069c68a8bf3`.
- Lossless JSON boundary: `wt-ponygirls-lossless-json`, branch `feature/lossless-json`, subagent `d27a1c6a-37e0-4636-b570-acf3c2bd0eb5`.
- Manure filesystem feasibility: `wt-ponygirls-manure-filesystem`, branch `feature/manure-filesystem`, subagent `4c98d3c6-a6ce-48f4-a7c5-58ab41e4a513`.

Codegraph exploration again refused daemon PID-namespace ownership; direct source inspection is used.

## Verification goals

1. One active root multi-project sbt build, unchanged pinned dependencies, working Chronicle/package wrappers, Nix source/lock/validation wiring. Verify offline assembly, full affected suites and policy/module checks, not merely fast package checks.
2. A typed Scala lossless JSON module with explicit validation limits and behavioral tests. No binary floating-point rounding or legacy JavaScript digest requirement.
3. A narrowly scoped descriptor-safe Manure filesystem capability with real-filesystem tests and honest JVM/native capability evidence. Missing JDK primitives must be reported explicitly, never replaced by race-unsafe paths.
4. Integrate only verified task commits, review, commit on the integration branch, fast-forward safely into main, verify the integrated tree, remove only clean task worktrees.

## Execution evidence

Implementation and verification in progress. No test success, deployment or migration result claimed yet.
