"""Adapter registry: pi provider id -> quota adapter."""

from __future__ import annotations

from tokemon.adapters.claude import ClaudeQuota
from tokemon.adapters.codex import CodexQuota
from tokemon.adapters.copilot import CopilotQuota
from tokemon.adapters.kimi import KimiQuota
from tokemon.adapters.minimax import MinimaxQuota
from tokemon.adapters.openrouter import OpenRouterQuota
from tokemon.adapters.zai import ZaiQuota
from tokemon.quota import NoQuotaEndpoint, QuotaAdapter

_DEFAULT_ADAPTER = NoQuotaEndpoint()

_ADAPTERS: dict[str, QuotaAdapter] = {
    "anthropic": ClaudeQuota(),
    "openai-codex": CodexQuota(),
    "github-copilot": CopilotQuota(),
    "kimi-coding": KimiQuota(),
    "minimax": MinimaxQuota(),
    "openrouter": OpenRouterQuota(),
    "zai": ZaiQuota(),
}


def adapter_for(provider_id: str) -> QuotaAdapter:
    return _ADAPTERS.get(provider_id, _DEFAULT_ADAPTER)
