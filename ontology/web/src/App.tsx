import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ApiClient } from './client.js';
import * as C from './contracts.js';
import { actionKey, actionLabel, selectionLabel } from './actions.js';

interface AppProps { client: ApiClient; newRequestId: () => string }
interface Load<T> { data: T | null; pending: boolean; error: string | null }
type Inspect = (ref: C.Ref) => void;
type BrowseMode = 'current' | 'history' | 'search';
interface SearchSpec { query: string; kind: C.DefinitionKind | undefined }
interface Selection { generation: bigint; refs: C.Ref[] }
interface Page { generation: bigint; records: C.GraphRecord[]; hits: C.SearchHit[]; cursor: string | undefined }

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed. No successful response was received.';
}

// Each request lane owns its cancellation and rejects responses from older runs.
function useLoad<T>() {
  const [state, setState] = useState<Load<T>>({ data: null, pending: false, error: null });
  const epoch = useRef(0);
  const active = useRef<AbortController | null>(null);
  const cancel = useCallback(() => {
    epoch.current += 1;
    active.current?.abort();
    active.current = null;
  }, []);
  const clear = useCallback(() => {
    cancel();
    setState({ data: null, pending: false, error: null });
  }, [cancel]);
  const run = useCallback(async (
    task: (signal: AbortSignal) => Promise<T>,
    accept: ((data: T) => void) | undefined,
    keep: boolean,
  ): Promise<void> => {
    cancel();
    const ticket = epoch.current;
    const controller = new AbortController();
    active.current = controller;
    setState(previous => ({ data: keep ? previous.data : null, pending: true, error: null }));
    try {
      const data = await task(controller.signal);
      if (controller.signal.aborted || ticket !== epoch.current) return;
      setState({ data, pending: false, error: null });
      accept?.(data);
    } catch (error: unknown) {
      if (controller.signal.aborted || ticket !== epoch.current) return;
      setState(previous => ({ data: keep ? previous.data : null, pending: false, error: message(error) }));
    } finally {
      if (ticket === epoch.current) active.current = null;
    }
  }, [cancel]);
  useEffect(() => cancel, [cancel]);
  return { ...state, run, cancel, clear };
}

