# manure

Human/agent file & directory hosting behind `artifacts.7mind.io`.

This directory currently holds the **frozen contract only**
(`CONTRACT.md` + packaging skeleton). Implementation lands per the
ownership table in `CONTRACT.md §1`:

- server agent: `manure/manure/server.py`, `domain.py`, `storage.py`,
  `auth.py`, `tests/test_server_*`, `tests/test_storage_*`
- client agent: `manure/manure/client.py`, `cli.py`, `mcp.py`,
  `tests/test_client_*`, `test_cli_*`, `test_mcp_*`, `skill/SKILL.md`
- UI/security agent: `manure/web/*`, `tests/test_browser_*`
- Nix agent: `nix/nixos/manure.nix`, `nix/hm/manure.nix`,
  `nix/pkg/manure/package.nix`, root flake edits

Runtime: Python ≥3.12 stdlib only. See `CONTRACT.md` (normative).
