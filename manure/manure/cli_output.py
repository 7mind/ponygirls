"""Human presentation of client-local results; never used by JSON or MCP."""
from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


Access = Literal['internal', 'external', 'public']
SIZE_BASE = 1024
SIZE_UNITS = ('B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB')


class Identity(TypedDict):
    user_id: str
    type: str
    token_id: str


class Metadata(TypedDict):
    tags: list[str]
    hostname: str | None
    project_path: str | None


class Artifact(Metadata):
    artifact_id: str
    name: str
    visibility: Access
    state: str
    kind: Literal['file', 'dir']
    total_bytes: int
    file_count: int
    content_url: str
    created_by_user: str
    created_at: str
    expires_at: str | None


class Catalogue(TypedDict):
    artifacts: list[Artifact]
    next_cursor: str | None


class UploadReceipt(Metadata):
    artifact_id: str
    content_url: str
    access: Access
    expires_at: str | None
    external_password: NotRequired[str | None]
    password_note: NotRequired[str]


class FetchReceipt(TypedDict):
    artifact_id: str
    dest: str
    file_count: int
    total_bytes: int


class PasswordReceipt(TypedDict):
    external_password: str


def terminal_text(value: str) -> str:
    # Keep untrusted names/metadata inert, including C1 and bidi controls.
    return ''.join('\\\\' if char == '\\' else char if char.isprintable()
                   else char.encode('unicode_escape').decode('ascii') for char in value)


def compact_size(size: int) -> str:
    scaled = float(size)
    for unit in SIZE_UNITS:
        if scaled < SIZE_BASE or unit == SIZE_UNITS[-1]:
            return f'{size} B' if unit == 'B' else f'{scaled:.1f} {unit}'
        scaled /= SIZE_BASE
    raise AssertionError('size unit not selected')


def full_size(size: int) -> str:
    exact = f'{size} byte' + ('' if size == 1 else 's')
    return exact if size < SIZE_BASE else f'{compact_size(size)} ({exact})'


def access_label(access: Access) -> str:
    meanings = {'internal': 'authenticated readers only',
                'external': 'password required', 'public': 'anyone with the link'}
    return f'{access} ({meanings[access]})'


def metadata_lines(metadata: Metadata) -> list[str]:
    lines = ['Tags:'] if metadata['tags'] else ['Tags: none']
    lines += ['  - ' + terminal_text(tag) for tag in metadata['tags']]
    if metadata['hostname'] is not None:
        lines.append('Hostname: ' + terminal_text(metadata['hostname']))
    if metadata['project_path'] is not None:
        lines.append('Project: ' + terminal_text(metadata['project_path']))
    return lines


def identity(result: Identity) -> str:
    return '\n'.join(['User: ' + terminal_text(result['user_id']),
                      'Type: ' + terminal_text(result['type']),
                      'Token ID: ' + terminal_text(result['token_id'])])


def catalogue(result: Catalogue) -> str:
    artifacts = result['artifacts']
    if artifacts:
        rows = [('ID', 'ACCESS', 'STATE', 'SIZE', 'NAME')]
        rows += [(terminal_text(item['artifact_id']), terminal_text(item['visibility']),
                  terminal_text(item['state']), compact_size(item['total_bytes']),
                  terminal_text(item['name'])) for item in artifacts]
        widths = [max(len(row[column]) for row in rows) for column in range(len(rows[0]) - 1)]
        lines = ['  '.join(cell.rjust(widths[column]) if column == 3
                          else cell.ljust(widths[column]) if column < len(widths) else cell
                          for column, cell in enumerate(row)) for row in rows]
        lines += ['', f'{len(artifacts)} artifact' + ('' if len(artifacts) == 1 else 's')]
    else:
        lines = ['No artifacts found.']
    if result['next_cursor'] is not None:
        lines += ['', 'Next cursor: ' + terminal_text(result['next_cursor']),
                  'Pass --cursor with the same list options to continue.']
    return '\n'.join(lines)


def artifact(result: Artifact) -> str:
    return '\n'.join([
        terminal_text(result['name']),
        'ID: ' + terminal_text(result['artifact_id']),
        'URL: ' + terminal_text(result['content_url'] or 'unavailable'),
        'Access: ' + access_label(result['visibility']),
        'State: ' + terminal_text(result['state']),
        'Kind: ' + ('directory' if result['kind'] == 'dir' else 'file'),
        'Size: ' + full_size(result['total_bytes']),
        f"Files: {result['file_count']}",
        'Created by: ' + terminal_text(result['created_by_user']),
        'Created: ' + terminal_text(result['created_at']),
        'Expires: ' + terminal_text(result['expires_at'] if result['expires_at'] is not None else 'never'),
        *metadata_lines(result),
    ])


def uploaded(result: UploadReceipt) -> str:
    lines = [
        'Uploaded artifact ' + terminal_text(result['artifact_id']),
        'URL: ' + terminal_text(result['content_url'] or 'unavailable'),
        'Access: ' + access_label(result['access']),
        'Expires: ' + terminal_text(result['expires_at'] if result['expires_at'] is not None else 'never'),
        *metadata_lines(result),
    ]
    if result['access'] == 'external':
        password = result['external_password']
        if password is not None:
            lines.append('External password: ' + terminal_text(password))
        else:
            lines += ['External password: not returned on resume',
                      'Password note: ' + terminal_text(result['password_note'])]
    return '\n'.join(lines)


def fetched(result: FetchReceipt) -> str:
    return '\n'.join(['Fetched artifact ' + terminal_text(result['artifact_id']),
                      'Destination: ' + terminal_text(result['dest']),
                      f"Files: {result['file_count']}",
                      'Size: ' + full_size(result['total_bytes'])])


def deleted(artifact_id: str) -> str:
    return 'Deleted artifact ' + terminal_text(artifact_id) + '.'


def password_rotated(artifact_id: str, result: PasswordReceipt) -> str:
    return '\n'.join(['Rotated password for artifact ' + terminal_text(artifact_id),
                      'External password: ' + terminal_text(result['external_password']),
                      'Previous password and grants have been revoked.'])
