# Behavioral-Active/Blackbox-GoodCommunication: actual HM USER systemd graph.
# Explicit synthetic app CLI adapters; no native HTTP/model acceptance.
import json
import pathlib
import shlex
import shutil
import time
from dataclasses import dataclass
from typing import Callable, Literal, NotRequired, Protocol, TypedDict, cast

class UnitSnapshot(TypedDict):
    ActiveState: str
    MainPID: int
    ExecMainStartTimestampMonotonic: int
    InvocationID: str
    startCount: int
    adapterStartedInvocations: list[str]
    probeSuccessByInvocation: dict[str, int]

State = dict[str, UnitSnapshot]

class JournalReference(TypedDict):
    cursor: str
    bootId: str

class RestartEvent(JournalReference):
    unit: str
    messageId: str

class RestartEvidence(TypedDict):
    count: int
    events: list[RestartEvent]

class AutomaticRestartEvidence(RestartEvidence):
    reference: JournalReference

class Case(TypedDict):
    name: str
    status: Literal['running', 'pass', 'fail', 'invalid-fixture', 'not-executed']
    faultEntered: NotRequired[bool]
    before: NotRequired[State]
    automaticRestartEvidence: NotRequired[AutomaticRestartEvidence]

CaseBody = Callable[[Case], None]
Plan = tuple[str, CaseBody]
Plans = tuple[Plan, ...]
Observe = Callable[[], State]
StableField = Literal['MainPID', 'ExecMainStartTimestampMonotonic', 'InvocationID', 'startCount']

class Guest(Protocol):
    def succeed(self, command: str) -> str: ...
    def wait_for_unit(self, unit: str, *, timeout: int) -> None: ...

class Controller(Protocol):
    def run_case(self, name: str, body: CaseBody, precondition: Observe,
                 observe: Observe, restore: Observe, persist: Callable[[Case], None]) -> Case: ...
    def run_matrix(self, plans: Plans, bootstrap: Callable[[], None], execute: Callable[[Plan], Case],
                   *, records: list[Case], persist: Callable[[], None]) -> list[Case]: ...

@dataclass(frozen=True)
class Source:
    revision: str
    manifest: pathlib.Path

