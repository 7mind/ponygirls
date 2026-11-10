import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CurationState, CurationState_JsonCodec} from './CurationState.js'

export class CurationStatus implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _generation: bigint;
    private readonly _frontier: bigint;
    private readonly _coveredFrontier: bigint;
    private readonly _state: CurationState;
    private readonly _failure: string | undefined;

    constructor(scope: string, generation: bigint, frontier: bigint, coveredFrontier: bigint, state: CurationState, failure: string | undefined) {
        this._scope = scope
        this._generation = generation
        this._frontier = frontier
        this._coveredFrontier = coveredFrontier
        this._state = state
        this._failure = failure
    }

    public get scope(): string {
        return this._scope;
    }
    public get generation(): bigint {
        return this._generation;
    }
    public get frontier(): bigint {
        return this._frontier;
    }
    public get coveredFrontier(): bigint {
        return this._coveredFrontier;
    }
    public get state(): CurationState {
        return this._state;
    }
    public get failure(): string | undefined {
        return this._failure;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            generation: this._generation,
            frontier: this._frontier,
            coveredFrontier: this._coveredFrontier,
            state: this._state,
            failure: this._failure !== undefined ? this._failure : undefined
        };
    }

    public with(overrides: {scope?: string; generation?: bigint; frontier?: bigint; coveredFrontier?: bigint; state?: CurationState; failure?: string | undefined}): CurationStatus {
        return new CurationStatus(
            'scope' in overrides ? overrides.scope! : this._scope,
            'generation' in overrides ? overrides.generation! : this._generation,
            'frontier' in overrides ? overrides.frontier! : this._frontier,
            'coveredFrontier' in overrides ? overrides.coveredFrontier! : this._coveredFrontier,
            'state' in overrides ? overrides.state! : this._state,
            'failure' in overrides ? overrides.failure! : this._failure
        );
    }

    public static fromPlain(obj: {scope: string; generation: bigint; frontier: bigint; coveredFrontier: bigint; state: CurationState; failure: string | undefined}): CurationStatus {
        return new CurationStatus(
            obj.scope,
            obj.generation,
            obj.frontier,
            obj.coveredFrontier,
            obj.state,
            obj.failure
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationStatus.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationStatus.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationStatus'
    public baboonTypeIdentifier() {
        return CurationStatus.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationStatus.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationStatus.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationStatus.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationStatus_JsonCodec {
        return CurationStatus_JsonCodec.instance
    }
}

export class CurationStatus_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationStatus): unknown {
        if (this !== CurationStatus_JsonCodec.lazyInstance.value) {
          return CurationStatus_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "generation": value.generation.toString(),
            "frontier": value.frontier.toString(),
            "coveredFrontier": value.coveredFrontier.toString(),
            "state": CurationState_JsonCodec.instance.encode(BaboonCodecContext.Default, value.state),
            "failure": value.failure === undefined ? null : value.failure,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationStatus {
        if (this !== CurationStatus_JsonCodec .lazyInstance.value) {
            return CurationStatus_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationStatus (
            obj["scope"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            BaboonInt64.read(obj["frontier"], "i64/u64"),
            BaboonInt64.read(obj["coveredFrontier"], "i64/u64"),
            CurationState_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["state"]),
            obj["failure"] === undefined || obj["failure"] === null ? undefined : obj["failure"] === undefined || obj["failure"] === null ? undefined : obj["failure"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationStatus_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationStatus_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationStatus'
    public baboonTypeIdentifier() {
        return CurationStatus_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationStatus_JsonCodec())
    public static get instance(): CurationStatus_JsonCodec {
        return CurationStatus_JsonCodec.lazyInstance.value
    }
}