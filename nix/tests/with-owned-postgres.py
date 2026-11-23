#!/usr/bin/env python3
"""Run a bounded test command against ONLY a new disposable provider cluster.
No connection argument accepted: fixtures can never select a live database.
Usage: with-owned-postgres.py [--child-timeout-seconds=N] [--data-root=DIR] COMMAND [ARG...]; the command is stopped
after N seconds (default CHILD_TIMEOUT_SECONDS, at most MAX_CHILD_TIMEOUT_SECONDS) with exit EXIT_TIMEOUT. --data-root
puts the cluster's data directory in a private directory under DIR (an absolute directory of this user), removed with the
cluster; its socket, configuration and secrets stay in the private directory under TMPDIR (short socket paths).
"""
import contextlib
import ctypes
import json
import os
from pathlib import Path
import pwd
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time

CHILD_TIMEOUT_SECONDS=3600
MAX_CHILD_TIMEOUT_SECONDS=86400
CHILD_TIMEOUT_OPTION='--child-timeout-seconds'
DATA_ROOT_OPTION='--data-root'
EXIT_USAGE=2
CHILD_STOP_SECONDS=15
POLL_SECONDS=0.1
EXIT_TIMEOUT=124
TERMINATION_SIGNALS=(signal.SIGTERM,signal.SIGINT)
PR_SET_CHILD_SUBREAPER=36
# The services' production-shaped maxConnections in the limits handed to the command: a fixed pool of 6, headroom 2.
SERVER_MAX_CONNECTIONS=8
# Production runs one process per service role (CONNECTION LIMIT = its maxConnections); fixture runs start up to this many
# service processes at once under one role (Manure's target suite: 8 shards of up to 2 servers; Haystack's transport
# suite: 4 files of up to 2). Each role admits SERVER_MAX_CONNECTIONS per server, its headroom covering the test's own
# probes and provisioning logins.
FIXTURE_SERVERS=16


class Terminated(Exception):
    def __init__(self,signum):
        super().__init__(signal.Signals(signum).name)
        self.signum=signum


class Termination:
    """TERM/INT interrupt only the blocking waits inside interruptible(). Elsewhere, cleanup included, a signal is
    recorded and raised at the next check, so cleanup is never cut short; repeats are ignored."""
    def __init__(self):
        self.signum=None
        self.armed=False
        for termination in TERMINATION_SIGNALS: signal.signal(termination,self.handle)

    def handle(self,signum,frame):
        if self.signum is None: self.signum=signum
        if self.armed:
            self.armed=False
            raise Terminated(self.signum)

    def check(self):
        if self.signum is not None: raise Terminated(self.signum)

    @contextlib.contextmanager
    def interruptible(self):
        self.check()
        self.armed=True
        try: yield
        finally: self.armed=False
        self.check()


def process_state(pid):
    """(state, parent pid) from /proc/PID/stat, or None once the process is gone."""
    try: stat=Path(f'/proc/{pid}/stat').read_text()
    except (FileNotFoundError,ProcessLookupError): return None
    fields=stat[stat.rindex(')')+2:].split()
    return fields[0],int(fields[1])


def live_descendants():
    """Live (non-zombie) processes below this one, from /proc."""
    parents={}
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit(): continue
        state=process_state(entry.name)
        if state is not None and state[0]!='Z': parents[int(entry.name)]=state[1]
    found,frontier=set(),{os.getpid()}
    while frontier:
        frontier={pid for pid,parent in parents.items() if parent in frontier}-found
        found|=frontier
    return found


def signal_descendant(pid,tree,signum):
    """The pidfd pins the process; it is signalled only if its parent is still in the tree, so a reused pid is never hit."""
    try: descriptor=os.pidfd_open(pid)
    except ProcessLookupError: return
    try:
        state=process_state(pid)
        if state is not None and state[1] in tree|{os.getpid()}: signal.pidfd_send_signal(descriptor,signum)
    except ProcessLookupError: pass
    finally: os.close(descriptor)


