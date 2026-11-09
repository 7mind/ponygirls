"""Pure candidate delta admission; no evaluator, provider, execution or goal mutation."""
from dataclasses import asdict, dataclass
from typing import TypeAlias

from evidence import (ArtifactFact, DigestAssertion, EvidenceError, FactRef,
                      HostEvidence, ModelAssertion, Scope)
from legacy_domain import Event, Graph, Rejected, digest, empty_graph, fields, parse_graph

Json: TypeAlias = None | bool | int | float | str | list['Json'] | dict[str, 'Json']


class DeltaError(EvidenceError):
    pass


def require(condition: bool, code: str) -> None:
    if not condition:
        raise DeltaError(code)


@dataclass(frozen=True)
class Head:
    scope: Scope
    worker_session_id: str
    revision: int
    graph: Graph
    assertions: tuple[ModelAssertion, ...]
    source_pins: tuple[tuple[str, str], ...]


def initial_head(scope: Scope, worker_session_id: str) -> Head:
    require(type(scope) is Scope, 'scope')
    require(type(worker_session_id) is str and bool(worker_session_id), 'source-session')
    return Head(scope, worker_session_id, 0, empty_graph(), (), ())


def eligible_events(head: Head, events: tuple[Event, ...]) -> tuple[Event, ...]:
    require(type(events) is tuple and all(type(event) is Event for event in events), 'events')
    require(all(event.branch_id == head.scope.branch_id and event.session_id == head.worker_session_id for event in events), 'source-scope')
    require(all(type(event.ordinal) is int and event.ordinal > 0 and type(event.eligible) is bool for event in events), 'event-types')
    require(len({event.id for event in events}) == len(events), 'duplicate-source')
    require(all(first.ordinal < second.ordinal for first, second in zip(events, events[1:])), 'source-order')
    selected = tuple(event for event in events if event.eligible)
    previous = head.graph.reviewed_event_ids
    require(tuple(event.id for event in selected[:len(previous)]) == previous, 'source-prefix')
    require(tuple((event.id, digest(event.wire())) for event in selected[:len(previous)]) == head.source_pins, 'source-prefix-identity')
    return selected


def reference(raw: Json) -> FactRef:
    row = fields(raw, ('scope', 'fact_id'))
    scope = fields(row['scope'], ('trial_id', 'branch_id', 'epoch'))
    return FactRef(Scope(scope['trial_id'], scope['branch_id'], scope['epoch']), row['fact_id'])


def assertion(raw: dict[str, Json], evidence: HostEvidence, by_id: dict[str, Event]) -> ModelAssertion:
    refs = raw['fact_refs']; predicates = raw['digest_assertions']
    require(type(refs) is list and type(predicates) is list, 'assertion-arrays')
    parsed_refs = tuple(reference(ref) for ref in refs)
    parsed_predicates = []
    for predicate in predicates:
        row = fields(predicate, ('reference', 'expected_sha256'))
        parsed_predicates.append(DigestAssertion(reference(row['reference']), row['expected_sha256']))
    account = ModelAssertion(raw['id'], raw['text'], parsed_refs, tuple(parsed_predicates))
    for ref in account.evidence_refs:
        fact = evidence.resolve(ref)
        require(fact.event_id in by_id and fact.event_id in raw['sources'], 'fact-source-not-cited')
        event = by_id[fact.event_id]
        require(event.actual_actor in ('owned_tool_dispatcher', 'owned_workspace') and event.scenario_role == 'none' and event.kind in ('tool_observation', 'artifact_observation'), 'fact-source-kind')
    for predicate in account.digest_assertions:
        require(predicate.reference in account.evidence_refs, 'predicate-not-cited')
        require(type(evidence.resolve(predicate.reference)) is ArtifactFact, 'predicate-fact-kind')
    return account


