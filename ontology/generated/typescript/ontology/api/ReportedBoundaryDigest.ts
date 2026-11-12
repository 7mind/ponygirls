import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'

export class ReportedBoundaryDigest implements BaboonGeneratedLatest {
    private readonly _encoding: string;
    private readonly _digest: string;

    constructor(encoding: string, digest: string) {
        this._encoding = encoding
        this._digest = digest
    }

    public get encoding(): string {
        return this._encoding;
    }
    public get digest(): string {
        return this._digest;
    }

    public toJSON(): Record<string, unknown> {
        return {
            encoding: this._encoding,
            digest: this._digest
        };
    }

    public with(overrides: {encoding?: string; digest?: string}): ReportedBoundaryDigest {
        return new ReportedBoundaryDigest(
            'encoding' in overrides ? overrides.encoding! : this._encoding,
            'digest' in overrides ? overrides.digest! : this._digest
        );
    }

    public static fromPlain(obj: {encoding: string; digest: string}): ReportedBoundaryDigest {
        return new ReportedBoundaryDigest(
            obj.encoding,
            obj.digest
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReportedBoundaryDigest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReportedBoundaryDigest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ReportedBoundaryDigest'
    public baboonTypeIdentifier() {
        return ReportedBoundaryDigest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ReportedBoundaryDigest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ReportedBoundaryDigest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ReportedBoundaryDigest.BaboonMinReaderVersions
    }
    public static jsonCodec(): ReportedBoundaryDigest_JsonCodec {
        return ReportedBoundaryDigest_JsonCodec.instance
    }
}

export class ReportedBoundaryDigest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ReportedBoundaryDigest): unknown {
        if (this !== ReportedBoundaryDigest_JsonCodec.lazyInstance.value) {
          return ReportedBoundaryDigest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "encoding": value.encoding,
            "digest": value.digest,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ReportedBoundaryDigest {
        if (this !== ReportedBoundaryDigest_JsonCodec .lazyInstance.value) {
            return ReportedBoundaryDigest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ReportedBoundaryDigest (
            obj["encoding"] as string,
            obj["digest"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReportedBoundaryDigest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReportedBoundaryDigest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ReportedBoundaryDigest'
    public baboonTypeIdentifier() {
        return ReportedBoundaryDigest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ReportedBoundaryDigest_JsonCodec())
    public static get instance(): ReportedBoundaryDigest_JsonCodec {
        return ReportedBoundaryDigest_JsonCodec.lazyInstance.value
    }
}