def stop_workload(child):
    """Stops every process below the wrapper: TERM, then KILL after CHILD_STOP_SECONDS. As child subreaper the wrapper
    inherits orphans, so commands that leave the child's process group or session (GNU timeout, a test server started
    in a new session) and those whose parent already exited are found too. Returns when none is left."""
    for signum in (signal.SIGTERM,signal.SIGKILL):
        signalled=set()
        deadline=time.monotonic()+CHILD_STOP_SECONDS
        while time.monotonic()<deadline:
            child.poll()
            remaining=live_descendants()
            if not remaining: return
            for pid in remaining-signalled: signal_descendant(pid,remaining,signum)
            signalled|=remaining
            reap_orphans(child)
            time.sleep(POLL_SECONDS)
    raise RuntimeError(f'processes survived SIGKILL: {sorted(live_descendants())}')


def reap_orphans(child):
    """Inherited orphans are children of the wrapper once they exit; the child itself is left to Popen."""
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit() or int(entry.name)==child.pid: continue
        if process_state(entry.name)==('Z',os.getpid()):
            try: os.waitpid(int(entry.name),os.WNOHANG)
            except ChildProcessError: pass


class Usage(Exception):
    pass


def parse_arguments(arguments):
    """(child timeout in seconds, data root or None, command). Each option at most once, before the command; a timeout
    outside 1..MAX_CHILD_TIMEOUT_SECONDS, a data root that is not an absolute directory of this user, or no command is
    refused."""
    timeout,data_root,seen=CHILD_TIMEOUT_SECONDS,None,set()
    while arguments and arguments[0].startswith((CHILD_TIMEOUT_OPTION+'=',DATA_ROOT_OPTION+'=')):
        option,value=arguments[0].split('=',1)
        if option in seen: raise Usage(f'{option} given twice')
        seen.add(option)
        if option==CHILD_TIMEOUT_OPTION:
            if not (value.isascii() and value.isdecimal()) or not 1<=int(value)<=MAX_CHILD_TIMEOUT_SECONDS:
                raise Usage(f'{CHILD_TIMEOUT_OPTION}=N needs an integer N in 1..{MAX_CHILD_TIMEOUT_SECONDS}, got {value!r}')
            timeout=int(value)
        else:
            data_root=Path(value)
            if not data_root.is_absolute() or not data_root.is_dir() or data_root.stat().st_uid!=os.getuid():
                raise Usage(f'{DATA_ROOT_OPTION}=DIR needs an existing absolute directory owned by this user, got {value!r}')
        arguments=arguments[1:]
    if not arguments: raise Usage('a command is required')
    return timeout,data_root,arguments


