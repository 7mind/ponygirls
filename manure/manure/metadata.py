"""Exact, optional artifact metadata: no host/cwd discovery or normalization."""
from __future__ import annotations

MAX_TAGS = 32
MAX_TAG_SCALARS = 128
MAX_HOSTNAME_SCALARS = 253
MAX_PROJECT_PATH_SCALARS = 4096
# ECMAScript whitespace, shared with the browser and expression tokenizer.
WHITESPACE = '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'


def validate_value(value: str, label: str, maximum: int) -> None:
    message = f'{label} must be nonblank and at most {maximum} Unicode scalar values.'
    if not isinstance(value, str) or not value.strip(WHITESPACE) or len(value) > maximum:
        raise ValueError(message)
    try:
        value.encode('utf-8')
    except UnicodeError:
        raise ValueError('Metadata must contain valid Unicode scalar values.') from None


def validate_metadata(tags: list[str], hostname: str | None, project_path: str | None) -> None:
    if not isinstance(tags, list):
        raise ValueError('Tags must be a string array.')
    if len(tags) > MAX_TAGS:
        raise ValueError('At most 32 tags are allowed.')
    seen: set[str] = set()
    for tag in tags:
        validate_value(tag, 'Tag', MAX_TAG_SCALARS)
        if tag in seen:
            raise ValueError('Duplicate tag; specify each tag once.')
        seen.add(tag)
    if hostname is not None:
        validate_value(hostname, 'Hostname', MAX_HOSTNAME_SCALARS)
    if project_path is not None:
        validate_value(project_path, 'Project path', MAX_PROJECT_PATH_SCALARS)