function RequestState({ job, label }: { job: Pick<Load<unknown>, 'pending' | 'error'>; label: string }) {
  return <div className='request-state' aria-live='polite'>
    {job.pending && <p role='status'>{label}…</p>}
    {job.error && <p role='alert' className='notice error'>{job.error}</p>}
  </div>;
}
function refKey(ref: C.Ref): string { return `${ref.id}@${ref.revision}`; }
function sameRefs(left: readonly C.Ref[], right: readonly C.Ref[]): boolean {
  const a = left.map(refKey).sort();
  const b = right.map(refKey).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className='field'><dt>{label}</dt><dd>{children ?? 'Not recorded'}</dd></div>;
}
function Texts({ values }: { values: readonly string[] }) {
  return values.length ? <ul className='text-list'>{values.map((value, index) => <li key={index}>{value}</li>)}</ul> : <span className='muted'>None reported</span>;
}
function RefButton({ value, inspect }: { value: C.Ref; inspect: Inspect }) {
  return <button type='button' className='ref-button' onClick={() => inspect(value)} aria-label={`Inspect exact revision ${refKey(value)}`}>
    <code>{value.id}</code><span>revision {value.revision}</span>
  </button>;
}
function Refs({ label, values, inspect }: { label: string; values: readonly C.Ref[]; inspect: Inspect }) {
  return <section className='ref-group'><h4>{label}</h4>
    {values.length ? <ul className='refs'>{values.map((value, index) => <li key={`${refKey(value)}:${index}`}><RefButton value={value} inspect={inspect} /></li>)}</ul> : <p className='muted'>None reported</p>}
  </section>;
}
function Attribution({ value, inspect }: { value: C.Provenance; inspect: Inspect }) {
  return <details className='attribution' open>
    <summary>Contributor and recorder</summary>
    <dl>
      <Field label='Contributor'>{value.contributor.id} · {value.contributor.kind}</Field>
      <Field label='Recorder'>{value.recorder.id} · {value.recorder.kind}</Field>
      <Field label='Input identifier'><code>{value.input}</code></Field>
      <Field label='Host receipt time'>{value.recordedAt}</Field>
    </dl>
    <Refs label='Captured input receipt' values={[new C.Ref(value.input, 1)]} inspect={inspect} />
    <p className='fine-print'>Attribution is not a verification of the content.</p>
  </details>;
}
function kindOf(content: C.Content): string {
  return content.$type.slice(content.$type.lastIndexOf('#') + 1);
}
function semanticKind(content: C.Content): string {
  if (content instanceof C.Content_Outcome) return 'Intent · Outcome';
  if (content instanceof C.Content_Constraint) return 'Constraint';
  if (content instanceof C.Content_Task) return 'Reported work · Task';
  if (content instanceof C.Content_Defect) return 'Reported work · Defect';
  if (content instanceof C.Content_Source || content instanceof C.Content_Artifact || content instanceof C.Content_Statement) return `Evidence · ${kindOf(content)}`;
  return kindOf(content);
}
function ApplicabilityView({ value, inspect }: { value: C.Applicability; inspect: Inspect }) {
  if (value instanceof C.Applicability_Captured) return <section className='inset'><strong>Captured occurrence context</strong><Refs label='Exact capture' values={[value.source]} inspect={inspect} /><p className='fine-print'>Capture origin does not establish the applicability of the captured claims or commands.</p></section>;
  const unresolved = value instanceof C.Applicability_Unresolved;
  const text = unresolved ? value.reason : value.statement;
  return <section className={unresolved ? 'inset warning' : 'inset'}><strong>{unresolved ? 'Applicability unresolved' : 'Declared applicability — not verified'}</strong><p className='record-text'>{text}</p><Refs label='Applicability basis' values={value.basis} inspect={inspect} /><h4>Exact context anchors</h4>{value.context.length === 0 ? <p className='muted'>None declared. This is not universal scope.</p> : value.context.map((anchor, index) => <div key={index}><span>{anchor instanceof C.ApplicabilityContext_Capture ? 'Consuming capture context: ' : 'Relevant subject: '}</span><RefButton value={anchor instanceof C.ApplicabilityContext_Capture ? anchor.source : anchor.ref} inspect={inspect} /></div>)}<p className='fine-print'>An access namespace, declaration, or metadata match is not a Human mandate or execution permission.</p></section>;
}
function ContentDetails({ value, inspect }: { value: C.Content; inspect: Inspect }) {
  let detail: ReactNode = null;
  if (value instanceof C.Content_Outcome || value instanceof C.Content_Task) {
    detail = <>
      <dl><Field label={value instanceof C.Content_Outcome ? 'Force' : 'Execution requirement'}>{value instanceof C.Content_Outcome ? value.force : value.execution}</Field></dl>
      <h4>Acceptance clauses</h4><Texts values={value.acceptance.clauses} />
      <Refs label='Acceptance question' values={value.acceptance.question ? [value.acceptance.question] : []} inspect={inspect} />
    </>;
  } else if (value instanceof C.Content_Constraint) {
    detail = <dl><Field label='Polarity'>{value.polarity}</Field><Field label='Force'>{value.force}</Field></dl>;
  } else if (value instanceof C.Content_Statement) {
    detail = <dl><Field label='Modality'>{value.modality}</Field></dl>;
  } else if (value instanceof C.Content_Hypothesis) {
    detail = <dl><Field label='Prediction'>{value.prediction}</Field></dl>;
  } else if (value instanceof C.Content_Defect) {
    detail = <><dl><Field label='Observed account'>{value.observed}</Field><Field label='Expected'>{value.expected}</Field><Field label='Reproduction account'>{value.reproduction}</Field><Field label='Correction classification'>{value.correction}</Field></dl><Refs label='Affected references' values={value.affected} inspect={inspect} /></>;
  } else if (value instanceof C.Content_Question) {
    detail = <><h4>Alternatives</h4><Texts values={value.alternatives} /><dl><Field label='Recorded answer'>{value.answer}</Field><Field label='Escalation'>{value.escalation}</Field></dl></>;
  } else if (value instanceof C.Content_Decision) {
    detail = <><h4>Alternatives</h4><Texts values={value.alternatives} /><dl><Field label='Rationale'>{value.rationale}</Field></dl></>;
  } else if (value instanceof C.Content_Review) {
    detail = <><h4>Reported findings</h4><Texts values={value.findings} /><dl><Field label='Recorded assessment'>{value.assessment}</Field><Field label='Uncertainty'>{value.uncertainty}</Field></dl><Refs label='Review subjects' values={value.subjects} inspect={inspect} /><Refs label='Review basis' values={value.basis} inspect={inspect} /></>;
  } else if (value instanceof C.Content_Source) {
    detail = <><dl><Field label='Raw digest'><code>{value.rawDigest}</code></Field></dl><SourceDescriptorDetails value={value.descriptor} inspect={inspect} /><Refs label='Source context' values={value.context} inspect={inspect} /></>;
  } else if (value instanceof C.Content_Artifact) {
    detail = <dl><Field label='Digest'><code>{value.digest}</code></Field><Field label='Media type'>{value.mediaType}</Field><Field label='Recorded locator (not fetched)'>{value.locator}</Field><Field label='Artifact generation'>{value.generation.toString()}</Field></dl>;
  } else if (value instanceof C.Content_Conflict) {
    detail = <><dl><Field label='Recorded conflict status'>{value.status}</Field><Field label='Resolution'>{value.resolution}</Field><Field label='Uncertainty'>{value.uncertainty}</Field></dl><Refs label='Conflict subjects' values={value.subjects} inspect={inspect} /></>;
  }
  return <><p className='record-text'>{value.text}</p>{detail}</>;
}
function RelationDetails({ value, inspect }: { value: C.RelationDetail; inspect: Inspect }) {
  if (value instanceof C.RelationDetail_Dependency) return <><dl><Field label='Gate'>{value.gate}</Field><Field label='Consumption'>{value.consumption}</Field><Field label='Applicability'>{value.applicability}</Field></dl><Refs label='Dependency event' values={value.event ? [value.event] : []} inspect={inspect} /></>;
  if (value instanceof C.RelationDetail_PlanRequirement) return <><dl><Field label='Plan requirement work context'>{value.workContext}</Field></dl><p className='fine-print'>Applies to a selected current Decision binding in this work context, not every alternative or context. Selection is not readiness or permission.</p></>;
  if (value instanceof C.RelationDetail_Decomposition) return <dl><Field label='Grouping'>{value.grouping}</Field></dl>;
  if (value instanceof C.RelationDetail_Delegation) return <><h4>Recorded delegation actors</h4><Texts values={value.actors} /><h4>Recorded operations</h4><Texts values={value.operations} /><Refs label='Delegated outcomes' values={value.outcomes} inspect={inspect} /><p className='fine-print'>Displaying a delegation is not permission to execute it.</p></>;
  if (value instanceof C.RelationDetail_AssessmentUse) return <><dl><Field label='Declared assessment use'>{value.disposition}</Field></dl><Refs label='Exact requirement' values={[value.requirement]} inspect={inspect} /><Refs label='Applicability-use basis' values={value.basis} inspect={inspect} /><p className='fine-print'>Applicability use is an attributed account, not a truth or permission certificate. Exclusion does not refute the original assessment.</p></>;
  if (value instanceof C.RelationDetail_Adoption) return <><dl><Field label='Presentation identifier'><code>{value.presentationId}</code></Field><Field label='Adoption origin'>{value.origin}</Field><Field label='Exact presented selection'>{selectionLabel(value.selection)}</Field></dl><Refs label='Linked response Source' values={[value.response]} inspect={inspect} /><Refs label='Presented target' values={[value.selection.target]} inspect={inspect} />{value.selection instanceof C.PresentedSelection_Alternative && <Refs label='Exact alternative definition' values={[value.selection.definition]} inspect={inspect} />}<p className='fine-print'>An attributed interpretation is not a captured Human act; neither grants execution permission or proves physical Human presence.</p></>;
  return null;
}
function recordTitle(record: C.GraphRecord): string {
  if (record instanceof C.GraphRecord_Node) return semanticKind(record.value.content);
  if (record instanceof C.GraphRecord_Edge) return `Relation · ${record.value.kind}`;
  if (record instanceof C.GraphRecord_Contract) return 'Binding · context';
  if (record instanceof C.GraphRecord_Progress) return `Reported state · ${record.value.phase}`;
  if (record instanceof C.GraphRecord_Selection) return `Selection event · ${record.value.selected ? 'selected' : 'retired'}`;
  if (record instanceof C.GraphRecord_Input) return `Input receipt · ${record.value.kind}`;
  return `Actor record · ${record.value.value.kind}`;
}
function RecordDetails({ record, inspect }: { record: C.GraphRecord; inspect: Inspect }) {
  if (record instanceof C.GraphRecord_Node) {
    const value = record.value;
    return <><ApplicabilityView value={value.applicability} inspect={inspect} /><ContentDetails value={value.content} inspect={inspect} /><Refs label='Definition basis' values={value.basis} inspect={inspect} />{value.changeReason !== undefined && <dl><Field label='Change reason'>{value.changeReason}</Field></dl>}</>;
  }
  if (record instanceof C.GraphRecord_Edge) {
    const value = record.value;
    return <><ApplicabilityView value={value.applicability} inspect={inspect} /><p className='record-text'>{value.why}</p><Refs label='Relation sources' values={value.sources} inspect={inspect} /><Refs label='Relation targets' values={value.targets} inspect={inspect} /><RelationDetails value={value.detail} inspect={inspect} /></>;
  }
  if (record instanceof C.GraphRecord_Contract) {
    const value = record.value;
    return <><dl><Field label='Declared work context'>{value.workContext}</Field></dl><Refs label='Bound definition' values={[value.definition]} inspect={inspect} /><Refs label='Binding context' values={value.context} inspect={inspect} /><p className='fine-print'>A retained binding is not evidence that it remains valid in the current view.</p></>;
  }
  if (record instanceof C.GraphRecord_Progress) {
    const value = record.value;
    return <><dl><Field label='Reported phase'>{value.phase}</Field><Field label='Reported result'>{value.result}</Field><Field label='Resolution account'>{value.resolution}</Field><Field label='Uncertainty'>{value.uncertainty}</Field></dl><Refs label='State subject' values={[value.subject]} inspect={inspect} /><Refs label='Previous state event' values={value.previous ? [value.previous] : []} inspect={inspect} /><Refs label='State evidence' values={value.evidence} inspect={inspect} /><Refs label='Recorded gate evidence' values={value.gateBasis.references} inspect={inspect} /><Refs label='Selected-contract witnesses' values={value.gateBasis.selectionWitnesses} inspect={inspect} /><p className='fine-print'>This is a reported state event, not an independent finding of task completion.</p></>;
  }
  if (record instanceof C.GraphRecord_Selection) {
    const value = record.value;
    return <><p className='record-text'>{value.reason}</p><Refs label='Selection binding' values={[value.binding]} inspect={inspect} /><Refs label='Selection basis' values={value.basis} inspect={inspect} /><p className='fine-print'>This is an append-only selection account. Later replacement or retirement may supersede it. Selection is not execution permission; retirement is not task cancellation.</p></>;
  }
  if (record instanceof C.GraphRecord_Input) {
    const value = record.value;
    return <><dl><Field label='Encoding'>{value.encoding}</Field><Field label='Contributor'>{value.contributor.id} · {value.contributor.kind}</Field><Field label='Recorder'>{value.recorder.id} · {value.recorder.kind}</Field><Field label='Authenticated submitter'>{value.submitter.id} · {value.submitter.kind}</Field><Field label='Graph generation'>{value.generation.toString()}</Field><Field label='Content digest'><code>{value.digest}</code></Field><Field label='Recorded at'>{value.recordedAt}</Field></dl><h4>Contribution context</h4><ContextDetails value={value.contributionContext} /><h4>Actual server ingress</h4><TraceDetails value={value.ingress} /><pre>{value.content}</pre><p className='fine-print'>This retained input is not an independent truth, approval, or execution-permission certificate.</p></>;
  }
  return <><dl><Field label='Actor identifier'>{record.value.value.id}</Field><Field label='Recorded actor kind'>{record.value.value.kind}</Field></dl><p className='fine-print'>A graph actor record is not the authenticated browser identity and does not verify other records.</p></>;
}
function RecordCard({ record, inspect, action }: { record: C.GraphRecord; inspect: Inspect; action?: ReactNode }) {
  return <article className='record-card'>
    <header className='card-heading'><h3>{recordTitle(record)}</h3>{(record instanceof C.GraphRecord_Node || record instanceof C.GraphRecord_Edge) && <span className='badge'>Standing: {record.value.standing}</span>}</header>
    <RefButton value={record.value.ref} inspect={inspect} />
    {action}
    <RecordDetails record={record} inspect={inspect} />
    {!(record instanceof C.GraphRecord_Person) && !(record instanceof C.GraphRecord_Input) && <Attribution value={record.value.provenance} inspect={inspect} />}
  </article>;
}

