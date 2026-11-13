# OpenAI Fast mode controls

Default ON. Existing `/fast on` and `/fast off` continue to change the **global**
preference, including the existing malformed-file repair behavior.

`/fast settings` opens the shared staged dialog. Explicit
`/fast session on|off|inherit`, `/fast project on|off|inherit` and
`/fast global on|off|inherit` select a scope; `/fast status` reports value and source.

Precedence: session → trusted project → global → builtin ON. Global preferences
are `<agentDir>/openai-fast.json` (legacy v1 reads, sparse v2 writes); project
preferences are `<cwd>/.pi/openai-fast.json` (sparse v1). Untrusted project settings
are ignored and cannot be edited through the controls. Session overrides belong
to the native session ID, not copied parent/fork history.

In the dialog, Tab selects scope, Space stages a toggle, `r` stages inheritance,
Ctrl-S applies that scope, and Esc cancels unsaved drafts. Settings affect future
eligible requests; they do not modify requests already sent or guarantee that a
provider will deliver a requested service tier. Request/response handling remains
provider-specific.
