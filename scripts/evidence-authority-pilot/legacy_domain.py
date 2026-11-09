"""Typed ontology account and deterministic host projection; not an execution goal."""
from dataclasses import asdict, dataclass
import hashlib
import json
import math


class Rejected(ValueError):
    pass


class SafetyViolation(Rejected):
    def __init__(self,category,evidence):
        super().__init__(category)
        self.evidence=evidence


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def decode(raw,limit):
    if len(raw)>limit:
        raise Rejected("record-limit")
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result:
                raise Rejected("duplicate-json-key")
            result[key]=value
        return result
    try:
        result=json.loads(raw,object_pairs_hook=unique,parse_constant=lambda value:(_ for _ in ()).throw(Rejected("nonfinite-json")))
        pending=[result]
        while pending:
            item=pending.pop()
            if type(item) is str:item.encode('utf-8')
            elif type(item) is float and not math.isfinite(item):raise Rejected('nonfinite-json')
            elif type(item) is dict:pending.extend(item.keys());pending.extend(item.values())
            elif type(item) is list:pending.extend(item)
        return result
    except Rejected:raise
    except (UnicodeError,ValueError) as error:
        raise Rejected("invalid-json") from error


def fields(value,names):
    if type(value) is not dict or set(value)!=set(names):
        raise Rejected("fields")
    return value


def text(value):
    if type(value) is not str or not value.strip() or "\x00" in value:
        raise Rejected("text")
    try:value.encode('utf-8')
    except UnicodeError as error:raise Rejected('text-utf8') from error
    return value


def choice(value,allowed):
    if value not in allowed:
        raise Rejected("enum")
    return value


@dataclass(frozen=True)
class Scope:
    trial_id: str
    root_session_id: str
    worker_session_id: str
    curator_session_id: str
    branch_id: str
    scope_epoch: int


@dataclass(frozen=True)
class Event:
    id: str
    ordinal: int
    actual_actor: str
    scenario_role: str
    session_id: str
    branch_id: str
    phase: str
    kind: str
    text: str
    eligible: bool
    basis_digest: str

    def wire(self):
        return asdict(self)


@dataclass(frozen=True)
class Node:
    id: str
    kind: str
    intent: str
    priority: str
    standing: str
    work_state: str | None
    text: str
    sources: tuple[str,...]
    change_reason: str

    def wire(self):
        return {**asdict(self),"sources":list(self.sources)}


@dataclass(frozen=True)
class Relation:
    id: str
    kind: str
    standing: str
    source: str
    target: str
    sources: tuple[str,...]

    def wire(self):
        return {**asdict(self),"sources":list(self.sources)}


@dataclass(frozen=True)
class Graph:
    reviewed_event_ids: tuple[str,...]
    nodes: tuple[Node,...]
    relations: tuple[Relation,...]

    def wire(self):
        return {"reviewed_event_ids":list(self.reviewed_event_ids),"nodes":[n.wire() for n in self.nodes],"relations":[r.wire() for r in self.relations]}


def empty_graph():
    return Graph((),(),())


def parse_graph(value,events,previous):
    row=fields(value,("reviewed_event_ids","nodes","relations"))
    expected=[e.id for e in events if e.eligible]
    if row["reviewed_event_ids"]!=expected or type(row["nodes"]) is not list or type(row["relations"]) is not list:
        raise Rejected("coverage-or-arrays")
    source_by_id={e.id:e for e in events if e.eligible}
    def sources(value):
        if type(value) is not list or not value or any(type(item) is not str for item in value) or len(set(value))!=len(value) or not set(value)<=set(expected):
            raise Rejected("source-refs")
        return tuple(value)
    nodes=[]
    for raw in row["nodes"]:
        n=fields(raw,("id","kind","intent","priority","standing","work_state","text","sources","change_reason"))
        kind=choice(n["kind"],("objective","constraint","task","claim","observation","hypothesis","question","decision","defect","statement"))
        intent=choice(n["intent"],("explicit","inferred","none"));priority=choice(n["priority"],("primary","secondary","none"));standing=choice(n["standing"],("active","superseded","withdrawn"));refs=sources(n["sources"])
        if priority!="none" and kind!="objective":
            raise Rejected("priority-kind")
        if kind in ("task","defect"):
            choice(n["work_state"],("planned","in_progress","blocked","reported_complete","cancelled","unknown"))
        elif n["work_state"] is not None:
            raise Rejected("work-state-kind")
        if intent=="explicit" and not any(source_by_id[ref].scenario_role=="human" and source_by_id[ref].actual_actor=="fixture_injector" and source_by_id[ref].kind=="scenario_request" for ref in refs):
            raise Rejected("explicit-scenario-basis")
        nodes.append(Node(text(n["id"]),kind,intent,priority,standing,n["work_state"],text(n["text"]),refs,choice(n["change_reason"],("initial","new_source","reinterpretation","replacement","cancellation","evidence"))))
    ids={n.id for n in nodes}
    if len(ids)!=len(nodes) or not {n.id for n in previous.nodes}<=ids:
        raise Rejected("node-identity")
    if sum(n.kind=="objective" and n.priority=="primary" and n.standing=="active" for n in nodes)>1:
        raise Rejected("multiple-primary")
    relations=[]
    for raw in row["relations"]:
        r=fields(raw,("id","kind","standing","source","target","sources"))
        relation=Relation(text(r["id"]),choice(r["kind"],("contributes_to","depends_on","supports","challenges","supersedes","refines","assesses","answers","alias_of")),choice(r["standing"],("active","superseded","withdrawn")),text(r["source"]),text(r["target"]),sources(r["sources"]))
        if relation.source not in ids or relation.target not in ids or relation.source==relation.target:
            raise Rejected("relation-endpoint")
        relations.append(relation)
    rids={r.id for r in relations}
    if len(rids)!=len(relations) or not {r.id for r in previous.relations}<=rids:
        raise Rejected("relation-identity")
    return Graph(tuple(expected),tuple(nodes),tuple(relations))


