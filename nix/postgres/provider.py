#!/usr/bin/env python3
"""Owned-cluster provisioning only; no legacy cluster adoption or rotation.
Credentials never appear in argv, output, Nix store or diagnostic SQL.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess
import sys
import time


class ProviderError(Exception):
    pass


def private_secret(path, create=False):
    path = Path(path)
    if create and not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as out:
            out.write(secrets.token_urlsafe(48).encode() + b'\n')
            out.flush()
            os.fsync(out.fileno())
        directory = os.open(path.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    # Explicit operator credential paths may be agenix-managed symlinks.
    # Validate the opened target, not the symlink inode.
    fd = os.open(path, os.O_RDONLY)
    with os.fdopen(fd, 'rb') as inp:
        mode = os.fstat(inp.fileno())
        if not stat.S_ISREG(mode.st_mode) or mode.st_mode & 0o077:
            raise ProviderError('credential must be a private regular file')
        raw = inp.read(4097)
    value = raw.removesuffix(b'\n')
    if not value or len(raw) > 4096 or b'\n' in value or b'\r' in value or b'\0' in value:
        raise ProviderError('credential must be nonempty bounded single-line UTF8')
    return value.decode('utf-8', errors='strict')


def verifier(password):
    # Generated passwords are ASCII; externally provisioned passwords must use
    # PostgreSQL-compatible SASLprep. Reject non-ASCII rather than derive an
    # incompatible verifier silently (runtime may still use non-ASCII externally).
    if not password.isascii():
        raise ProviderError('provider-created SCRAM passwords must be ASCII')
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 4096)
    client = hmac.digest(salted, b'Client Key', 'sha256')
    stored = hashlib.sha256(client).digest()
    server = hmac.digest(salted, b'Server Key', 'sha256')
    b64 = lambda value: base64.b64encode(value).decode('ascii')
    return f'SCRAM-SHA-256$4096:{b64(salt)}${b64(stored)}:{b64(server)}'


def sql(cfg, database, source, env=None):
    result = subprocess.run([cfg['postgresBin'] + '/psql', '-X', '-w', '-qAt',
        '-v', 'ON_ERROR_STOP=1', '-h', cfg['stateDirectory'] + '/socket',
        '-p', str(cfg['port']), '-U', cfg['adminRole'], '-d', database],
        input=source, text=True, capture_output=True, timeout=90,
        env={**os.environ, 'PGCONNECT_TIMEOUT': '5', **(env or {})})
    if result.returncode:
        # psql/server errors can contain SQL or credential material. Never print.
        raise ProviderError('database provisioning command failed (details suppressed)')
    return result.stdout.strip()


def initialize(cfg):
    root = Path(cfg['stateDirectory'])
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.is_symlink() or root.stat().st_mode & 0o077:
        raise ProviderError('state root must be private and not a symlink')
    data = root / 'data'
    marker = root / 'ponygirls-provider-v1'
    if data.exists() and not marker.exists():
        raise ProviderError('refusing adoption of an unmarked cluster; use logical migration')
    if marker.exists() and marker.read_text() != 'postgresql-18\n':
        raise ProviderError('unknown cluster ownership marker')
    (root / 'socket').mkdir(mode=0o700, exist_ok=True)
    (root / 'backups').mkdir(mode=0o700, exist_ok=True)
    if not data.exists():
        # Marker follows successful initdb. A crash leaves unmarked data and fails
        # closed; operator must inspect/discard the NEW disposable failed init.
        result = subprocess.run([cfg['postgresBin'] + '/initdb', '-D', str(data),
            '-U', cfg['adminRole'], '--auth-local=peer', '--auth-host=scram-sha-256',
            '--encoding=UTF8', '--locale=C.UTF-8'], capture_output=True, timeout=60)
        if result.returncode:
            raise ProviderError('initdb failed (details suppressed)')
        with marker.open('x') as out:
            out.write('postgresql-18\n')
    if (data / 'PG_VERSION').read_text().strip() != '18':
        raise ProviderError('cross-major state reuse forbidden; use logical migration')


def provision(cfg, key):
    d = cfg['databases'][key]
    name, role = d['name'], d['user']
    password = private_secret(os.environ.get('PONYGIRLS_PASSWORD_FILE', d['passwordFile']), d['createPassword'])
    for _ in range(60):
        try:
            sql(cfg, 'postgres', 'SELECT 1;')
            break
        except ProviderError:
            time.sleep(1)
    else:
        raise ProviderError('database readiness deadline exceeded')
    # Separate provisioners serialize role/database creation, without CREATE
    # DATABASE inside a transaction. Holding one session lock also spans \gexec.
    sql(cfg, 'postgres', f'''
SELECT pg_advisory_lock(70302618);
SELECT 1 / CASE WHEN EXISTS (SELECT FROM pg_roles WHERE rolname='{role}' AND
 (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR
 EXISTS (SELECT FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='{role}')))) THEN 0 ELSE 1 END;
\\getenv verifier PONYGIRLS_SCRAM
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', '{role}', :'verifier')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='{role}')\\gexec
ALTER ROLE "{role}" CONNECTION LIMIT {d['maxConnections']};
SELECT 'CREATE DATABASE "{name}"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='{name}')\\gexec
REVOKE ALL ON DATABASE "{name}" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE "{name}" TO "{role}";
REVOKE CONNECT ON DATABASE postgres, template1 FROM PUBLIC;
ALTER ROLE "{role}" IN DATABASE "{name}" SET statement_timeout = '{d['statementTimeoutMs']}ms';
ALTER ROLE "{role}" IN DATABASE "{name}" SET lock_timeout = '{d['lockTimeoutMs']}ms';
ALTER ROLE "{role}" IN DATABASE "{name}" SET idle_in_transaction_session_timeout = '{d['idleTransactionTimeoutMs']}ms';
ALTER ROLE "{role}" IN DATABASE "{name}" SET work_mem = '{d['workMem']}';
SELECT pg_advisory_unlock(70302618);
''', {'PONYGIRLS_SCRAM': verifier(password)})
    sql(cfg, name, f'''
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO "{role}";
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
''')
    # Authenticate with the supplied file, detecting an accidental replacement
    # without rotating the existing DB role. No password in argv or diagnostics.
    result = subprocess.run([cfg['postgresBin'] + '/psql', '-X', '-w', '-qAt',
        '-h', '127.0.0.1', '-p', str(cfg['port']), '-U', role, '-d', name,
        '-c', 'SELECT 1'], capture_output=True, timeout=10,
        env={**os.environ, 'PGCONNECT_TIMEOUT': '5', 'PGPASSWORD': password})
    if result.returncode or result.stdout.strip() != b'1':
        raise ProviderError('runtime authentication failed; existing role password was NOT rotated')


def main():
    os.umask(0o077)
    command, manifest, *args = sys.argv[1:]
    cfg = json.loads(Path(manifest).read_text())
    if command == 'init':
        initialize(cfg)
    elif command == 'provision':
        provision(cfg, args[0])
    else:
        raise ProviderError('unknown provider command')


if __name__ == '__main__':
    try:
        main()
    except (ProviderError, OSError, ValueError, subprocess.TimeoutExpired, KeyError):
        print('shared PostgreSQL provider failed; no credentials or SQL logged', file=sys.stderr)
        sys.exit(1)
