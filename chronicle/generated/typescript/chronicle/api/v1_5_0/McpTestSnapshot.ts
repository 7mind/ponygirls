import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../../BaboonSharedRuntime.js'
import {Failure, Failure_JsonCodec} from './Failure.js'
import {McpTestEvent, McpTestEvent_JsonCodec} from './McpTestEvent.js'
import {McpTestState, McpTestState_JsonCodec} from './McpTestState.js'

export class McpTestSnapshot implements BaboonGenerated {
    private readonly _instanceId: string;
    private readonly _runId: string;
    private readonly _state: McpTestState;
    private readonly _observedAt: string;
    private readonly _events: Array<McpTestEvent>;
    private readonly _lastSequence: bigint;
    private readonly _hasMore: boolean;
    private readonly _failure: Failure | undefined;

    constructor(instanceId: string, runId: string, state: McpTestState, observedAt: string, events: Array<McpTestEvent>, lastSequence: bigint, hasMore: boolean, failure: Failure | undefined) {
        this._instanceId = instanceId
        this._runId = runId
        this._state = state
        this._observedAt = observedAt
        this._events = events
        this._lastSequence = lastSequence
        this._hasMore = hasMore
        this._failure = failure
    }

    public get instanceId(): string {
        return this._instanceId;
    }
    public get runId(): string {
        return this._runId;
    }
    public get state(): McpTestState {
        return this._state;
    }
    public get observedAt(): string {
        return this._observedAt;
    }
    public get events(): Array<McpTestEvent> {
        return this._events;
    }
    public get lastSequence(): bigint {
        return this._lastSequence;
    }
    public get hasMore(): boolean {
        return this._hasMore;
    }
    public get failure(): Failure | undefined {
        return this._failure;
    }

    public toJSON(): Record<string, unknown> {
        return {
            instanceId: this._instanceId,
            runId: this._runId,
            state: this._state,
            observedAt: this._observedAt,
            events: this._events,
            lastSequence: this._lastSequence,
            hasMore: this._hasMore,
            failure: this._failure !== undefined ? this._failure : undefined
        };
    }

    public with(overrides: {instanceId?: string; runId?: string; state?: McpTestState; observedAt?: string; events?: Array<McpTestEvent>; lastSequence?: bigint; hasMore?: boolean; failure?: Failure | undefined}): McpTestSnapshot {
        return new McpTestSnapshot(
            'instanceId' in overrides ? overrides.instanceId! : this._instanceId,
            'runId' in overrides ? overrides.runId! : this._runId,
            'state' in overrides ? overrides.state! : this._state,
            'observedAt' in overrides ? overrides.observedAt! : this._observedAt,
            'events' in overrides ? overrides.events! : this._events,
            'lastSequence' in overrides ? overrides.lastSequence! : this._lastSequence,
            'hasMore' in overrides ? overrides.hasMore! : this._hasMore,
            'failure' in overrides ? overrides.failure! : this._failure
        );
    }

    public static fromPlain(obj: {instanceId: string; runId: string; state: McpTestState; observedAt: string; events: Array<McpTestEvent>; lastSequence: bigint; hasMore: boolean; failure: Failure | undefined}): McpTestSnapshot {
        return new McpTestSnapshot(
            obj.instanceId,
            obj.runId,
            obj.state,
            obj.observedAt,
            obj.events,
            obj.lastSequence,
            obj.hasMore,
            obj.failure
        );
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return McpTestSnapshot.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestSnapshot.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#McpTestSnapshot'
    public baboonTypeIdentifier() {
        return McpTestSnapshot.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return McpTestSnapshot.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return McpTestSnapshot.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.4.0", "prefix-compact": "1.4.0", "prefix-any-mode": "1.4.0", "identical": "1.4.0" }
    public baboonMinReaderVersions() {
        return McpTestSnapshot.BaboonMinReaderVersions
    }
    public static jsonCodec(): McpTestSnapshot_JsonCodec {
        return McpTestSnapshot_JsonCodec.instance
    }
}

/** @deprecated Version 1.5.0 is deprecated, you should migrate to 1.7.0 */
export class McpTestSnapshot_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: McpTestSnapshot): unknown {
        if (this !== McpTestSnapshot_JsonCodec.lazyInstance.value) {
          return McpTestSnapshot_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "instanceId": value.instanceId,
            "runId": value.runId,
            "state": McpTestState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "observedAt": value.observedAt,
            "events": Array.from(value.events).map(item => McpTestEvent_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "lastSequence": value.lastSequence.toString(),
            "hasMore": value.hasMore,
            "failure": value.failure === undefined ? null : Failure_JsonCodec.instance.encode(BaboonCodecContext.Default, value.failure),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): McpTestSnapshot {
        if (this !== McpTestSnapshot_JsonCodec .lazyInstance.value) {
            return McpTestSnapshot_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new McpTestSnapshot (
            obj["instanceId"] as string,
            obj["runId"] as string,
            McpTestState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]),
            obj["observedAt"] as string,
            (obj["events"] as unknown[]).map(item => McpTestEvent_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            BaboonInt64.read(obj["lastSequence"], "i64/u64"),
            obj["hasMore"] as boolean,
            obj["failure"] === undefined || obj["failure"] === null ? undefined : obj["failure"] === undefined || obj["failure"] === null ? undefined : Failure_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["failure"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.5.0'
    public baboonDomainVersion() {
        return McpTestSnapshot_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return McpTestSnapshot_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#McpTestSnapshot'
    public baboonTypeIdentifier() {
        return McpTestSnapshot_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new McpTestSnapshot_JsonCodec())
    public static get instance(): McpTestSnapshot_JsonCodec {
        return McpTestSnapshot_JsonCodec.lazyInstance.value
    }
}