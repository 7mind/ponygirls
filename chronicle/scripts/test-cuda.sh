#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../tests"
if [[ ${CHRONICLE_CUDA:-0} != 1 ]]; then
  echo 'SKIP: opt-in real CUDA validation; set CHRONICLE_CUDA=1 and provision the documented local endpoints.'
  exit 0
fi
: "${CHRONICLE_CUDA_MODELS:?set CHRONICLE_CUDA_MODELS to the local pinned model configuration JSON}"
: "${PG_BIN:?set PG_BIN to PostgreSQL with pgvector}"
: "${CHRONICLE_SERVER_COMMAND:?set CHRONICLE_SERVER_COMMAND to a JSON native executable command array}"
node --import tsx --test --test-concurrency=1 cuda/endpoints.test.ts cuda/native.test.ts