def apply_delta(head: Head, raw: dict[str, Json], events: tuple[Event, ...], evidence: HostEvidence) -> Head:
    try:
        row = fields(raw, ('scope', 'base_revision', 'reviewed_new_event_ids', 'nodes', 'relations'))
        require(row['scope'] == asdict(head.scope) and head.scope == evidence.scope, 'scope')
        incoming_scope = fields(row['scope'], ('trial_id', 'branch_id', 'epoch'))
        Scope(incoming_scope['trial_id'], incoming_scope['branch_id'], incoming_scope['epoch'])
        require(type(row['base_revision']) is int and row['base_revision'] == head.revision, 'base-revision')
        selected = eligible_events(head, events)
        new_ids = [event.id for event in selected[len(head.graph.reviewed_event_ids):]]
        require(bool(new_ids), 'no-new-frontier')
        require(type(row['reviewed_new_event_ids']) is list and row['reviewed_new_event_ids'] == new_ids, 'new-event-coverage')
        require(type(row['nodes']) is list and type(row['relations']) is list, 'delta-arrays')
        node_fields = ('id', 'kind', 'intent', 'priority', 'standing', 'work_state', 'text', 'sources', 'change_reason')
        updates = [fields(value, node_fields + ('fact_refs', 'digest_assertions')) for value in row['nodes']]
        for update in updates:
            require(type(update['id']) is str, 'node-id')
        relation_fields = ('id', 'kind', 'standing', 'source', 'target', 'sources')
        relations = [fields(value, relation_fields) for value in row['relations']]
        for value in relations:
            require(type(value['id']) is str, 'relation-id')
        require(len({value['id'] for value in updates}) == len(updates), 'duplicate-node-update')
        require(len({value['id'] for value in relations}) == len(relations), 'duplicate-relation-update')
        nodes_by_id = {node.id: node.wire() for node in head.graph.nodes}
        relations_by_id = {value.id: value.wire() for value in head.graph.relations}
        old_propositions = {(value.kind, value.source, value.target): value.id for value in head.graph.relations}
        for value in relations:
            proposition = (value['kind'], value['source'], value['target'])
            require(all(type(part) is str for part in proposition), 'relation-fields')
            prior = relations_by_id.get(value['id'])
            if prior is not None:
                require(proposition == (prior['kind'], prior['source'], prior['target']), 'relation-identity-repurposed')
            else:
                require(proposition not in old_propositions, 'relation-proposition-already-named')
            relations_by_id[value['id']] = value
        for value in updates:
            nodes_by_id[value['id']] = {key: value[key] for key in node_fields}
        combined = {'reviewed_event_ids': [event.id for event in selected],
                    'nodes': list(nodes_by_id.values()), 'relations': list(relations_by_id.values())}
        graph = parse_graph(combined, selected, head.graph)
        propositions = [(value.kind, value.source, value.target) for value in graph.relations if value.standing == 'active']
        require(len(set(propositions)) == len(propositions), 'duplicate-active-proposition')
        accounts = {account.identity: account for account in head.assertions}
        by_id = {event.id: event for event in selected}
        for value in updates:
            accounts[value['id']] = assertion(value, evidence, by_id)
        return Head(head.scope, head.worker_session_id, head.revision + 1, graph, tuple(accounts.values()),
                    tuple((event.id, digest(event.wire())) for event in selected))
    except DeltaError:
        raise
    except (Rejected, EvidenceError) as error:
        raise DeltaError(str(error)) from error
    except (KeyError, TypeError) as error:
        raise DeltaError('delta-shape') from error


def incremental_request(head: Head, events: tuple[Event, ...], evidence: HostEvidence) -> dict[str, Json]:
    require(head.scope == evidence.scope, 'scope')
    selected = eligible_events(head, events)
    by_id = {event.id: event for event in selected}
    return {
        'scope': asdict(head.scope),
        'source_session_id': head.worker_session_id,
        'base_revision': head.revision,
        'previous_graph': head.graph.wire(),
        'previous_assertions': [asdict(account) for account in head.assertions],
        'new_events': [event.wire() for event in selected[len(head.graph.reviewed_event_ids):]],
        'source_index': [{'id': event.id, 'ordinal': event.ordinal, 'kind': event.kind, 'actual_actor': event.actual_actor} for event in selected],
        'host_facts': [asdict(fact) for fact in evidence.facts() if fact.event_id in by_id],
        'source_retrieval': 'All earlier eligible sources remain available by exact ID; availability/coverage is not reading or comprehension.',
    }
