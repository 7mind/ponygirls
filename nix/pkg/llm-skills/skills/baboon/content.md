# Baboon Data Model Compiler

[Baboon](https://github.com/7mind/baboon) is a data model compiler with reliable automatic conversion derivation.

## When this applies (read first)

Baboon is an **opt-in** toolchain, not a default way to model data. Apply this skill only when one of these holds:

- **The project already uses baboon** — there are `.baboon` model files, or baboon is wired into the build/codegen. Confirm this (e.g. look for `.baboon` files) before acting.
- **The user explicitly scoped the work to baboon** — designing a *greenfield* API on baboon, or a migration they asked for.

Do **not** introduce baboon into a project that has no baboon models just because a task touches an external API, adds a field, changes a type, or needs a database migration — use the project's existing modelling approach. Migrating an existing project onto baboon is a decision for the user: you may **propose** it, but do not start a migration on your own — act only on the user's explicit go-ahead.

Once baboon is confirmed to be in use (or chosen), establish the compatibility contract before choosing an evolution strategy: identify independently deployed consumers, rolling-upgrade/coexistence requirements, persisted wire payloads and retention promises. When multiple wire versions are required, create a new version of the baboon domain according to these guidelines and rely on its conversion facilities rather than implementing things manually. Do not infer a multi-version promise merely from use of Baboon.

## Model structure

Each `.baboon` file declares a model namespace and version:

```baboon
model my.api
version "0.2.0"
```

Types: `data` (product), `adt` (sum/union), `enum`, `root data/adt/service` (top-level wire types).
Primitives: `str`, `uid`, `i32`, `i64`, `f64`, `bit`, `tsu` (timestamp), `opt[T]`, `lst[T]`, `map[K,V]`, `bytes`.

## Multi-version evolution

Each version lives in its own `.baboon` file in the models directory. The compiler reads all files via `--model-dir`.

A new version imports unchanged types from the previous version and redefines only what changed:

```baboon
model my.api
version "0.2.0"

import "0.1.0" { * } without { Task TaskService }

data Task {
  id: uid            // <-- new field
  description: str
  scores: map[str, i32]
}

root service TaskService {
  // full service redefinition with new/changed methods
}
```

The `without` clause excludes types/services that are redefined in this version. Everything else is inherited as-is.

## Code generation

Build scripts use `--model-dir` (not `--model`) to pick up all version files:

```
baboon --model-dir models \
  :<language> --output <output-dir> \
  --omit-most-recent-version-suffix-from-paths \
  --omit-most-recent-version-suffix-from-namespaces \
  --generate-ueba-codecs=true \
  --generate-ueba-codecs-by-default=true
```

Key flags:
- `--omit-most-recent-version-suffix-from-paths` / `--omit-most-recent-version-suffix-from-namespaces` — the latest version's generated code lives at the same paths as before (no version suffix), so existing imports don't break. Older versions get versioned subdirectories (e.g. `v0_1_0/`).
- `--generate-ueba-codecs=true` — binary codecs used for transport.
- Each language target has its own flags (e.g. TypeScript: `--ts-async-services`, `--ts-maps-as-records`; Kotlin has its own set).

## Conversions (migrations at the codec level)

Baboon auto-derives conversions between versions. When it can't (e.g. a new required field with no default), it emits a stub that must be implemented manually.

**Important**: The code generation step typically wipes the output directory before regenerating. Custom conversion implementations placed in generated files will be lost. Either:
1. Re-apply them after each regeneration (if rare), or
2. Move them to a non-generated directory and wire them in.

For cross-version type references in conversions, use the auto-derived converters for nested types rather than passing the old type directly.

## Database migrations

Baboon conversions handle the **wire protocol** (client-server UEBA encoding). If the application persists data, the **database** requires a separate migration.

When adding new required fields to stored types:
1. Add a database migration that iterates over affected records and backfills the new field.
2. Add defensive fallbacks in serialization code so data without the field doesn't crash before the migration runs.

## Backward compatibility

Retention follows the verified compatibility and rollout contract, not compiler capability alone.

- Preserve old codecs/handlers when external or independently deployed consumers, rolling upgrades, or a promised support window require them. Use generated conversions and test each supported workflow and rejection boundary.
- A single deployment with all consumers owned and co-deployed may use one self-contained current schema when the user explicitly chooses that policy. Do not create additional API versions automatically. Keep explicit unsupported-version rejection where a wire version is negotiated; never silently reinterpret old payloads as current.
- Wire retention, database migration and persisted data are separate boundaries. Removing old API codecs does not authorize deleting historical data or changing persisted shapes.
- Do not collapse an already-promised public API merely because only one consumer is currently observed. If ownership, rollout or persistence constraints are unknown, ask before choosing retention or removal.

## Version negotiation

Every Baboon-based service should expose a **version check API** (e.g. a `getVersionInfo` or `getSupportedVersions` method on a root service) that returns:
- The current (latest) API version supported by the server.
- The minimum API version still supported.

Clients use this to detect when their version is outdated and prompt the user to update. When designing a new service or adding a version bump, always verify that such a version check endpoint exists and is kept up to date.

## Checklist for model changes

First establish the compatibility/rollout/persistence policy above. The version-copying steps below apply only when retained wire versions are required; for an explicitly chosen single-current deployment, edit the sole schema in place and still complete regeneration, domain mapping and behavioral validation.

1. Copy the current model file as `<name>-<old-version>.baboon` — preserves the old version for evolution.
2. Update the main model file — bump version, add `import "<old>" { * } without { ... }`, redefine changed types/services.
3. Regenerate code for all target languages.
4. Implement any conversion stubs Baboon couldn't auto-derive.
5. Update hand-written domain types that mirror Baboon types.
6. Update server-side converters between domain interfaces and Baboon classes.
7. Add a database migration for existing stored data if applicable.
8. Update server service logic and handler wiring.
9. Update client code — repositories, view models, UI.
