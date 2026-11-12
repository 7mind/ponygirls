import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CapturedEvent, CapturedEvent_JsonCodec} from './CapturedEvent.js'

export class SourceResult implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _events: Array<CapturedEvent>;
    private readonly _frontier: bigint;
    private readonly _nextAfter: bigint | undefined;

    constructor(scope: string, events: Array<CapturedEvent>, frontier: bigint, nextAfter: bigint | undefined) {
        this._scope = scope
        this._events = events
        this._frontier = frontier
        this._nextAfter = nextAfter
    }

    public get scope(): string {
        return this._scope;
    }
    public get events(): Array<CapturedEvent> {
        return this._events;
    }
    public get frontier(): bigint {
        return this._frontier;
    }
    public get nextAfter(): bigint | undefined {
        return this._nextAfter;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            events: this._events,
            frontier: this._frontier,
            nextAfter: this._nextAfter !== undefined ? this._nextAfter : undefined
        };
    }

    public with(overrides: {scope?: string; events?: Array<CapturedEvent>; frontier?: bigint; nextAfter?: bigint | undefined}): SourceResult {
        return new SourceResult(
            'scope' in overrides ? overrides.scope! : this._scope,
            'events' in overrides ? overrides.events! : this._events,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'nextAfter' in overrides ? overrides.nextAfter! : this._nextAfter
        );
    }

    public static fromPlain(obj: {scope: string; events: Array<CapturedEvent>; frontier: bigint; nextAfter: bigint | undefined}): SourceResult {
        return new SourceResult(
            obj.scope,
            obj.events,
            obj.frontier,
            obj.nextAfter
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SourceResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return SourceResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#SourceResult'
    public baboonTypeIdentifier() {
        return SourceResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return SourceResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return SourceResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return SourceResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): SourceResult_JsonCodec {
        return SourceResult_JsonCodec.instance
    }
}

export class SourceResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SourceResult): unknown {
        if (this !== SourceResult_JsonCodec.lazyInstance.value) {
          return SourceResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "events": Array.from(value.events).map(item => CapturedEvent_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "frontier": value.frontier.toString(),
            "nextAfter": value.nextAfter === undefined ? null : value.nextAfter.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SourceResult {
        if (this !== SourceResult_JsonCodec .lazyInstance.value) {
            return SourceResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SourceResult (
            obj["scope"] as string,
            (obj["events"] as unknown[]).map(item => CapturedEvent_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            obj["nextAfter"] === undefined || obj["nextAfter"] === null ? undefined : obj["nextAfter"] === undefined || obj["nextAfter"] === null ? undefined : BaboonInt64.read(obj["nextAfter"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SourceResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return SourceResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#SourceResult'
    public baboonTypeIdentifier() {
        return SourceResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SourceResult_JsonCodec())
    public static get instance(): SourceResult_JsonCodec {
        return SourceResult_JsonCodec.lazyInstance.value
    }
}