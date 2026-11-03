#!/usr/bin/env python3
"""Owned-cluster provisioning only; no legacy cluster adoption or rotation.
Credentials never appear in argv, output, Nix store or diagnostic SQL.
"""
import base64
import hashlib
import hmac
import json
import os
import errno
import pwd
import re
import struct
from pathlib import Path
import secrets
import stat
import stringprep
import unicodedata
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
    resolved = path.resolve(strict=True)
    if not stat.S_ISREG(resolved.stat().st_mode):
        raise ProviderError('credential must be a regular file')
    fd = os.open(resolved, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as inp:
        mode = os.fstat(inp.fileno())
        if not stat.S_ISREG(mode.st_mode) or mode.st_mode & 0o077:
            raise ProviderError('credential must be a private regular file')
        raw = inp.read(4097)
    return decode_secret(raw)


def decode_secret(raw):
    value = raw.removesuffix(b'\n')
    if not value or len(raw) > 4096 or b'\n' in value or b'\r' in value or b'\0' in value:
        raise ProviderError('credential must be nonempty bounded single-line UTF8')
    return value.decode('utf-8', errors='strict')


class CredentialFilesystem:
    """Narrow descriptor/metadata port; the production adapter never stages bytes."""
    open = staticmethod(os.open)
    close = staticmethod(os.close)
    fstat = staticmethod(os.fstat)
    stat = staticmethod(os.stat)
    getxattr = staticmethod(os.getxattr)
    read = staticmethod(os.read)
    euid = staticmethod(os.geteuid)
    egid = staticmethod(os.getegid)
    service_identity = staticmethod(pwd.getpwnam)


def exact_uid_acl(raw, uid, permissions):
    # Linux POSIX ACL xattr version2; exactly owner, one named user, empty base
    # group, matching mask, empty other. Never treat the mask as a group grant.
    expected = [(1, permissions, 0xffffffff), (2, permissions, uid),
                (4, 0, 0xffffffff), (16, permissions, 0xffffffff), (32, 0, 0xffffffff)]
    return (len(raw) == 44 and struct.unpack('<I', raw[:4])[0] == 2
            and list(struct.iter_unpack('<HHI', raw[4:])) == expected)


def absent_acl(fs, fd, name):
    try:
        fs.getxattr(fd, name)
    except OSError as error:
        return error.errno == errno.ENODATA
    return False


def loaded_systemd_secret(cfg, key, fs, environment):
    """ONLY explicit NixOS provisioning context; ordinary files stay strict.

    The known systemd runtime root, expected unit/name, root-protected directory
    descriptors and exact UID ACLs establish trust, not caller environment alone.
    """
    if cfg['adminRole'] != 'postgres' or not re.fullmatch(r'[A-Za-z0-9_-]+', key):
        raise ProviderError('unsupported systemd credential context')
    identity = fs.service_identity('postgres')
    uid = fs.euid()
    if uid == 0 or uid != identity.pw_uid or fs.egid() != identity.pw_gid:
        raise ProviderError('unexpected systemd credential service identity')
    unit = 'ponygirls-database-' + key + '.service'
    directory = '/run/credentials/' + unit
    if (environment.get('CREDENTIALS_DIRECTORY') != directory or
            environment.get('PONYGIRLS_PASSWORD_FILE') != directory + '/database-password'):
        raise ProviderError('unexpected systemd credential reference')
    descriptors = []
    def directory_fd(name, parent, unit_directory):
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        before = fs.stat(name, dir_fd=parent, follow_symlinks=False)
        if not stat.S_ISDIR(before.st_mode):
            raise ProviderError('invalid protected credential ancestor')
        fd = fs.open(name, flags, dir_fd=parent); descriptors.append(fd)
        info = fs.fstat(fd)
        if ((before.st_dev, before.st_ino) != (info.st_dev, info.st_ino) or
                not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != 0 or
                stat.S_IMODE(info.st_mode) & 0o022 or not absent_acl(fs, fd, 'system.posix_acl_default')):
            raise ProviderError('invalid protected credential ancestor')
        if unit_directory:
            if stat.S_IMODE(info.st_mode) != 0o550 or not exact_uid_acl(fs.getxattr(fd, 'system.posix_acl_access'), uid, 5):
                raise ProviderError('invalid systemd credential directory ACL')
        elif not absent_acl(fs, fd, 'system.posix_acl_access'):
            raise ProviderError('unexpected protected ancestor ACL')
        return fd
    try:
        root = directory_fd('/', None, False)
        run = directory_fd('run', root, False)
        credential_root = directory_fd('credentials', run, False)
        bound = directory_fd(unit, credential_root, True)
        before = fs.stat('database-password', dir_fd=bound, follow_symlinks=False)
        if not stat.S_ISREG(before.st_mode):
            raise ProviderError('credential must be a regular file')
        fd = fs.open('database-password', os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=bound)
        descriptors.append(fd); info = fs.fstat(fd)
        if ((before.st_dev, before.st_ino) != (info.st_dev, info.st_ino) or
                not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != 0 or
                stat.S_IMODE(info.st_mode) != 0o440 or
                not absent_acl(fs, fd, 'system.posix_acl_default') or
                not exact_uid_acl(fs.getxattr(fd, 'system.posix_acl_access'), uid, 4)):
            raise ProviderError('invalid systemd credential file ACL')
        raw = bytearray()
        while len(raw) < 4097:
            chunk = fs.read(fd, 4097 - len(raw))
            if not chunk:
                break
            raw.extend(chunk)
        return decode_secret(bytes(raw))
    finally:
        for fd in reversed(descriptors):
            fs.close(fd)


def saslprep(password):
    """PostgreSQL/libpq RFC4013 Unicode3.2 preparation, raw UTF8 on failure.

    PostgreSQL deliberately falls back to the original bytes if SASLprep fails
    (prohibited/unassigned characters, bidi violations), rather than making an
    existing non-ASCII password unusable. Never substitute current Unicode data.
    """
    mapped = ''.join(' ' if stringprep.in_table_c12(c) else c
                     for c in password if not stringprep.in_table_b1(c))
    prepared = unicodedata.ucd_3_2_0.normalize('NFKC', mapped)
    prohibited = [stringprep.in_table_a1, stringprep.in_table_c12,
        stringprep.in_table_c21, stringprep.in_table_c22, stringprep.in_table_c3,
        stringprep.in_table_c4, stringprep.in_table_c5, stringprep.in_table_c6,
        stringprep.in_table_c7, stringprep.in_table_c8, stringprep.in_table_c9]
    if any(test(c) for c in prepared for test in prohibited):
        return password.encode('utf-8')
    if any(stringprep.in_table_d1(c) for c in prepared):
        if (any(stringprep.in_table_d2(c) for c in prepared)
                or not stringprep.in_table_d1(prepared[0])
                or not stringprep.in_table_d1(prepared[-1])):
            return password.encode('utf-8')
    return prepared.encode('utf-8')


def verifier(password):
    salt = secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac('sha256', saslprep(password), salt, 4096)
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


def provision(cfg, key, loaded_credential):
    d = cfg['databases'][key]
    name, role = d['name'], d['user']
    if loaded_credential and d['createPassword']:
        raise ProviderError('loaded credentials cannot create password files')
    password = loaded_systemd_secret(cfg, key, CredentialFilesystem(), os.environ) if loaded_credential else private_secret(os.environ.get('PONYGIRLS_PASSWORD_FILE', d['passwordFile']), d['createPassword'])
    deadline = time.monotonic() + 60
    while True:
        try:
            sql(cfg, 'postgres', 'SELECT 1;')
            break
        except ProviderError:
            if time.monotonic() >= deadline:
                raise ProviderError('database readiness deadline exceeded')
            time.sleep(1)
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
-- Server ERROR text itself can contain values, even with statement logging
-- disabled (invalid casts, constraints, parameter conversion). Suppress native
-- SQL diagnostics for application sessions; retain sanitized app telemetry and
-- unchanged admin/cluster diagnostics. These are privileged role defaults.
ALTER ROLE "{role}" SET log_min_messages = 'panic';
ALTER ROLE "{role}" SET log_min_error_statement = 'panic';
ALTER ROLE "{role}" SET log_statement = 'none';
ALTER ROLE "{role}" SET log_duration = 'off';
ALTER ROLE "{role}" SET log_min_duration_statement = '-1';
ALTER ROLE "{role}" SET log_min_duration_sample = '-1';
ALTER ROLE "{role}" SET log_parameter_max_length = '0';
ALTER ROLE "{role}" SET log_parameter_max_length_on_error = '0';
ALTER ROLE "{role}" CONNECTION LIMIT {d['maxConnections']};
SELECT 'CREATE DATABASE "{name}"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='{name}')\\gexec
REVOKE ALL ON DATABASE "{name}" FROM PUBLIC;
SELECT format('REVOKE ALL ON DATABASE %I FROM %I','{name}',rolname)
 FROM pg_roles WHERE rolname IN ({','.join("'"+other['user']+"'" for other in cfg['databases'].values())}) AND rolname <> '{role}'\\gexec
GRANT CONNECT, TEMPORARY ON DATABASE "{name}" TO "{role}";
REVOKE CONNECT ON DATABASE postgres, template1 FROM PUBLIC;
ALTER ROLE "{role}" IN DATABASE "{name}" SET statement_timeout = '{d['statementTimeoutMs']}ms';
ALTER ROLE "{role}" IN DATABASE "{name}" SET lock_timeout = '{d['lockTimeoutMs']}ms';
ALTER ROLE "{role}" IN DATABASE "{name}" SET idle_in_transaction_session_timeout = '{d['idleTransactionTimeoutMs']}ms';
ALTER ROLE "{role}" IN DATABASE "{name}" SET work_mem = '{d['workMem']}';
SELECT pg_advisory_unlock(70302618);
''', {'PONYGIRLS_SCRAM': verifier(password)})
    schemas = ''.join(f'CREATE SCHEMA IF NOT EXISTS "{schema}";\nREVOKE ALL ON SCHEMA "{schema}" FROM PUBLIC;\nGRANT USAGE, CREATE ON SCHEMA "{schema}" TO "{role}";\n' for schema in d['schemas'])
    sql(cfg, name, schemas + f'''
REVOKE ALL ON SCHEMA public FROM PUBLIC;
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
        if len(args) not in (1, 2) or (len(args) == 2 and args[1] != '--loaded-systemd-credential'):
            raise ProviderError('unknown provisioning credential policy')
        provision(cfg, args[0], len(args) == 2)
    else:
        raise ProviderError('unknown provider command')


if __name__ == '__main__':
    try:
        main()
    except (ProviderError, OSError, ValueError, RuntimeError, subprocess.TimeoutExpired, KeyError):
        print('shared PostgreSQL provider failed; no credentials or SQL logged', file=sys.stderr)
        sys.exit(1)
