#!/usr/bin/env bash
set -euo pipefail

# Validates skill meta.yaml files using yq.
# Usage: validate-skills.sh skills/*/meta.yaml

errors=0
max_description_chars=1024

for meta_file in "$@"; do
  skill_dir=$(dirname "$meta_file")
  echo "Validating: $meta_file"

  name=$(yq -r '.name // ""' "$meta_file")
  description=$(yq -r '.description // ""' "$meta_file")

  if [ -z "$name" ]; then
    echo "  ERROR: missing required 'name' field" >&2
    errors=$((errors + 1))
  elif [ "$name" != "$(basename "$skill_dir")" ]; then
    echo "  ERROR: name '$name' must match skill directory '$(basename "$skill_dir")'" >&2
    errors=$((errors + 1))
  fi

  if [ -z "$description" ]; then
    echo "  ERROR: missing required 'description' field" >&2
    errors=$((errors + 1))
  elif [ "$(yq -r '.description | split("") | length' "$meta_file")" -gt "$max_description_chars" ]; then
    # yq's string length counts bytes; splitting first counts Unicode characters,
    # including trailing newlines command substitution strips from $description.
    echo "  ERROR: description must not exceed $max_description_chars characters" >&2
    errors=$((errors + 1))
  fi

  content_file="$skill_dir/content.md"
  if [ ! -f "$content_file" ]; then
    echo "  ERROR: missing $content_file" >&2
    errors=$((errors + 1))
  elif [ ! -s "$content_file" ]; then
    echo "  ERROR: $content_file is empty" >&2
    errors=$((errors + 1))
  fi

  if [ "$errors" -eq 0 ]; then
    echo "  OK: name=\"$name\""
  fi
done

if [ "$errors" -gt 0 ]; then
  echo "Validation failed with $errors error(s)" >&2
  exit 1
fi

echo "All skill files validated successfully"