class HmLifecycle:
    PROVIDER = 'ponygirls-postgres.service'
    APPS = ('chronicle.service', 'ivm-haystack.service', 'ivm-manure.service')
    MIGRATIONS = ('chronicle-migrate.service', 'ivm-haystack-migrate.service', 'ivm-manure-migrate.service')
    DATABASES = tuple('ponygirls-database-' + name + '.service' for name in ('chronicle', 'haystack', 'manure'))
    UNITS = (PROVIDER,) + DATABASES + MIGRATIONS + APPS
    PREFIX = 'runuser -u alice -- env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus '

    def __init__(self, home: Guest, controller: Controller, source: Source,
                 out: pathlib.Path, start_all: Callable[[], None]) -> None:
        self.home = home
        self.controller = controller
        self.source = source
        self.out = out
        self.start_all = start_all
        self.base: str | None = None
        self.results: list[Case] = []
        self.out.mkdir(exist_ok=True)
        shutil.copyfile(self.source.manifest, self.out / 'source-inputs.sha256')

    def user(self, command: str) -> str:
        return self.home.succeed(self.PREFIX + command)

    def ctl(self, command: str) -> str:
        return self.user('systemctl --user ' + command)

    def snapshot(self) -> State:
        # Owned snapshot helper is the JSON transport boundary for this schema.
        return cast(State, json.loads(self.user('/etc/unit-graph-user/snapshot ' + ' '.join(self.UNITS))))

    def wait(self, predicate: Callable[[State], bool], description: str, seconds: int) -> State:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            state = self.snapshot()
            if predicate(state):
                return state
            time.sleep(.25)
        raise AssertionError(description)

    def ready_chains(self, apps: tuple[str, ...], databases: tuple[str, ...]) -> State:
        required = (self.PROVIDER,) + databases + tuple(m for a, m in zip(self.APPS, self.MIGRATIONS) if a in apps) + apps
        return self.wait(lambda s: all(s[u]['ActiveState'] == 'active' for u in required)
                         and all(s[u]['InvocationID'] in s[u]['adapterStartedInvocations']
                                 for u in required if u in self.APPS + self.MIGRATIONS),
                         'actual HM units did not become ready', 60)

    def ready_all(self) -> State:
        return self.ready_chains(self.APPS, self.DATABASES)

    def probes(self, apps: tuple[str, ...]) -> State:
        before = self.snapshot()
        intended = {u: before[u]['InvocationID'] for u in apps}
        assert all(before[u]['ActiveState'] == 'active' and intended[u] for u in apps)
        self.ctl('kill --kill-whom=main --signal=USR1 ' + ' '.join(apps))
        return self.wait(lambda s: all(s[u]['ActiveState'] == 'active' and s[u]['InvocationID'] == intended[u]
                         and s[u]['probeSuccessByInvocation'].get(intended[u], 0) > before[u]['probeSuccessByInvocation'].get(intended[u], 0)
                         for u in apps), 'no fresh active intended HM invocation SQL success', 60)

    def probes_all(self) -> State:
        return self.probes(self.APPS)

    @staticmethod
    def stable(before: State, after: State, units: tuple[str, ...]) -> None:
        fields: tuple[StableField, ...] = ('MainPID', 'ExecMainStartTimestampMonotonic', 'InvocationID', 'startCount')
        for unit in units:
            for field in fields:
                assert before[unit][field] == after[unit][field], (unit, field)

    def save(self) -> None:
        receipt = {
            'scope': 'actual HM modules/systemd USER manager/real PG with explicit synthetic CLI adapters; NOT native app/HTTP/model acceptance',
            'trustBoundary': 'all HM services share alice UID1000; role ACLs do not isolate credentials from same-UID processes',
            'sourceRevision': self.source.revision,
            'manualStopStartPolicy': 'intentional stop leaves consumers down; provider start alone does not resurrect; selected app start restores own chain',
            'cases': self.results, 'mandatoryCases': len(self.results),
            'faultsExecuted': sum(bool(c.get('faultEntered')) for c in self.results),
            'notExecuted': [c['name'] for c in self.results if not c.get('faultEntered')],
            'invalidFixtureCases': [c['name'] for c in self.results if c['status'] == 'invalid-fixture'],
        }
        (self.out / 'lifecycle-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')

    def restore(self) -> State:
        assert self.base is not None, 'restore requires successful bootstrap'
        if self.home.succeed('readlink -f /run/current-system').strip() != self.base:
            self.home.succeed(self.base + '/bin/switch-to-configuration test')
            self.home.wait_for_unit('home-manager-alice.service', timeout=120)
        self.ctl('start ' + self.PROVIDER)
        self.ctl('start ' + ' '.join(self.APPS))
        return self.ready_all()

    def case(self, name: str, body: CaseBody) -> Case:
        def update(item: Case) -> None:
            for index, prior in enumerate(self.results):
                if prior['name'] == name:
                    self.results[index] = item
                    break
            self.save()
        item = self.controller.run_case(name, body, self.ready_all, self.snapshot, self.restore, update)
        print('HM_UNIT_GRAPH_MILESTONE ' + name + ' ' + item['status'], flush=True)
        return item

    def bootstrap(self) -> None:
        print('HM_UNIT_GRAPH_BOOTSTRAP launch-owned-user-manager-VM', flush=True)
        self.start_all()
        self.home.wait_for_unit('user@1000.service', timeout=120)
        self.home.wait_for_unit('home-manager-alice.service', timeout=120)
        self.base = self.home.succeed('readlink -f /run/current-system').strip()
        self.home.succeed('! systemctl is-active --quiet postgresql.service')
        print('HM_UNIT_GRAPH_BOOTSTRAP_STATE ' + json.dumps(self.snapshot(), sort_keys=True), flush=True)
        self.ready_all()
        self.probes_all()

    def boot(self, item: Case) -> None:
        self.ready_all()
        self.probes_all()

    def own_restart(self, item: Case) -> None:
        self.ctl('restart ivm-haystack.service')
        after = self.ready_all()
        self.probes_all()
        self.stable(item['before'], after, (self.PROVIDER,) + self.DATABASES + self.MIGRATIONS + ('chronicle.service', 'ivm-manure.service'))
        assert after['ivm-haystack.service']['MainPID'] != item['before']['ivm-haystack.service']['MainPID']

    def provider_restart(self, item: Case) -> None:
        self.ctl('restart ' + self.PROVIDER)
        after = self.ready_all()
        self.probes_all()
        assert after[self.PROVIDER]['MainPID'] != item['before'][self.PROVIDER]['MainPID']

    def crash(self, item: Case) -> None:
        # Owned restart helper's two JSON transports have fixed, named schemas.
        reference = cast(JournalReference, json.loads(self.user('/etc/unit-graph-user/restart-evidence capture --scope user')))
        self.ctl('kill --kill-whom=main --signal=KILL ' + self.PROVIDER)
        self.wait(lambda s: s[self.PROVIDER]['ActiveState'] == 'active' and s[self.PROVIDER]['MainPID'] not in (0, item['before'][self.PROVIDER]['MainPID']),
                  'HM provider did not auto-restart', 60)
        self.ready_all()
        self.probes_all()
        after = self.snapshot()
        evidence = cast(RestartEvidence, json.loads(self.user('/etc/unit-graph-user/restart-evidence after --scope user --unit ' + self.PROVIDER
                              + ' --cursor ' + shlex.quote(reference['cursor']) + ' --boot ' + shlex.quote(reference['bootId']))))
        item['automaticRestartEvidence'] = {'reference': reference, **evidence}
        assert evidence['count'] > 0
        assert after[self.PROVIDER]['InvocationID'] != item['before'][self.PROVIDER]['InvocationID']

    def stopped(self, item: Case) -> None:
        self.ctl('stop ivm-manure.service')
        self.ctl('restart ' + self.PROVIDER)
        after = self.ready_chains(self.APPS[:2], self.DATABASES)
        self.probes(self.APPS[:2])
        assert after['ivm-manure.service']['ActiveState'] == 'inactive'

    def manual(self, item: Case) -> None:
        self.ctl('stop ' + self.PROVIDER)
        self.wait(lambda s: all(s[u]['ActiveState'] == 'inactive' for u in self.UNITS), 'HM manual stop left a dependent active', 60)
        self.ctl('start ' + self.PROVIDER)
        self.wait(lambda s: s[self.PROVIDER]['ActiveState'] == 'active', 'HM manual provider start failed', 60)
        assert all(self.snapshot()[u]['ActiveState'] == 'inactive' for u in self.APPS)
        self.ctl('start chronicle.service ivm-haystack.service')
        self.ready_chains(self.APPS[:2], self.DATABASES[:2])
        self.probes(self.APPS[:2])
        after = self.snapshot()
        assert all(after[u]['ActiveState'] == 'inactive' for u in (self.APPS[2], self.MIGRATIONS[2], self.DATABASES[2]))

    def disabled(self, item: Case) -> None:
        assert self.base is not None, 'switch requires successful bootstrap'
        self.home.succeed(self.base + '/specialisation/disabled-consumer/bin/switch-to-configuration test')
        self.home.wait_for_unit('home-manager-alice.service', timeout=120)
        after = self.ready_chains(self.APPS[:2], self.DATABASES)
        self.stable(item['before'], after, (self.PROVIDER,) + self.DATABASES + ('chronicle.service', 'ivm-haystack.service', 'chronicle-migrate.service', 'ivm-haystack-migrate.service'))
        assert after['ivm-manure.service']['ActiveState'] == 'inactive'
        self.ctl('restart ' + self.PROVIDER)
        after = self.ready_chains(self.APPS[:2], self.DATABASES)
        self.probes(self.APPS[:2])
        assert after['ivm-manure.service']['ActiveState'] == 'inactive' and after['ivm-manure-migrate.service']['ActiveState'] == 'inactive'

    def plans(self) -> Plans:
        return (
            ('HM-boot-three-consumers-one-user-provider', self.boot),
            ('HM-own-app-restart-isolates-provider-others', self.own_restart),
            ('HM-explicit-provider-restart-recovers-active-chain', self.provider_restart),
            ('HM-provider-crash-autorestart-fresh-role-reconnect', self.crash),
            ('HM-stopped-consumer-stays-stopped', self.stopped),
            ('HM-intentional-manual-stop-start-selected-recovery', self.manual),
            ('HM-actual-disabled-module-stays-disabled', self.disabled),
        )

    def run(self) -> None:
        self.controller.run_matrix(self.plans(), self.bootstrap, lambda plan: self.case(*plan), records=self.results, persist=self.save)
        self.save()
        print('UNIT_GRAPH_TERMINAL ' + (self.out / 'lifecycle-receipt.json').read_text().replace('\n', ' '), flush=True)
        assert len(self.results) == 7 and all(c['status'] == 'pass' for c in self.results), 'actual HM user-manager lifecycle matrix failed; no policy fix inferred'


def run_hm_graph(home: Guest, controller: Controller, source: Source,
                 out: pathlib.Path, start_all: Callable[[], None]) -> None:
    HmLifecycle(home, controller, source, out, start_all).run()