def seal(graph,previous_sealed,events,scope,revision):
    old={item["entity_id"]:item for item in previous_sealed}
    by_id={e.id:e for e in events};result=[]
    for category,records in (("node",graph.nodes),("relation",graph.relations)):
        for record in records:
            key=category+":"+record.id;body=record.wire();prior=old.get(key)
            if prior is not None and prior["body"]==body:
                result.append(prior);continue
            version=1 if prior is None else prior["version"]+1
            provenance={"contributor":"curator-model","capture_context":{"root_session_id":scope.root_session_id,"session_id":scope.curator_session_id,"parent_session_id":scope.worker_session_id,"branch_id":scope.branch_id,"scope_epoch":scope.scope_epoch},"input_frontier":list(graph.reviewed_event_ids),"source_refs":[{"event_id":ref,"source_session_id":by_id[ref].session_id,"branch_id":by_id[ref].branch_id,"actual_actor":by_id[ref].actual_actor,"scenario_role":by_id[ref].scenario_role,"basis_digest":by_id[ref].basis_digest} for ref in record.sources],"graph_revision":revision,"status":"derived account; simulated scenario roles are not actual Human acts"}
            result.append({"entity_id":key,"version":version,"body":body,"provenance":provenance})
    return result


def project(graph,sealed,previous_delivered_graph,events,scope,revision,current_frontier,last_valid_frontier):
    context=asdict(scope)
    for record in sealed:
        captured=record["provenance"]["capture_context"]
        if captured["root_session_id"]!=scope.root_session_id or captured["parent_session_id"]!=scope.worker_session_id or captured["branch_id"]!=scope.branch_id or captured["scope_epoch"]!=scope.scope_epoch:
            raise Rejected("projection-scope")
    if last_valid_frontier!=current_frontier:
        return {"kind":"graph_unavailable","scope":context,"graph_revision":revision,"coverage":"lagging","last_valid_frontier":last_valid_frontier,"current_frontier":current_frontier,"meaning":"No stale ontology is presented as current. Ordinary scenario requests and raw-source access remain available."}
    by_id={e.id:e for e in events};old={n.id:n for n in previous_delivered_graph.nodes}
    def scenario_basis(refs):
        return [by_id[ref].wire() for ref in refs if by_id[ref].kind=="scenario_request" and by_id[ref].actual_actor=="fixture_injector" and by_id[ref].scenario_role=="human"]
    governing=[];interpretations=[];work=[];other=[];historical=[];changes=[]
    for record in sealed:
        if not record["entity_id"].startswith("node:"):
            continue
        n=record["body"];human_basis=scenario_basis(n["sources"])
        if n["standing"]!="active":
            historical.append({**record,"verbatim_scenario_basis":human_basis})
        elif n["kind"] in ("objective","constraint") and n["intent"]=="explicit" and human_basis:
            governing.append({**record,"verbatim_scenario_basis":human_basis})
        elif n["kind"] in ("objective","constraint"):
            interpretations.append(record)
        elif n["kind"] in ("task","defect"):
            work.append(record)
        else:
            other.append(record)
        prior=old.get(n["id"])
        if prior is not None and prior.kind in ("objective","constraint") and prior.standing=="active" and prior.wire()!=n:
            changes.append({"entity_id":record["entity_id"],"previous":prior.wire(),"current":n,"reason":n["change_reason"],"previous_scenario_basis":scenario_basis(prior.sources),"verbatim_scenario_basis":human_basis,"authority":"Automatic account revision, NOT a new actual Human act; missing/ambiguous basis must not silently authorize deletion of intent."})
    return {"kind":"graph_capsule","scope":context,"graph_revision":revision,"coverage":"current","frontier":current_frontier,"governing_scenario_contract":governing,"interpretations_and_means":interpretations,"work_accounts":work,"evidence_hypotheses_questions":other,"historical_records":historical,"relations":[r.wire() for r in graph.relations],"standing_changes":changes,"meaning":"Current derived ontology, not acceptance, independent truth, real Human approval or execution permission. Coverage is not semantic proof."}
