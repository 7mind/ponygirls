"""Adapter registry: pi provider id -> quota adapter, and -> OAuth token endpoint."""

from __future__ import annotations

from typing import Mapping

from tokemon.adapters.claude import ClaudeQuota, ClaudeTokenEndpoint
from tokemon.adapters.codex import CodexQuota
from tokemon.adapters.copilot import CopilotQuota
from tokemon.adapters.kimi import KimiQuota, KimiTokenEndpoint
from tokemon.adapters.meta import MetaQuota, MetaTokenEndpoint
from tokemon.adapters.minimax import MinimaxQuota
from tokemon.adapters.openrouter import OpenRouterQuota
from tokemon.adapters.vercel import VercelGatewayQuota
from tokemon.adapters.xai import XaiManagementQuota, XaiQuota, XaiTokenEndpoint
from tokemon.adapters.zai import ZaiQuota
from tokemon.quota import NoQuotaEndpoint, QuotaAdapter
from tokemon.token_refresh import TokenEndpoint

_DEFAULT_ADAPTER = NoQuotaEndpoint()

_ADAPTERS: dict[str, QuotaAdapter] = {
    "anthropic": ClaudeQuota(),
    "openai-codex": CodexQuota(),
    "github-copilot": CopilotQuota(),
    "kimi-coding": KimiQuota(),
    "meta": MetaQuota(),
    "minimax": MinimaxQuota(),
    "openrouter": OpenRouterQuota(),
    "vercel-ai-gateway": VercelGatewayQuota(),
    "xai": XaiQuota(),
    "xai-management": XaiManagementQuota(),
    "zai": ZaiQuota(),
}

# Providers whose expired pi OAuth access token tokemon can refresh.
TOKEN_ENDPOINTS: Mapping[str, TokenEndpoint] = {
    "anthropic": ClaudeTokenEndpoint(),
    "kimi-coding": KimiTokenEndpoint(),
    "meta": MetaTokenEndpoint(),
    "xai": XaiTokenEndpoint(),
}


def adapter_for(provider_id: str) -> QuotaAdapter:
    return _ADAPTERS.get(provider_id, _DEFAULT_ADAPTER)


def has_quota_adapter(provider_id: str) -> bool:
    """True when this provider id has a quota surface tokemon can query."""
    return provider_id in _ADAPTERS
