import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class IngestResult implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _requestId: string;
    private readonly _eventId: string;
    private readonly _sourceNamespace: string;
    private readonly _source: Ref;
    private readonly _artifacts: Array<Ref>;
    private readonly _frontier: bigint;
    private readonly _replayed: boolean;

    constructor(scope: string, requestId: string, eventId: string, sourceNamespace: string, source: Ref, artifacts: Array<Ref>, frontier: bigint, replayed: boolean) {
        this._scope = scope
        this._requestId = requestId
        this._eventId = eventId
        this._sourceNamespace = sourceNamespace
        this._source = source
        this._artifacts = artifacts
        this._frontier = frontier
        this._replayed = replayed
    }

    public get scope(): string {
        return this._scope;
    }
    public get requestId(): string {
        return this._requestId;
    }
    public get eventId(): string {
        return this._eventId;
    }
    public get sourceNamespace(): string {
        return this._sourceNamespace;
    }
    public get source(): Ref {
        return this._source;
    }
    public get artifacts(): Array<Ref> {
        return this._artifacts;
    }
    public get frontier(): bigint {
        return this._frontier;
    }
    public get replayed(): boolean {
        return this._replayed;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            requestId: this._requestId,
            eventId: this._eventId,
            sourceNamespace: this._sourceNamespace,
            source: this._source,
            artifacts: this._artifacts,
            frontier: this._frontier,
            replayed: this._replayed
        };
    }

    public with(overrides: {scope?: string; requestId?: string; eventId?: string; sourceNamespace?: string; source?: Ref; artifacts?: Array<Ref>; frontier?: bigint; replayed?: boolean}): IngestResult {
        return new IngestResult(
            'scope' in overrides ? overrides.scope! : this._scope,
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'eventId' in overrides ? overrides.eventId! : this._eventId,
            'sourceNamespace' in overrides ? overrides.sourceNamespace! : this._sourceNamespace,
            'source' in overrides ? overrides.source! : this._source,
            'artifacts' in overrides ? overrides.artifacts! : this._artifacts,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'replayed' in overrides ? overrides.replayed! : this._replayed
        );
    }

    public static fromPlain(obj: {scope: string; requestId: string; eventId: string; sourceNamespace: string; source: Ref; artifacts: Array<Ref>; frontier: bigint; replayed: boolean}): IngestResult {
        return new IngestResult(
            obj.scope,
            obj.requestId,
            obj.eventId,
            obj.sourceNamespace,
            obj.source,
            obj.artifacts,
            obj.frontier,
            obj.replayed
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return IngestResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return IngestResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#IngestResult'
    public baboonTypeIdentifier() {
        return IngestResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return IngestResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return IngestResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return IngestResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): IngestResult_JsonCodec {
        return IngestResult_JsonCodec.instance
    }
}

export class IngestResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: IngestResult): unknown {
        if (this !== IngestResult_JsonCodec.lazyInstance.value) {
          return IngestResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "requestId": value.requestId,
            "eventId": value.eventId,
            "sourceNamespace": value.sourceNamespace,
            "source": Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, value.source),
            "artifacts": Array.from(value.artifacts).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "frontier": value.frontier.toString(),
            "replayed": value.replayed,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): IngestResult {
        if (this !== IngestResult_JsonCodec .lazyInstance.value) {
            return IngestResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new IngestResult (
            obj["scope"] as string,
            obj["requestId"] as string,
            obj["eventId"] as string,
            obj["sourceNamespace"] as string,
            Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["source"]),
            (obj["artifacts"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            obj["replayed"] as boolean,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return IngestResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return IngestResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#IngestResult'
    public baboonTypeIdentifier() {
        return IngestResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new IngestResult_JsonCodec())
    public static get instance(): IngestResult_JsonCodec {
        return IngestResult_JsonCodec.lazyInstance.value
    }
}