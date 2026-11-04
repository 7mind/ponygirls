#!/bin/sh
# Stub service binary for the OCI image checks: records its argv so entrypoint
# contracts can be asserted without building the real service closure.
printf '%s %s\n' "$(basename "$0")" "$*" >> "${STUB_LOG:?STUB_LOG must be set}"
