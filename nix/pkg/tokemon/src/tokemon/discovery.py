"""Walk yolo profile namespaces and pi agent dirs into a flat list of targets.

Layout facts (from the yolo launcher): a named yolo profile ``NAME`` backs each
agent's config with ``~/.config/yolo/NAME/<agent>/`` bound onto the agent's
standard in-sandbox home path.  For codex that means
``~/.config/yolo/NAME/codex/home`` replaces ``~/.codex``; for pi
``~/.config/yolo/NAME/pi/home`` replaces ``~/.pi``; for claude
``~/.config/yolo/NAME/claude/home`` replaces ``~/.claude``.  The default
profile uses the real ``~/.codex`` / ``~/.pi`` / ``~/.claude`` directories.

Claude Code on Linux stores its OAuth token in ``~/.claude/.credentials.json``
(macOS uses the login keychain instead, which is not read here).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from tokemon.credentials import (
    Credential,
    CredentialError,
    CredentialKind,
    credential_from_claude_oauth,
    credential_from_env_api_key,
    credential_from_pi_entry,
)

CODEX_DIR_NAME = ".codex"
CLAUDE_DIR_NAME = ".claude"
CLAUDE_CREDENTIALS_FILE = ".credentials.json"
PI_DIR_NAME = ".pi"
YOLO_CONFIG_ROOT = Path(".config") / "yolo"

DEFAULT_PROFILE = "default"

# Environment variables pi resolves API keys from, mapped to pi provider ids
# (see pi docs/providers.md).  Only providers with a plausible quota/plan
# surface are listed; the walk is about tracked credentials, not every env var.
ENV_PROVIDER_KEYS: Mapping[str, str] = {
    "OPENROUTER_API_KEY": "openrouter",
    "AI_GATEWAY_API_KEY": "vercel-ai-gateway",
    "COPILOT_GITHUB_TOKEN": "github-copilot",
    "KIMI_API_KEY": "kimi-coding",
    "MINIMAX_API_KEY": "minimax",
    "MINIMAX_CN_API_KEY": "minimax-cn",
    "XAI_API_KEY": "xai",
    "ZAI_API_KEY": "zai",
    "ZAI_CODING_CN_API_KEY": "zai-coding-cn",
    "XIAOMI_API_KEY": "xiaomi",
    "XIAOMI_TOKEN_PLAN_CN_API_KEY": "xiaomi-token-plan-cn",
    "XIAOMI_TOKEN_PLAN_AMS_API_KEY": "xiaomi-token-plan-ams",
    "XIAOMI_TOKEN_PLAN_SGP_API_KEY": "xiaomi-token-plan-sgp",
    "QWEN_TOKEN_PLAN_API_KEY": "qwen-token-plan",
    "QWEN_TOKEN_PLAN_CN_API_KEY": "qwen-token-plan-cn",
}


@dataclass(frozen=True)
class Target:
    profile: str
    source: str  # "codex" | "claude" | "pi" | "env"
    provider: str
    label: str
    credential: Credential | None
    note: str | None


class DiscoveryError(ValueError):
    """A config location exists but violates an expected invariant."""


def _read_json(path: Path) -> Mapping[str, Any] | None:
    if not path.is_file():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DiscoveryError(f"{path}: unreadable JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise DiscoveryError(f"{path}: expected a JSON object")
    return parsed


def _shorten(path: Path, home: Path) -> str:
    try:
        return "~/" + path.relative_to(home).as_posix()
    except ValueError:
        return path.as_posix()


def _codex_targets(codex_home: Path, profile: str, home: Path) -> list[Target]:
    auth = _read_json(codex_home / "auth.json")
    if auth is None:
        return []
    label = _shorten(codex_home, home)
    tokens = auth.get("tokens")
    if isinstance(tokens, dict) and isinstance(tokens.get("access_token"), str) and tokens["access_token"]:
        account_id = tokens.get("account_id")
        credential = Credential(
            kind=CredentialKind.OAUTH,
            secret=tokens["access_token"],
            refresh_token=None,
            account_id=account_id if isinstance(account_id, str) else None,
            expires_at=None,
        )
        return [Target(profile, "codex", "openai-codex", label, credential, None)]
    api_key = auth.get("OPENAI_API_KEY")
    if isinstance(api_key, str) and api_key:
        credential = credential_from_env_api_key("openai-api-key", api_key)
        return [Target(profile, "codex", "openai-api-key", label, credential, None)]
    return [Target(profile, "codex", "openai-codex", label, None, "codex auth.json has no usable credential")]


def _claude_targets(claude_home: Path, profile: str, home: Path) -> list[Target]:
    credentials = _read_json(claude_home / CLAUDE_CREDENTIALS_FILE)
    if credentials is None:
        return []
    label = _shorten(claude_home, home)
    oauth = credentials.get("claudeAiOauth")
    if not isinstance(oauth, dict):
        return [Target(profile, "claude", "anthropic", label, None, "claude .credentials.json has no claudeAiOauth")]
    try:
        credential = credential_from_claude_oauth(oauth)
    except CredentialError as exc:
        return [Target(profile, "claude", "anthropic", label, None, str(exc))]
    return [Target(profile, "claude", "anthropic", label, credential, None)]


def _pi_targets(pi_root: Path, profile: str, home: Path) -> list[Target]:
    targets: list[Target] = []
    for agent_dir in sorted(pi_root.iterdir()) if pi_root.is_dir() else []:
        if not agent_dir.is_dir():
            continue
        auth = _read_json(agent_dir / "auth.json")
        models = _read_json(agent_dir / "models.json")
        label = _shorten(agent_dir, home)
        if auth is not None:
            for provider_id in sorted(auth.keys()):
                entry = auth[provider_id]
                if not isinstance(entry, dict):
                    raise DiscoveryError(f"{agent_dir / 'auth.json'}: entry {provider_id!r} is not an object")
                try:
                    credential = credential_from_pi_entry(provider_id, entry)
                except CredentialError as exc:
                    targets.append(Target(profile, "pi", provider_id, label, None, str(exc)))
                    continue
                targets.append(Target(profile, "pi", provider_id, label, credential, None))
        if models is not None:
            providers = models.get("providers")
            if isinstance(providers, dict):
                for provider_id in sorted(providers.keys()):
                    if auth is not None and provider_id in auth:
                        continue
                    targets.append(
                        Target(profile, "pi", provider_id, label, None, "models.json provider without stored credential")
                    )
    return targets


def _env_targets(environ: Mapping[str, str], seen_secrets: frozenset[str]) -> list[Target]:
    targets: list[Target] = []
    for env_name, provider_id in sorted(ENV_PROVIDER_KEYS.items()):
        key = environ.get(env_name)
        if not key or key in seen_secrets:
            continue
        targets.append(
            Target(DEFAULT_PROFILE, "env", provider_id, env_name, credential_from_env_api_key(provider_id, key), None)
        )
    return targets


def join_unique(previous: str, addition: str) -> str:
    parts = list(dict.fromkeys([*previous.split(", "), *addition.split(", ")]))
    return ", ".join(parts)


def _merge_identical_credentials(targets: list[Target]) -> list[Target]:
    """Collapse byte-identical credentials (e.g. duplicated pi agent dirs) into
    one row per (provider, credential), joining their profile/label locations.
    Distinct secrets stay distinct rows even for the same provider."""
    merged: dict[tuple[str, str | None, str | None], Target] = {}
    for target in targets:
        kind = target.credential.kind.value if target.credential is not None else None
        secret = target.credential.secret if target.credential is not None else None
        key = (target.provider, kind, secret)
        previous = merged.get(key)
        if previous is None:
            merged[key] = target
            continue
        merged[key] = Target(
            profile=join_unique(previous.profile, target.profile),
            source=join_unique(previous.source, target.source),
            provider=target.provider,
            label=f"{previous.label}, {target.label}",
            credential=previous.credential,
            note=previous.note if previous.note is not None else target.note,
        )
    return list(merged.values())


def discover_targets(home: Path, environ: Mapping[str, str]) -> list[Target]:
    """Enumerate every codex/claude identity and pi provider credential to query."""
    targets: list[Target] = []

    codex_homes: list[tuple[str, Path]] = [(DEFAULT_PROFILE, home / CODEX_DIR_NAME)]
    claude_homes: list[tuple[str, Path]] = [(DEFAULT_PROFILE, home / CLAUDE_DIR_NAME)]
    pi_roots: list[tuple[str, Path]] = [(DEFAULT_PROFILE, home / PI_DIR_NAME)]
    yolo_root = home / YOLO_CONFIG_ROOT
    if yolo_root.is_dir():
        for profile_dir in sorted(yolo_root.iterdir()):
            if not profile_dir.is_dir() or profile_dir.name in (".", ".."):
                continue
            codex_homes.append((profile_dir.name, profile_dir / "codex" / "home"))
            claude_homes.append((profile_dir.name, profile_dir / "claude" / "home"))
            pi_roots.append((profile_dir.name, profile_dir / "pi" / "home"))

    for profile, codex_home in codex_homes:
        targets.extend(_codex_targets(codex_home, profile, home))
    for profile, claude_home in claude_homes:
        targets.extend(_claude_targets(claude_home, profile, home))
    for profile, pi_root in pi_roots:
        targets.extend(_pi_targets(pi_root, profile, home))

    seen_secrets = frozenset(t.credential.secret for t in targets if t.credential is not None)
    targets.extend(_env_targets(environ, seen_secrets))
    return _merge_identical_credentials(targets)