function Modal({ title, children, onClose, closeLabel }: { title: string; children: ReactNode; onClose: () => void; closeLabel: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className='dialog-heading'><h2 id={titleId}>{title}</h2><button type='button' autoFocus onClick={onClose}>{closeLabel}</button></header>
    {children}
  </dialog>;
}

function Inspector({ client, scope, trail, inspect, back, close }: { client: ApiClient; scope: string; trail: C.Ref[]; inspect: Inspect; back: () => void; close: () => void }) {
  const target = trail[trail.length - 1];
  const result = useLoad<C.ReadResult>();
  const targetId = target?.id;
  const targetRevision = target?.revision;
  const load = useCallback((cursor?: string, generation?: bigint) => {
    if (targetId === undefined || targetRevision === undefined) return;
    return result.run(async signal => {
      const value = await client.post('read', new C.ReadRequest(scope, C.ReadView.History, [new C.Ref(targetId, targetRevision)], cursor, 100), C.ReadRequest.jsonCodec(), C.ReadResult.jsonCodec(), signal);
      if (value.scope !== scope) throw new Error('The inspection response belongs to another scope.');
      if (generation !== undefined && value.generation !== generation) throw new Error('The graph generation changed between inspection pages. Reload this exact reference; pages have not been combined.');
      return value;
    }, undefined, cursor !== undefined);
  }, [client, scope, targetId, targetRevision, result.run]);
  useEffect(() => { void load(); return result.cancel; }, [load, result.cancel]);
  if (!target) return null;
  return <Modal title='Inspect exact historical reference' closeLabel='Close' onClose={close}>
    <p><code>{refKey(target)}</code></p>
    <p className='muted'>History lookup only. Following basis, context, and source references does not alter your review snapshot or rationale.</p>
    <div className='toolbar'><button type='button' onClick={back} disabled={trail.length < 2}>Back in inspection</button><button type='button' onClick={() => void load()} disabled={result.pending}>Reload exact reference</button></div>
    <RequestState job={result} label='Reading exact reference' />
    {result.data && <><p className='fine-print'>Response generation {result.data.generation.toString()}. The requested revision remains exact.</p>
      {!result.data.records.length && <p className='notice warning'>No records returned for this exact reference. It may be unavailable or not visible to this identity.</p>}
      <div className='card-list'>{result.data.records.map((record, index) => <RecordCard key={`${refKey(record.value.ref)}:${index}`} record={record} inspect={inspect} />)}</div>
      {result.data.cursor !== undefined && <button type='button' disabled={result.pending} onClick={() => void load(result.data?.cursor, result.data?.generation)}>Next inspection page</button>}
    </>}
  </Modal>;
}

function Browser({ client, scope, mode, search, selection, locked, canReview, inspect, select }: { client: ApiClient; scope: string; mode: BrowseMode; search: SearchSpec; selection: Selection | null; locked: boolean; canReview: boolean; inspect: Inspect; select: (ref: C.Ref, generation: bigint) => void }) {
  const page = useLoad<Page>();
  const [pageNumber, setPageNumber] = useState(1);
  const load = useCallback((cursor: string | undefined, expected: bigint | undefined, number: number) => {
    return page.run(async signal => {
      let next: Page;
      if (mode === 'search') {
        const value = await client.post('find', new C.FindRequest(scope, search.kind, search.query, cursor, 24), C.FindRequest.jsonCodec(), C.FindResult.jsonCodec(), signal);
        if (value.scope !== scope) throw new Error('Search response scope mismatch.');
        next = { generation: value.generation, records: [], hits: value.items, cursor: value.cursor };
      } else {
        const value = await client.post('read', new C.ReadRequest(scope, mode === 'history' ? C.ReadView.History : C.ReadView.Current, [], cursor, 24), C.ReadRequest.jsonCodec(), C.ReadResult.jsonCodec(), signal);
        if (value.scope !== scope) throw new Error('Record response scope mismatch.');
        next = { generation: value.generation, records: value.records, hits: [], cursor: value.cursor };
      }
      if (expected !== undefined && next.generation !== expected) throw new Error('Generation changed between pages. This page was rejected; revisions have not been mixed. Return to the first page for a new snapshot.');
      return next;
    }, () => setPageNumber(number), true);
  }, [client, scope, mode, search, page.run]);
  useEffect(() => { void load(undefined, undefined, 1); return page.cancel; }, [load, page.cancel]);
  const data = page.data;
  const selectControl = (ref: C.Ref, generation: bigint) => <label className='selection-control'>
    <input type='checkbox' checked={selection?.refs.some(value => refKey(value) === refKey(ref)) ?? false} disabled={!canReview || locked || (selection !== null && selection.generation !== generation)} onChange={() => select(ref, generation)} />
    Include exact revision in review
  </label>;
  return <section aria-label='Ontology records'>
    <div className='toolbar spread'><h2>{mode === 'history' ? 'Retained history' : mode === 'search' ? 'Definition search results' : 'Current records'}</h2><button type='button' disabled={page.pending || selection !== null || locked} onClick={() => void load(undefined, undefined, 1)}>First page / refresh</button></div>
    <p className='fine-print'>Current views can omit invalid bindings and progress; history retains records. Absence from a current view is not erasure. Records describe reported work and interpretations, not established truth.</p>
    <RequestState job={page} label='Loading records' />
    {data && <>
      <p className='page-caption'>Generation <strong>{data.generation.toString()}</strong> · page {pageNumber} · {mode === 'search' ? 'literal definition search; inspect exact hits for attribution' : mode}</p>
      {selection && selection.generation !== data.generation && <p className='notice warning'>Your selected references belong to generation {selection.generation.toString()}. Selection from this different generation is disabled.</p>}
      {!data.records.length && !data.hits.length && <p className='empty'>No records returned for this view.</p>}
      <div className='card-list'>
        {data.records.map((record, index) => <RecordCard key={`${refKey(record.value.ref)}:${index}`} record={record} inspect={inspect} action={selectControl(record.value.ref, data.generation)} />)}
        {data.hits.map((hit, index) => <article className='record-card' key={`${refKey(hit.ref)}:${index}`}><header className='card-heading'><h3>{hit.kind}</h3><span className='badge'>Standing: {hit.standing}</span></header><RefButton value={hit.ref} inspect={inspect} /><p className='record-text'>{hit.text}</p><ApplicabilityView value={hit.applicability} inspect={inspect} /><p className='fine-print'>Search excerpt. Inspect this exact reference for contributor, recorder, and basis.</p>{selectControl(hit.ref, data.generation)}</article>)}
      </div>
      <div className='toolbar'><button type='button' disabled={page.pending || data.cursor === undefined} onClick={() => void load(data.cursor, data.generation, pageNumber + 1)}>Next page</button><span className='fine-print'>Pages replace one another; they are never merged across generations.</span></div>
    </>}
  </section>;
}

function ObservationDetails({ value, inspect }: { value: C.Observation; inspect: Inspect }) {
  if (value instanceof C.Observation_FileVersion) return <dl><Field label='Reported file path'>{value.path}</Field><Field label='Reported file generation'>{value.generation.toString()}</Field><Field label='Digest'><code>{value.digest}</code></Field><Field label='Length'>{value.length.toString()}</Field></dl>;
  if (value instanceof C.Observation_FileAbsent) return <dl><Field label='Reported file absence'>{value.path}</Field><Field label='Reported generation'>{value.generation.toString()}</Field></dl>;
  if (value instanceof C.Observation_Execution) return <><dl><Field label='Reported action'>{value.action}</Field><Field label='Reported checker'>{value.checker}</Field><Field label='Exit code'>{value.exitCode === undefined ? 'Not recorded' : value.exitCode}</Field><Field label='Capture reports complete'>{value.complete ? 'Yes (reported)' : 'No (reported)'}</Field></dl><Refs label='Observation contract' values={value.contract ? [value.contract] : []} inspect={inspect} /><Refs label='Execution input artifacts' values={value.inputs} inspect={inspect} /><Refs label='Execution output artifacts' values={value.outputs} inspect={inspect} /><p className='fine-print'>Observed outputs do not establish successful execution, Task completion, causality or acceptance.</p></>;
  return <p className='muted'>No structured observation reported.</p>;
}
function SourceDescriptorDetails({ value, inspect }: { value: C.SourceDescriptor; inspect: Inspect }) {
  if (value instanceof C.SourceDescriptor_PrimaryCapture) return <><dl><Field label='Captured event identifier'><code>{value.eventId}</code></Field></dl><CaptureDetails context={value.captureContext} metadata={value.metadata} sourceNamespace={value.sourceNamespace} origin={value.origin} observation={value.observation} inspect={inspect} />{value.reviewResponse && <><h4>Protected review-response linkage</h4><dl><Field label='Presentation identifier'><code>{value.reviewResponse.presentationId}</code></Field><Field label='Judgment identifier'><code>{value.reviewResponse.judgmentId}</code></Field></dl><Refs label='Published presentation Source' values={[value.reviewResponse.presentationSource]} inspect={inspect} /></>}</>;
  return <><h4>Derived presentation Source — not a primary event</h4><dl><Field label='Presentation identifier'><code>{value.presentationId}</code></Field><Field label='Original presented generation'>{value.generation.toString()}</Field><Field label='Prepared at'>{value.preparedAt}</Field><Field label='Payload digest'><code>{value.payloadDigest}</code></Field></dl><TraceDetails value={value.preparationTrace} /><p className='fine-print'>Retained offered content, not proof of Human perception, adoption or execution permission.</p></>;
}
function TraceDetails({ value }: { value: C.RequestTrace }) {
  return <dl><Field label='Host request identifier'><code>{value.hostRequestId}</code></Field><Field label='Ingress operation'>{value.operation}</Field><Field label='Ingress transport'>{value.transport}</Field></dl>;
}
function ContextDetails({ value }: { value: C.ContextRecord }) {
  const origin = value.origin;
  const native = origin instanceof C.OriginContext_ReportedNative ? origin.context : undefined;
  return <section className='inset'>
    {origin instanceof C.OriginContext_Unknown && <><strong>Context unknown</strong><p>{origin.reason}</p><p className='fine-print'>No session, branch, epoch or lineage is inferred.</p></>}
    {origin instanceof C.OriginContext_ServiceRequest && <><strong>Server-owned request context</strong><TraceDetails value={origin.trace} /></>}
    {native && <><strong>Reported native context — not independently observed</strong><dl><Field label='Lineage status'>{native.lineage}</Field><Field label='Session identifier'>{native.sessionId}</Field><Field label='Root session identifier'>{native.rootSessionId ?? 'Not recorded — not inferred'}</Field><Field label='Parent session identifier'>{native.parentSessionId ?? 'Not recorded — not inferred'}</Field><Field label='Branch'>{native.branch}</Field><Field label='Epoch'><code>{native.epoch}</code></Field></dl><p className='fine-print'>{native.lineage === C.LineageStatus.Unknown ? 'Lineage Unknown: ancestry is not established. No root is guessed from the session or source identifier.' : 'Lineage Recorded describes supplied metadata, not independent verification of ancestry or authorship.'}</p></>}
    <h4>Reported inherited cuts</h4>
    {value.reportedInherited.length === 0 && <p className='muted'>None reported — inheritance is not inferred.</p>}
    {value.reportedInherited.map((cut, index) => <div key={index}>
      <dl><Field label='Reported inheritance kind'>{cut.kind}</Field><Field label='Source access namespace'>{cut.sourceScope}</Field><Field label='Source generation'>{cut.generation.toString()}</Field><Field label='Captured source frontier'>{cut.sourceFrontier.toString()}</Field><Field label='Covered source frontier'>{cut.coveredFrontier.toString()}</Field></dl>
      <h4>Exact binding references in source namespace</h4><Texts values={cut.bindingRefs.map(refKey)} />
      <h4>Exact source references in source namespace</h4><Texts values={cut.sourceRefs.map(refKey)} />
      {cut.anchor ? <dl><Field label='Reported anchor kind'>{cut.anchor instanceof C.InheritanceAnchor_ReportedParent ? 'Parent' : 'Epoch'}</Field><Field label='Anchor source'><code>{refKey(cut.anchor.source)}</code></Field><Field label='Reported source epoch'><code>{cut.anchor.epoch}</code></Field></dl> : <p>No native linkage anchor reported.</p>}
    </div>)}
    <p className='fine-print'>Claim consistency is not proof of actual inheritance, Human intent, semantic applicability or execution permission. Inherited references retain their source namespace.</p>
  </section>;
}
function CaptureDetails({ context, metadata, sourceNamespace, origin, observation, inspect }: { context: C.ContextRecord; metadata: C.CaptureMetadata; sourceNamespace: string; origin: C.EventOrigin; observation: C.Observation; inspect: Inspect }) {
  return <>
    <dl><Field label='Source credential namespace'>{sourceNamespace}</Field><Field label='Recorded event role'>{origin}</Field><Field label='Source format / representation'>{metadata.representation}</Field><Field label='Source identifier'>{metadata.sourceId}</Field><Field label='Parent source identifier'>{metadata.parentSourceId ?? 'Not recorded — not inferred'}</Field><Field label='Source-claimed observation time'>{metadata.observedAt ?? 'Not recorded'}</Field></dl>
    <h4>Reported omissions</h4><Texts values={metadata.omissions} />
    <h4>Reported context candidates</h4><Texts values={metadata.exposedDeliveries} /><p className='fine-print'>Candidate references do not establish provider dispatch or model use.</p>
    <p className='notice warning'>Format and an empty omissions list do not prove full fidelity or native Human authorship. UserMessage is an event role, not an authenticated Human identity. Source-claimed observation time is not an authenticated measurement time.</p>
    <h4>Source occurrence context and lineage qualifications</h4>
    <ContextDetails value={context} />
    <h4>Structured observation</h4><ObservationDetails value={observation} inspect={inspect} />
  </>;
}
function CapturedSource({ event, inspect }: { event: C.CapturedEvent; inspect: Inspect }) {
  return <details className='record-card'>
    <summary><strong>{event.origin}</strong> · frontier {event.frontier.toString()} · <code>{event.id}</code></summary>
    <p className='record-text'>{event.text}</p>
    <CaptureDetails context={event.context} metadata={event.metadata} sourceNamespace={event.sourceNamespace} origin={event.origin} observation={event.observation} inspect={inspect} />
    <Attribution value={event.provenance} inspect={inspect} />
  </details>;
}
function SourcesPane({ client, scope, inspect }: { client: ApiClient; scope: string; inspect: Inspect }) {
  const sources = useLoad<C.SourceResult>();
  const [pageNumber, setPageNumber] = useState(1);
  const load = (after: bigint, frontier: bigint | undefined, number: number) => sources.run(async signal => {
    const value = await client.post('sources', new C.SourceRequest(scope, after, 24), C.SourceRequest.jsonCodec(), C.SourceResult.jsonCodec(), signal);
    if (value.scope !== scope) throw new Error('Captured-source response scope mismatch.');
    if (frontier !== undefined && value.frontier !== frontier) throw new Error('The captured-source frontier changed between pages. Reload the first source page; results have not been combined.');
    return value;
  }, () => setPageNumber(number), true);
  return <section className='panel' aria-labelledby='sources-heading'>
    <div className='toolbar spread'><h2 id='sources-heading'>Captured sources</h2><button type='button' disabled={sources.pending} onClick={() => void load(0n, undefined, 1)}>{sources.data ? 'Reload first source page' : 'Load captured sources'}</button></div>
    <p className='muted'>Source inspection leaves the selected review and rationale intact. Match Source event identifiers here; use exact reference links for retained source definitions and evidence.</p>
    <RequestState job={sources} label='Loading captured sources' />
    {sources.data && <><p className='page-caption'>Reported frontier {sources.data.frontier.toString()} · page {pageNumber}</p><div className='card-list'>{sources.data.events.map(event => <CapturedSource key={event.id} event={event} inspect={inspect} />)}</div>{!sources.data.events.length && <p className='empty'>No captured events returned on this page.</p>}<button type='button' disabled={sources.pending || sources.data.nextAfter === undefined} onClick={() => { if (sources.data?.nextAfter !== undefined) void load(sources.data.nextAfter, sources.data.frontier, pageNumber + 1); }}>Next source page</button></>}
  </section>;
}
function CurationAttemptView({ value }: { value: C.CurationAttemptSummary | undefined }) {
  if (value === undefined) return <p className='muted'>No curation attempt recorded.</p>;
  return <section className='inset'><h3>Pinned curation attempt</h3><dl>
    <Field label='Attempt identifier'><code>{value.attemptId}</code></Field><Field label='Attempt state'>{value.state}</Field>
    <Field label='Attempt base generation'>{value.baseGeneration.toString()}</Field><Field label='Attempt target frontier'>{value.frontier.toString()}</Field>
    <Field label='Attempt previous coverage'>{value.previousCoveredFrontier.toString()}</Field><Field label='Sealed input digest'>{value.inputDigest ?? 'Not sealed'}</Field>
    <Field label='Latest audit ordinal'>{value.lastOrdinal === undefined ? 'None recorded' : value.lastOrdinal}</Field><Field label='Latest audit stage'>{value.lastStage ?? 'None recorded'}</Field>
    <Field label='Terminal code'>{value.terminalCode ?? 'None recorded'}</Field><Field label='Audit uncertainty recorded'>{value.auditUncertain ? 'Yes' : 'No'}</Field>
    <Field label='Claimed at'>{value.claimedAt}</Field><Field label='Attempt admission deadline'>{value.deadlineAt}</Field><Field label='Finished at'>{value.finishedAt ?? 'Not recorded'}</Field>
    </dl><p className='fine-print'>The journal distinguishes request preparation, possible dispatch and an observed response. It does not prove provider receipt, model use or the absence of unrecorded activity.</p></section>;
}

function JudgmentsPane({ client, scope }: { client: ApiClient; scope: string }) {
  const judgments = useLoad<C.JudgmentsResult>();
  return <section className='panel' aria-labelledby='judgments-heading'>
    <div className='toolbar spread'><h2 id='judgments-heading'>Recorded Human judgments</h2><button type='button' disabled={judgments.pending} onClick={() => void judgments.run(async signal => {
      const result = await client.post('judgments', new C.ScopeRequest(scope), C.ScopeRequest.jsonCodec(), C.JudgmentsResult.jsonCodec(), signal);
      if (result.items.some(item => item.scope !== scope)) throw new Error('Judgment history scope mismatch.');
      return result;
    }, undefined, true)}>Load / refresh judgments</button></div>
    <p className='fine-print'>Judgments concern presented snapshots. They do not independently authorize execution or establish completion.</p>
    <RequestState job={judgments} label='Loading judgments' />
    {judgments.data && <>{!judgments.data.items.length && <p className='empty'>No judgments returned.</p>}<div className='card-list'>{judgments.data.items.map(value => <article className='record-card' key={value.id}><h3>{actionLabel(value.action)}</h3><dl><Field label='Judgment identifier'><code>{value.id}</code></Field><Field label='Presentation identifier'><code>{value.presentationId}</code></Field><Field label='Actor'>{value.actor.id} · {value.actor.kind}</Field><Field label='Recorded at'>{value.recordedAt}</Field></dl><p className='record-text'>{value.rationale}</p></article>)}</div></>}
  </section>;
}

function Workspace({ client, identity, scope, newRequestId, onDirty }: AppProps & { identity: C.Identity; scope: string; onDirty: (value: boolean) => void }) {
  const canReview = identity.actor.kind === C.ActorKind.Human && identity.capabilities.includes(C.Capability.Review);
  const [mode, setMode] = useState<BrowseMode>('current');
  const [searchText, setSearchText] = useState('');
  const [searchKind, setSearchKind] = useState<C.DefinitionKind | undefined>(undefined);
  const [search, setSearch] = useState<SearchSpec>({ query: '', kind: undefined });
  const [browserEpoch, setBrowserEpoch] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [inspection, setInspection] = useState<C.Ref[]>([]);
  const [exactId, setExactId] = useState('');
  const [exactRevision, setExactRevision] = useState('1');
  const [rationale, setRationale] = useState('');
  const [choice, setChoice] = useState<C.ReviewAction | null>(null);
  const [attempt, setAttempt] = useState<C.JudgmentRequest | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [statusObservedAt, setStatusObservedAt] = useState<string | null>(null);
  const status = useLoad<C.CurationStatus>();
  const presented = useLoad<C.Presentation>();
  const judged = useLoad<C.Judgment>();
  const pinnedPresent = useRef<C.PresentRequest | null>(null);
  const pinnedJudgment = useRef<C.JudgmentRequest | null>(null);
  const presenting = useRef(false);
  const submitting = useRef(false);
  const dirty = selection !== null || presented.data !== null || attempt !== null || rationale.length > 0;
  const locked = pinnedPresent.current !== null;
  const unresolved = attempt !== null && judged.data === null;
  const inspect: Inspect = ref => setInspection(previous => [...previous, ref]);

  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const refreshStatus = useCallback(() => status.run(async signal => {
    const value = await client.post('status', new C.ScopeRequest(scope), C.ScopeRequest.jsonCodec(), C.CurationStatus.jsonCodec(), signal);
    if (value.scope !== scope) throw new Error('The status response did not match the selected scope.');
    return value;
  }, () => setStatusObservedAt(new Date().toISOString()), true), [client, scope, status.run]);
  useEffect(() => {
    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 45000);
    return () => window.clearInterval(timer);
  }, [refreshStatus]);

  const select = (ref: C.Ref, generation: bigint) => {
    if (!canReview || locked) return;
    if (selection !== null && selection.generation !== generation) {
      setDraftError('Cannot mix selections from different graph generations. Explicitly discard this selection before choosing another generation.');
      return;
    }
    setDraftError(null);
    setSelection(previous => {
      if (previous === null) return { generation, refs: [ref] };
      const exists = previous.refs.some(value => refKey(value) === refKey(ref));
      const refs = exists ? previous.refs.filter(value => refKey(value) !== refKey(ref)) : [...previous.refs, ref];
      return refs.length ? { generation: previous.generation, refs } : null;
    });
  };
  const present = () => {
    if (!canReview || selection === null || presenting.current || presented.data !== null) return;
    const request = pinnedPresent.current ?? new C.PresentRequest(scope, [...selection.refs], selection.generation);
    pinnedPresent.current = request;
    presenting.current = true;
    void presented.run(async signal => {
      const value = await client.post('present', request, C.PresentRequest.jsonCodec(), C.Presentation.jsonCodec(), signal);
      if (value.payload.scope !== request.scope || value.payload.generation !== request.expectedGeneration || !sameRefs(value.payload.targets, request.targets) || value.owner.id !== identity.actor.id || value.owner.kind !== identity.actor.kind) throw new Error('The presentation did not match the pinned scope, generation, and exact targets. It cannot be judged.');
      return value;
    }, undefined, true).finally(() => { presenting.current = false; });
  };
  const submit = () => {
    if (!canReview || !presented.data || submitting.current || judged.data !== null) return;
    const retainedPresentation = presented.data;
    let request = pinnedJudgment.current;
    if (request === null) {
      if (choice === null || !rationale.trim()) return;
      try {
        request = new C.JudgmentRequest(scope, newRequestId(), presented.data.id, choice, rationale);
      } catch (error: unknown) {
        setDraftError(message(error));
        return;
      }
      pinnedJudgment.current = request;
      setAttempt(request);
    }
    // Never regenerate this id or payload after an unacknowledged submission.
    const immutableRequest = request;
    submitting.current = true;
    setDraftError(null);
    void judged.run(async signal => {
      const value = await client.post('judge', immutableRequest, C.JudgmentRequest.jsonCodec(), C.Judgment.jsonCodec(), signal);
      if (value.scope !== immutableRequest.scope || value.requestId !== immutableRequest.requestId || value.presentationId !== immutableRequest.presentationId || refKey(value.presentationSource) !== refKey(retainedPresentation.reservedSourceRef) || actionKey(value.action) !== actionKey(immutableRequest.action) || value.rationale !== immutableRequest.rationale || value.actor.id !== identity.actor.id || value.actor.kind !== C.ActorKind.Human) throw new Error('The judgment acknowledgement did not match this request and authenticated Human. Keep the pinned request and retry it; do not create a replacement act.');
      return value;
    }, undefined, true).finally(() => { submitting.current = false; });
  };
  const discard = () => {
    if (unresolved || presented.pending || judged.pending) return;
    presented.clear();
    judged.clear();
    pinnedPresent.current = null;
    pinnedJudgment.current = null;
    setAttempt(null);
    setSelection(null);
    setRationale('');
    setChoice(null);
    setDraftError(null);
    setConfirmDiscard(false);
  };
  const presentation = presented.data;
  const snapshot = presentation === null ? null : presentation.payload;
  const curation = status.data;
  return <>
    <section className='panel status-panel' aria-labelledby='status-heading'>
      <div className='toolbar spread'><h2 id='status-heading'>Scope status · {scope}</h2><button type='button' onClick={() => void refreshStatus()} disabled={status.pending}>Refresh status</button></div>
      <RequestState job={status} label='Checking scope status' />
      {curation && <><dl className='metrics'><Field label='Graph generation'>{curation.generation.toString()}</Field><Field label='Captured frontier'>{curation.frontier.toString()}</Field><Field label='Covered frontier'>{curation.coveredFrontier.toString()}</Field><Field label='Curation state'>{curation.state}</Field><Field label='Last curation publication generation'>{curation.lastPublicationGeneration === undefined ? 'None recorded' : curation.lastPublicationGeneration.toString()}</Field></dl>
        <CurationAttemptView value={curation.attempt} />
        <p className='fine-print'>Source coverage does not establish that later graph edits were reviewed. Attempt coordinates and the last publication remain separate from the current head.</p>
        {curation.failure !== undefined && <p className='notice error'>Curation failure: {curation.failure}</p>}
        <p className={curation.coveredFrontier < curation.frontier ? 'notice warning' : 'fine-print'}>{curation.coveredFrontier < curation.frontier ? 'The reported captured frontier is not fully covered by curation.' : curation.coveredFrontier === curation.frontier ? 'Coverage matches the reported frontier in this response. This is not a verification or a guarantee of present freshness.' : 'The reported coverage exceeds the frontier; these status values require investigation.'}</p>
        <p className='fine-print'>Observed in this browser: {statusObservedAt ?? 'unknown'}. Status is checked every 45 seconds; record pages and presentations do not silently refresh.</p>
      </>}
      {!curation && !status.pending && <p className='notice warning'>Status unavailable. No freshness or coverage claim can be made.</p>}
    </section>
    {!canReview && <p className='notice warning'>Read-only participation: review actions require both an authenticated Human-kind identity and the Review capability. Source roles and graph actor records cannot supply that authority. The server remains authoritative.</p>}
    <div className='workspace-grid'>
      <div className='browse-column'>
        <section className='panel controls' aria-labelledby='browse-heading'>
          <h2 id='browse-heading'>Explore records</h2>
          <label>Read view<select value={mode} disabled={dirty} onChange={event => { const value = event.target.value; if (value === 'current' || value === 'history' || value === 'search') { setInspection([]); setMode(value); } }}><option value='current'>Current</option><option value='history'>History</option><option value='search'>Definition search</option></select></label>
          <form className='search-form' onSubmit={event => { event.preventDefault(); if (dirty) return; setInspection([]); setSearch({ query: searchText, kind: searchKind }); setMode('search'); setBrowserEpoch(value => value + 1); }}>
            <label>Literal definition text<input type='search' value={searchText} disabled={dirty} onChange={event => setSearchText(event.target.value)} placeholder='Words or an exact text fragment' /></label>
            <label>Definition kind<select value={searchKind ?? ''} disabled={dirty} onChange={event => setSearchKind(C.DefinitionKind_values.find(value => value === event.target.value))}><option value=''>All definition kinds</option>{C.DefinitionKind_values.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <button type='submit' disabled={dirty}>Find definitions</button>
            <p className='fine-print'>Literal search, not a query language. Find has no current/history parameter; inspect each hit as an exact historical reference.</p>
          </form>
          {dirty && <p className='fine-print'>View and search changes are paused while a review is selected. Finish or explicitly discard it; source inspection remains available.</p>}
          <details><summary>Inspect an exact ID and revision</summary><form className='exact-form' onSubmit={event => { event.preventDefault(); const revision = Number(exactRevision); if (Number.isInteger(revision) && revision >= 1 && revision <= 2147483647) inspect(new C.Ref(exactId.trim(), revision)); }}><label>Reference UUID<input required pattern='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' value={exactId} onChange={event => setExactId(event.target.value)} spellCheck={false} /></label><label>Revision<input required type='number' min='1' max='2147483647' step='1' value={exactRevision} onChange={event => setExactRevision(event.target.value)} /></label><button type='submit'>Inspect history</button></form></details>
        </section>
        <div className='panel'><Browser key={`${mode}:${browserEpoch}`} client={client} scope={scope} mode={mode} search={search} selection={selection} locked={locked} canReview={canReview} inspect={inspect} select={select} /></div>
      </div>
      <aside className='panel review-panel' aria-labelledby='review-heading'>
        <p className='eyebrow'>Human participation</p><h2 id='review-heading'>Review a pinned snapshot</h2>
        <p className='notice warning'>A judgment concerns the presented snapshot. It is not execution permission, task completion, or proof that reported work is true.</p>
        {draftError && <p role='alert' className='notice error'>{draftError}</p>}
        {!selection && <p className='empty'>Select exact record revisions to prepare a review.</p>}
        {selection && <><p>Expected generation: <strong>{selection.generation.toString()}</strong></p><Refs label='Selected exact targets' values={selection.refs} inspect={inspect} />
          {curation && curation.generation !== selection.generation && <p className='notice warning'>Latest status reports generation {curation.generation.toString()}. This review remains pinned to {selection.generation.toString()}; neither its targets nor its presentation have been updated.</p>}
          {!snapshot && <button type='button' className='primary' disabled={!canReview || presented.pending} onClick={present}>{presented.error ? 'Retry the same presentation request' : 'Prepare exact presentation'}</button>}
        </>}
        <RequestState job={presented} label='Preparing pinned presentation' />
        {snapshot && presentation && <>
          <h3>Presented snapshot</h3>
          <dl><Field label='Presentation identifier'><code>{presentation.id}</code></Field><Field label='Scope'>{snapshot.scope}</Field><Field label='Generation'>{snapshot.generation.toString()}</Field><Field label='Created at'>{presentation.createdAt}</Field><Field label='Presentation owner'>{presentation.owner.id} · {presentation.owner.kind}</Field><Field label='Server-reported payload digest'><code>{presentation.payloadDigest}</code></Field><Field label='Reserved presentation Source'><code>{refKey(presentation.reservedSourceRef)}</code></Field></dl><p className='fine-print'>Preparation reserves this Source reference without publishing a graph record or primary event. A later linked Human action may publish the derived Source.</p>
          <Refs label='Returned exact targets' values={snapshot.targets} inspect={inspect} />
          <h4>Returned records ({snapshot.records.length})</h4>
          <div className='card-list compact'>{snapshot.records.map((record, index) => <details key={`${refKey(record.value.ref)}:${index}`}><summary>{recordTitle(record)} · <code>{refKey(record.value.ref)}</code></summary><RecordCard record={record} inspect={inspect} /></details>)}</div>
          {!snapshot.records.length && <p className='notice warning'>No records were returned in this presentation.</p>}
          <Refs label='Returned source references — inspect exact history' values={snapshot.sourceRefs} inspect={inspect} />
          <p className='fine-print'>Missing source references do not establish support. Source inspection does not replace this snapshot.</p>
          <form onSubmit={event => { event.preventDefault(); submit(); }}>
            <fieldset disabled={!canReview || attempt !== null || judged.pending || judged.data !== null}>
              <legend>Choose one explicit judgment</legend>
              <label className='choice'><input type='radio' name='judgment-kind' value={C.JudgmentKind.Accept} checked={choice instanceof C.ReviewAction_Review && choice.kind === C.JudgmentKind.Accept} onChange={() => setChoice(new C.ReviewAction_Review(C.JudgmentKind.Accept))} /><span><strong>Accept</strong><small>Accept this presented interpretation, without granting execution permission.</small></span></label>
              <label className='choice'><input type='radio' name='judgment-kind' value={C.JudgmentKind.RequestCorrection} checked={choice instanceof C.ReviewAction_Review && choice.kind === C.JudgmentKind.RequestCorrection} onChange={() => setChoice(new C.ReviewAction_Review(C.JudgmentKind.RequestCorrection))} /><span><strong>Request correction</strong><small>Identify what needs correcting in the presented snapshot.</small></span></label>
              <label className='choice'><input type='radio' name='judgment-kind' value={C.JudgmentKind.NeedEvidence} checked={choice instanceof C.ReviewAction_Review && choice.kind === C.JudgmentKind.NeedEvidence} onChange={() => setChoice(new C.ReviewAction_Review(C.JudgmentKind.NeedEvidence))} /><span><strong>Need evidence</strong><small>State what evidence or qualification is missing.</small></span></label>
              <label className='choice'><input type='radio' name='judgment-kind' value={C.JudgmentKind.ReviseIntent} checked={choice instanceof C.ReviewAction_Review && choice.kind === C.JudgmentKind.ReviseIntent} onChange={() => setChoice(new C.ReviewAction_Review(C.JudgmentKind.ReviseIntent))} /><span><strong>Revise intent</strong><small>Explain the desired change to intent; this does not directly edit graph definitions.</small></span></label>
              {snapshot.manifest.choices.map((selection, index) => {
                const action = new C.ReviewAction_Choose(selection);
                return <label className='choice' key={`choose-${index}`}><input type='radio' name='judgment-kind' checked={choice !== null && actionKey(choice) === actionKey(action)} onChange={() => setChoice(action)} /><span><strong>Choose {selectionLabel(selection)}</strong><small>Only this exact presented alternative or target; not execution permission.</small></span></label>;
              })}
              {snapshot.manifest.adoptionTargets.map(target => {
                const action = new C.ReviewAction_Adopt(target);
                return <label className='choice' key={`adopt-${refKey(target)}`}><input type='radio' name='judgment-kind' checked={choice !== null && actionKey(choice) === actionKey(action)} onChange={() => setChoice(action)} /><span><strong>Adopt presented target {refKey(target)}</strong><small>Explicit adoption of this exact presented Source or Binding; not execution permission.</small></span></label>;
              })}
              <label>Rationale<textarea required rows={6} value={rationale} onChange={event => setRationale(event.target.value)} placeholder='Explain your judgment of this specific snapshot.' /></label>
            </fieldset>
            {attempt === null && judged.data === null && <button type='submit' className='primary' disabled={!canReview || choice === null || !rationale.trim() || judged.pending || !snapshot.records.length}>Submit Human judgment</button>}
          </form>
        </>}
        <RequestState job={judged} label='Awaiting judgment acknowledgement' />
        {unresolved && attempt && <div className='notice warning'><h3>Acknowledgement unresolved</h3><p>The server may already have recorded this act. No success is assumed. Keep this tab open; do not create a replacement judgment.</p><p>Request ID: <code>{attempt.requestId}</code></p><p>The complete action, rationale, presentation, and request ID are locked. A retry resends this same operation.</p><button type='button' disabled={judged.pending || !canReview} onClick={submit}>Retry same judgment</button></div>}
        {judged.data && <div role='status' className='receipt'><h3>Judgment acknowledged by the server</h3><dl><Field label='Judgment identifier'><code>{judged.data.id}</code></Field><Field label='Request identifier'><code>{attempt?.requestId}</code></Field><Field label='Action'>{actionLabel(judged.data.action)}</Field><Field label='Actor'>{judged.data.actor.id} · {judged.data.actor.kind}</Field><Field label='Recorded at'>{judged.data.recordedAt}</Field></dl><p className='fine-print'>This acknowledgement is not a task-completion or execution-authorization signal.</p></div>}
        {dirty && <button type='button' className='discard-button' disabled={unresolved || presented.pending || judged.pending} onClick={() => setConfirmDiscard(true)}>{judged.data ? 'Close acknowledged review…' : 'Discard selected review and rationale…'}</button>}
        <p className='fine-print'>Drafts stay in this tab only. Private sources, tokens, and rationales are not placed in URLs or local storage.</p>
      </aside>
    </div>
    <SourcesPane client={client} scope={scope} inspect={inspect} />
    <JudgmentsPane client={client} scope={scope} />
    {inspection.length > 0 && <Inspector client={client} scope={scope} trail={inspection} inspect={inspect} back={() => setInspection(previous => previous.slice(0, -1))} close={() => setInspection([])} />}
    {confirmDiscard && <Modal title={judged.data ? 'Close this acknowledged review?' : 'Discard this review draft?'} closeLabel='Keep review' onClose={() => setConfirmDiscard(false)}><p>{judged.data ? 'The server-recorded judgment remains. Closing clears this tab’s selection, presentation, choice, and rationale.' : 'This explicitly clears the selection, pinned presentation, choice, and rationale from this tab. It does not change graph records.'}</p><button type='button' onClick={discard}>{judged.data ? 'Close acknowledged review' : 'Discard draft'}</button></Modal>}
  </>;
}

export default function App({ client, newRequestId }: AppProps) {
  const [identity, setIdentity] = useState<C.Identity | null>(null);
  const [token, setToken] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [scope, setScope] = useState('');
  const [dirty, setDirty] = useState(false);
  const authentication = useLoad<C.Identity>();
  const logout = useLoad<C.Ack>();
  const scopes = useLoad<C.ScopesResult>();
  const establish = useCallback((value: C.Identity) => {
    client.setActor(value.actor.id);
    setIdentity(value);
    setScope('');
  }, [client]);
  const checkIdentity = useCallback(() => authentication.run(signal => client.get('whoami', C.Identity.jsonCodec(), signal), establish, false), [client, authentication.run, establish]);
  useEffect(() => {
    client.setActor(null);
    void checkIdentity();
    return authentication.cancel;
  }, [client, checkIdentity, authentication.cancel]);
  useEffect(() => {
    if (!identity) return;
    void scopes.run(signal => client.get('scopes', C.ScopesResult.jsonCodec(), signal), undefined, false);
    return scopes.cancel;
  }, [client, identity, scopes.run, scopes.cancel]);
  const authenticate = (task: (signal: AbortSignal) => Promise<C.Identity>) => {
    const retained = identity;
    void authentication.run(async signal => {
      const value = await task(signal);
      if (retained !== null && (value.actor.id !== retained.actor.id || value.actor.kind !== retained.actor.kind)) throw new Error('The authenticated actor differs from the retained review identity. Restore the original actor; the pinned request has not been changed.');
      return value;
    }, value => {
      if (retained === null) establish(value);
      else { client.setActor(value.actor.id); setIdentity(value); }
      setRestoring(false);
    }, false);
  };
  const signOut = () => {
    if (dirty || logout.pending || authentication.pending) return;
    setScope('');
    setRestoring(false);
    setToken('');
    scopes.clear();
    void logout.run(async signal => {
      const acknowledgement = await client.post('logout', new C.Ack(true), C.Ack.jsonCodec(), C.Ack.jsonCodec(), signal);
      if (!acknowledgement.ok) throw new Error('Sign-out was not acknowledged. Retry sign-out.');
      return acknowledgement;
    }, () => {
      client.setActor(null);
      setIdentity(null);
      setToken('');
      setDirty(false);
      scopes.clear();
      authentication.clear();
    }, true);
  };
  return <>
    <a className='skip-link' href='#main'>Skip to content</a>
    <header className='app-header'><div><p className='eyebrow'>Ontology service</p><h1>Human review</h1><p className='muted'>Intent, constraints, reported work, and evidence — with explicit provenance.</p></div>
      {identity && <div className='identity'><strong>{identity.actor.id}</strong><span>Authenticated kind: {identity.actor.kind}</span><span className='fine-print'>Capabilities: {identity.capabilities.join(', ') || 'none'}</span><button type='button' disabled={dirty || logout.pending || authentication.pending} onClick={signOut}>{logout.error ? 'Retry sign-out' : 'Sign out'}</button><button type='button' disabled={logout.pending || authentication.pending} onClick={() => setRestoring(true)}>Restore session</button>{dirty && <small>Finish or explicitly discard the current review before changing identity.</small>}</div>}
    </header>
    <main id='main' tabIndex={-1}>
      <RequestState job={authentication} label='Checking authenticated identity' />
      <RequestState job={logout} label='Signing out' />
      {(!identity || restoring) && !logout.pending && <section className='panel login-panel' aria-labelledby='login-heading'><h2 id='login-heading'>{identity === null ? 'Connect your identity' : 'Restore original identity'}</h2><p>The server authenticates the actual actor. Enter a host-issued token, not a graph actor name.</p>{identity !== null && <p className='notice warning'>The review identity and any uncertain request are retained. The current session must be verified as {identity.actor.id}; no review is discarded or resubmitted by signing in.</p>}<form onSubmit={event => { event.preventDefault(); if (authentication.pending || !token) return; const submittedToken = token; setToken(''); logout.clear(); authenticate(async signal => (await client.post('login', new C.LoginRequest(submittedToken), C.LoginRequest.jsonCodec(), C.LoginResult.jsonCodec(), signal)).identity); }}><label>Host-issued token<input type='password' autoComplete='off' spellCheck={false} value={token} onChange={event => setToken(event.target.value)} required disabled={authentication.pending} /></label><div className='toolbar'><button type='submit' className='primary' disabled={authentication.pending || !token}>Sign in</button><button type='button' disabled={authentication.pending} onClick={() => authenticate(signal => client.get('whoami', C.Identity.jsonCodec(), signal))}>Check existing session</button></div></form><p className='fine-print'>The token is cleared from the form on submission. This client does not persist it.</p></section>}
      {identity && !logout.pending && <>
        <section className='panel scope-picker' aria-labelledby='scope-heading'><div><h2 id='scope-heading'>Access namespace</h2><label>Authorized scope<select value={scope} disabled={dirty || scopes.pending} onChange={event => setScope(event.target.value)}><option value=''>Choose a scope</option>{scopes.data?.items.map(value => <option key={value.scope} value={value.scope}>{value.scope}</option>)}</select></label></div><button type='button' disabled={dirty || scopes.pending} onClick={() => void scopes.run(signal => client.get('scopes', C.ScopesResult.jsonCodec(), signal), undefined, true)}>Refresh scope list</button><RequestState job={scopes} label='Loading authorized scopes' />{dirty && <p className='fine-print'>Scope is locked to protect the selected review. Source inspection is still available.</p>}{scopes.data && !scopes.data.items.length && <p className='empty'>No accessible scopes were returned.</p>}</section>
        {scope ? <Workspace key={`${identity.actor.id}:${scope}`} client={client} identity={identity} scope={scope} newRequestId={newRequestId} onDirty={setDirty} /> : <p className='empty'>Choose a scope to inspect records and prepare a review.</p>}
      </>}
    </main>
    <footer className='app-footer'>Human judgments are bound to presentations. This interface has no task-execution, administrative, or graph-editing controls.</footer>
  </>;
}