def main(termination,child_timeout,data_root,command):
    os.umask(0o077)
    template=json.loads(Path(os.environ['PG_POLICY']).read_text())
    pg=os.environ['PG_BIN']
    relocation=contextlib.nullcontext() if data_root is None else tempfile.TemporaryDirectory(prefix='ponygirls-owned-pg-data-',dir=data_root)
    with tempfile.TemporaryDirectory(prefix='ponygirls-owned-pg-') as name, relocation as elsewhere:
        root=Path(name)
        (root/'.owned-test-only').write_text('ponygirls-owned-test-v1\n')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
        admin=pwd.getpwuid(os.getuid()).pw_name
        template.update(stateDirectory=str(root/'cluster'),port=port,adminRole=admin,postgresBin=pg)
        for key,d in template['databases'].items():
            d['passwordFile']=str(root/'secrets'/key)
            # Behavioral native tests have finite <=30s statements. Module policy
            # rehearsal separately executes the short real deadline cases.
            d.update(createPassword=True,maxConnections=FIXTURE_SERVERS*SERVER_MAX_CONNECTIONS,statementTimeoutMs=30000,lockTimeoutMs=35000 if key=="chronicle" else 5000,idleTransactionTimeoutMs=60000 if key=="chronicle" else 30000)
        manifest=root/'provider.json';manifest.write_text(json.dumps(template))
        hba=Path(os.environ['PG_HBA']).read_text().replace('local all "nixbld" peer',f'local all "{admin}" peer')
        (root/'hba').write_text(hba)
        settings=Path(os.environ['PG_CONFIGURATION']).read_text().replace('/unused-evaluation-path/socket',str(root/'cluster'/'socket')).replace(os.environ['PG_HBA'],str(root/'hba')).replace('port = 15434',f'port = {port}')
        # Every role's limit plus the admin reserve (the policy's capacity budget); the last setting in the file wins.
        settings+=f"max_connections = {sum(d['maxConnections'] for d in template['databases'].values())+template['adminReserve']}\n"
        (root/'postgresql.conf').write_text(settings)
        def run(*args):
            subprocess.run(args,check=True,stdout=subprocess.DEVNULL,timeout=180)
        with termination.interruptible(): run(sys.executable,os.environ['PG_PROVIDER'],'init',str(manifest))
        data=str(root/'cluster'/'data')
        if elsewhere is not None:
            # The provider keeps the data directory beside the socket; before the first start it moves to the data root.
            relocated=Path(elsewhere)/'data'
            shutil.move(data,relocated)
            os.symlink(relocated,data)
        try:
            env=dict(os.environ,PONYGIRLS_OWNED_FIXTURE_ROOT=str(root))
            with termination.interruptible():
                run(pg+'/pg_ctl','-D',data,'-l',str(root/'postgres.log'),'-o',f'-c config_file={root}/postgresql.conf','-w','-t','30','start')
                for key in template['databases']: run(sys.executable,os.environ['PG_PROVIDER'],'provision',str(manifest),key)
            for key,d in template['databases'].items():
                env['PONYGIRLS_TEST_DATABASE_'+key.upper()]=json.dumps({
                    'jdbcUrl':f'jdbc:postgresql://127.0.0.1:{port}/{d["name"]}',
                    'user':d['user'],'passwordFile':d['passwordFile'],
                    'limits':{'maxConnections':SERVER_MAX_CONNECTIONS,'maxQueued':32,'queueTimeoutMs':5000,'connectTimeoutMs':5000,'statementTimeoutMs':d['statementTimeoutMs'],'lockTimeoutMs':d['lockTimeoutMs'],'idleTransactionTimeoutMs':d['idleTransactionTimeoutMs'],'socketTimeoutMs':35000 if key=='chronicle' else 40000}})
            haystack=json.loads(env['PONYGIRLS_TEST_DATABASE_HAYSTACK'])
            manure=json.loads(env['PONYGIRLS_TEST_DATABASE_MANURE'])
            env.update(HAYSTACK_OWNED_TEST_DB='1',HAYSTACK_TEST_JDBC=haystack['jdbcUrl'],
                HAYSTACK_TEST_DB_USER=haystack['user'],HAYSTACK_TEST_DB_PASSWORD_FILE=haystack['passwordFile'],
                HAYSTACK_TEST_PG=haystack['jdbcUrl'].removeprefix('jdbc:'),
                HAYSTACK_FIXTURE_WORK_DIR=str(root),HAYSTACK_OWNED_PGDATA=data,
                MANURE_TEST_JDBC_URL=manure['jdbcUrl'],MANURE_TEST_JDBC_USER=manure['user'],
                MANURE_TEST_JDBC_PASSWORD_FILE=manure['passwordFile'],MANURE_TEST_ALLOW_CREATEDB='1')
            # Set after pg_ctl start: the postmaster, orphaned by pg_ctl, is not part of the workload.
            if ctypes.CDLL(None,use_errno=True).prctl(PR_SET_CHILD_SUBREAPER,1,0,0,0)!=0:
                raise OSError(ctypes.get_errno(),'prctl(PR_SET_CHILD_SUBREAPER)')
            child=subprocess.Popen(command,env=env,start_new_session=True)
            try:
                with termination.interruptible():
                    try: return child.wait(timeout=child_timeout)
                    except subprocess.TimeoutExpired: return EXIT_TIMEOUT
            finally:
                # Also after a normal exit: nothing of the workload may outlive the cluster.
                stop_workload(child)
        finally:
            # No pid file: the start was interrupted before a postmaster ran.
            if (Path(data)/'postmaster.pid').exists():
                run(pg+'/pg_ctl','-D',data,'-m','fast','-w','-t','30','stop')

if __name__=='__main__':
    try: child_timeout,data_root,command=parse_arguments(sys.argv[1:])
    except Usage as usage:
        print(f'with-owned-postgres: {usage}',file=sys.stderr)
        sys.exit(EXIT_USAGE)
    termination=Termination()
    try:
        status=main(termination,child_timeout,data_root,command)
        termination.check()
    except Terminated as terminated:
        status=128+terminated.signum
    sys.exit(status)
