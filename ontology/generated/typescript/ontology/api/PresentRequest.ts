import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class PresentRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _targets: Array<Ref>;
    private readonly _expectedGeneration: bigint;

    constructor(scope: string, targets: Array<Ref>, expectedGeneration: bigint) {
        this._scope = scope
        this._targets = targets
        this._expectedGeneration = expectedGeneration
    }

    public get scope(): string {
        return this._scope;
    }
    public get targets(): Array<Ref> {
        return this._targets;
    }
    public get expectedGeneration(): bigint {
        return this._expectedGeneration;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            targets: this._targets,
            expectedGeneration: this._expectedGeneration
        };
    }

    public with(overrides: {scope?: string; targets?: Array<Ref>; expectedGeneration?: bigint}): PresentRequest {
        return new PresentRequest(
            'scope' in overrides ? overrides.scope! : this._scope,
            'targets' in overrides ? overrides.targets! : this._targets,
            'expectedGeneration' in overrides ? overrides.expectedGeneration! : this._expectedGeneration
        );
    }

    public static fromPlain(obj: {scope: string; targets: Array<Ref>; expectedGeneration: bigint}): PresentRequest {
        return new PresentRequest(
            obj.scope,
            obj.targets,
            obj.expectedGeneration
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#PresentRequest'
    public baboonTypeIdentifier() {
        return PresentRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return PresentRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return PresentRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return PresentRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): PresentRequest_JsonCodec {
        return PresentRequest_JsonCodec.instance
    }
}

export class PresentRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: PresentRequest): unknown {
        if (this !== PresentRequest_JsonCodec.lazyInstance.value) {
          return PresentRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "targets": Array.from(value.targets).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "expectedGeneration": value.expectedGeneration.toString(),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): PresentRequest {
        if (this !== PresentRequest_JsonCodec .lazyInstance.value) {
            return PresentRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new PresentRequest (
            obj["scope"] as string,
            (obj["targets"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            BaboonInt64.read(obj["expectedGeneration"], "i64/u64"),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return PresentRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return PresentRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#PresentRequest'
    public baboonTypeIdentifier() {
        return PresentRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new PresentRequest_JsonCodec())
    public static get instance(): PresentRequest_JsonCodec {
        return PresentRequest_JsonCodec.lazyInstance.value
    }
}