import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Phase, Phase_JsonCodec} from './Phase.js'
import {Provenance, Provenance_JsonCodec} from './Provenance.js'
import {Ref, Ref_JsonCodec} from './Ref.js'
import {Resolution, Resolution_JsonCodec} from './Resolution.js'

export class StateEvent implements BaboonGeneratedLatest {
    private readonly _ref: Ref;
    private readonly _scope: string;
    private readonly _subject: Ref;
    private readonly _previous: Ref | undefined;
    private readonly _phase: Phase;
    private readonly _result: Resolution | undefined;
    private readonly _resolution: string | undefined;
    private readonly _evidence: Array<Ref>;
    private readonly _uncertainty: string;
    private readonly _provenance: Provenance;

    constructor(ref: Ref, scope: string, subject: Ref, previous: Ref | undefined, phase: Phase, result: Resolution | undefined, resolution: string | undefined, evidence: Array<Ref>, uncertainty: string, provenance: Provenance) {
        this._ref = ref
        this._scope = scope
        this._subject = subject
        this._previous = previous
        this._phase = phase
        this._result = result
        this._resolution = resolution
        this._evidence = evidence
        this._uncertainty = uncertainty
        this._provenance = provenance
    }

    public get ref(): Ref {
        return this._ref;
    }
    public get scope(): string {
        return this._scope;
    }
    public get subject(): Ref {
        return this._subject;
    }
    public get previous(): Ref | undefined {
        return this._previous;
    }
    public get phase(): Phase {
        return this._phase;
    }
    public get result(): Resolution | undefined {
        return this._result;
    }
    public get resolution(): string | undefined {
        return this._resolution;
    }
    public get evidence(): Array<Ref> {
        return this._evidence;
    }
    public get uncertainty(): string {
        return this._uncertainty;
    }
    public get provenance(): Provenance {
        return this._provenance;
    }

    public toJSON(): Record<string, unknown> {
        return {
            ref: this._ref,
            scope: this._scope,
            subject: this._subject,
            previous: this._previous !== undefined ? this._previous : undefined,
            phase: this._phase,
            result: this._result !== undefined ? this._result : undefined,
            resolution: this._resolution !== undefined ? this._resolution : undefined,
            evidence: this._evidence,
            uncertainty: this._uncertainty,
            provenance: this._provenance
        };
    }

    public with(overrides: {ref?: Ref; scope?: string; subject?: Ref; previous?: Ref | undefined; phase?: Phase; result?: Resolution | undefined; resolution?: string | undefined; evidence?: Array<Ref>; uncertainty?: string; provenance?: Provenance}): StateEvent {
        return new StateEvent(
            'ref' in overrides ? overrides.ref! : this._ref,
            'scope' in overrides ? overrides.scope! : this._scope,
            'subject' in overrides ? overrides.subject! : this._subject,
            'previous' in overrides ? overrides.previous! : this._previous,
            'phase' in overrides ? overrides.phase! : this._phase,
            'result' in overrides ? overrides.result! : this._result,
            'resolution' in overrides ? overrides.resolution! : this._resolution,
            'evidence' in overrides ? overrides.evidence! : this._evidence,
            'uncertainty' in overrides ? overrides.uncertainty! : this._uncertainty,
            'provenance' in overrides ? overrides.provenance! : this._provenance
        );
    }

    public static fromPlain(obj: {ref: Ref; scope: string; subject: Ref; previous: Ref | undefined; phase: Phase; result: Resolution | undefined; resolution: string | undefined; evidence: Array<Ref>; uncertainty: string; provenance: Provenance}): StateEvent {
        return new StateEvent(
            obj.ref,
            obj.scope,
            obj.subject,
            obj.previous,
            obj.phase,
            obj.result,
            obj.resolution,
            obj.evidence,
            obj.uncertainty,
            obj.provenance
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return StateEvent.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return StateEvent.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#StateEvent'
    public baboonTypeIdentifier() {
        return StateEvent.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return StateEvent.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return StateEvent.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return StateEvent.BaboonMinReaderVersions
    }
    public static jsonCodec(): StateEvent_JsonCodec {
        return StateEvent_JsonCodec.instance
    }
}

export class StateEvent_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: StateEvent): unknown {
        if (this !== StateEvent_JsonCodec.lazyInstance.value) {
          return StateEvent_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "ref": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.ref),
            "scope": value.scope,
            "subject": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.subject),
            "previous": value.previous === undefined ? null : Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.previous),
            "phase": Phase_JsonCodec.instance.encode(BaboonCodecContext.Default, value.phase),
            "result": value.result === undefined ? null : Resolution_JsonCodec.instance.encode(BaboonCodecContext.Default, value.result),
            "resolution": value.resolution === undefined ? null : value.resolution,
            "evidence": Array.from(value.evidence).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "uncertainty": value.uncertainty,
            "provenance": Provenance_JsonCodec.instance.encode(BaboonCodecContext.Default, value.provenance),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): StateEvent {
        if (this !== StateEvent_JsonCodec .lazyInstance.value) {
            return StateEvent_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new StateEvent (
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["ref"]),
            obj["scope"] as string,
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["subject"]),
            obj["previous"] === undefined || obj["previous"] === null ? undefined : obj["previous"] === undefined || obj["previous"] === null ? undefined : Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["previous"]),
            Phase_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["phase"]),
            obj["result"] === undefined || obj["result"] === null ? undefined : obj["result"] === undefined || obj["result"] === null ? undefined : Resolution_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["result"]),
            obj["resolution"] === undefined || obj["resolution"] === null ? undefined : obj["resolution"] === undefined || obj["resolution"] === null ? undefined : obj["resolution"] as string,
            (obj["evidence"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["uncertainty"] as string,
            Provenance_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["provenance"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return StateEvent_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return StateEvent_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#StateEvent'
    public baboonTypeIdentifier() {
        return StateEvent_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new StateEvent_JsonCodec())
    public static get instance(): StateEvent_JsonCodec {
        return StateEvent_JsonCodec.lazyInstance.value
    }
}