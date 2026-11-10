import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class ScopeRequest implements BaboonGeneratedLatest {
    private readonly _scope: string;

    constructor(scope: string) {
        this._scope = scope
    }

    public get scope(): string {
        return this._scope;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope
        };
    }

    public with(overrides: {scope?: string}): ScopeRequest {
        return new ScopeRequest(
            'scope' in overrides ? overrides.scope! : this._scope
        );
    }

    public static fromPlain(obj: {scope: string}): ScopeRequest {
        return new ScopeRequest(
            obj.scope
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ScopeRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ScopeRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ScopeRequest'
    public baboonTypeIdentifier() {
        return ScopeRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ScopeRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ScopeRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ScopeRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): ScopeRequest_JsonCodec {
        return ScopeRequest_JsonCodec.instance
    }
}

export class ScopeRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ScopeRequest): unknown {
        if (this !== ScopeRequest_JsonCodec.lazyInstance.value) {
          return ScopeRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ScopeRequest {
        if (this !== ScopeRequest_JsonCodec .lazyInstance.value) {
            return ScopeRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ScopeRequest (
            obj["scope"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ScopeRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ScopeRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ScopeRequest'
    public baboonTypeIdentifier() {
        return ScopeRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ScopeRequest_JsonCodec())
    public static get instance(): ScopeRequest_JsonCodec {
        return ScopeRequest_JsonCodec.lazyInstance.value
    }
}