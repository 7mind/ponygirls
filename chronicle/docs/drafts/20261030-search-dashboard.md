# Search dashboard

Search is a separate dashboard tab. Archive remains the default browsing table and keeps its expression filters and state.

1. Choose Lexical, Semantic or Hybrid, optionally enter exact project/tag and inclusive UTC-day filters, then submit. These filters are not Archive expressions. Editing a field clears the previous results; it does not execute another search.
2. Search returns ten conversations per page through the existing retrieval API. Exact-match counts and bounded candidate-window counts are labeled differently; a candidate count is not a corpus total.
3. Cards distinguish generated annotations from original source excerpts. Excerpts retain each original message's role, identity and half-open UTF-8 byte range; distinct messages are never joined into a quotation. Highlighting identifies the retrieved span, not a newly inferred answer.
4. Earlier/Later context replaces the bounded excerpt page using the returned continuation and the same revision/generation. Each directional expansion requests at most 2048 bytes. Initial excerpts retain the complete matched anchor up to 2048 bytes and request 512 additional bytes. Larger historical spans are explicitly partial previews.
5. Open a title or excerpt to locate and highlight its original message in the exact pinned conversation. No current-HEAD fallback is used. Escape closes the conversation and returns focus to its result button.

A page initially previews at most two retrieval pieces per conversation. Other source spans require explicit selection. Search state is cleared when leaving the tab or changing transport/security scope; Archive state is unaffected.

Denied, retired or invalid pinned reads produce an explicit unavailable state rather than substituted source. Current nested Find failures also invalidate Search source, and a failed card read clears an open conversation only when its session and view match. Stale responses cannot replace a newer scope. Unnotified authorization changes are learned on the next read; this adds no permission polling.

This view adds no index, ranking policy, API version, relevance guarantee or source normalization. MCP text presentation is a separate opt-in described in [MCP text presentation](20261030-mcp-text-presentation.md); JSON remains its default.
