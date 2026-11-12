import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {CurationRecordPin, CurationRecordPin_JsonCodec} from './CurationRecordPin.js'
import {CurationSourcePin, CurationSourcePin_JsonCodec} from './CurationSourcePin.js'

export class CurationInputManifest implements BaboonGeneratedLatest {
    private readonly _attemptId: string;
    private readonly _seed: Array<CurationRecordPin>;
    private readonly _sources: Array<CurationSourcePin>;
    private readonly _encoding: string;
    private readonly _inputDigest: string;
    private readonly _inputBytes: bigint;
    private readonly _sealedAt: string;

    constructor(attemptId: string, seed: Array<CurationRecordPin>, sources: Array<CurationSourcePin>, encoding: string, inputDigest: string, inputBytes: bigint, sealedAt: string) {
        this._attemptId = attemptId
        this._seed = seed
        this._sources = sources
        this._encoding = encoding
        this._inputDigest = inputDigest
        this._inputBytes = inputBytes
        this._sealedAt = sealedAt
    }

    public get attemptId(): string {
        return this._attemptId;
    }
    public get seed(): Array<CurationRecordPin> {
        return this._seed;
    }
    public get sources(): Array<CurationSourcePin> {
        return this._sources;
    }
    public get encoding(): string {
        return this._encoding;
    }
    public get inputDigest(): string {
        return this._inputDigest;
    }
    public get inputBytes(): bigint {
        return this._inputBytes;
    }
    public get sealedAt(): string {
        return this._sealedAt;
    }

    public toJSON(): Record<string, unknown> {
        return {
            attemptId: this._attemptId,
            seed: this._seed,
            sources: this._sources,
            encoding: this._encoding,
            inputDigest: this._inputDigest,
            inputBytes: this._inputBytes,
            sealedAt: this._sealedAt
        };
    }

    public with(overrides: {attemptId?: string; seed?: Array<CurationRecordPin>; sources?: Array<CurationSourcePin>; encoding?: string; inputDigest?: string; inputBytes?: bigint; sealedAt?: string}): CurationInputManifest {
        return new CurationInputManifest(
            'attemptId' in overrides ? overrides.attemptId! : this._attemptId,
            'seed' in overrides ? overrides.seed! : this._seed,
            'sources' in overrides ? overrides.sources! : this._sources,
            'encoding' in overrides ? overrides.encoding! : this._encoding,
            'inputDigest' in overrides ? overrides.inputDigest! : this._inputDigest,
            'inputBytes' in overrides ? overrides.inputBytes! : this._inputBytes,
            'sealedAt' in overrides ? overrides.sealedAt! : this._sealedAt
        );
    }

    public static fromPlain(obj: {attemptId: string; seed: Array<CurationRecordPin>; sources: Array<CurationSourcePin>; encoding: string; inputDigest: string; inputBytes: bigint; sealedAt: string}): CurationInputManifest {
        return new CurationInputManifest(
            obj.attemptId,
            obj.seed,
            obj.sources,
            obj.encoding,
            obj.inputDigest,
            obj.inputBytes,
            obj.sealedAt
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationInputManifest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationInputManifest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationInputManifest'
    public baboonTypeIdentifier() {
        return CurationInputManifest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CurationInputManifest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CurationInputManifest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CurationInputManifest.BaboonMinReaderVersions
    }
    public static jsonCodec(): CurationInputManifest_JsonCodec {
        return CurationInputManifest_JsonCodec.instance
    }
}

export class CurationInputManifest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CurationInputManifest): unknown {
        if (this !== CurationInputManifest_JsonCodec.lazyInstance.value) {
          return CurationInputManifest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "attemptId": value.attemptId,
            "seed": Array.from(value.seed).map(item => CurationRecordPin_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "sources": Array.from(value.sources).map(item => CurationSourcePin_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "encoding": value.encoding,
            "inputDigest": value.inputDigest,
            "inputBytes": value.inputBytes.toString(),
            "sealedAt": value.sealedAt,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CurationInputManifest {
        if (this !== CurationInputManifest_JsonCodec .lazyInstance.value) {
            return CurationInputManifest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CurationInputManifest (
            obj["attemptId"] as string,
            (obj["seed"] as unknown[]).map(item => CurationRecordPin_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["sources"] as unknown[]).map(item => CurationSourcePin_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["encoding"] as string,
            obj["inputDigest"] as string,
            BaboonInt64.read(obj["inputBytes"], "i64/u64"),
            obj["sealedAt"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CurationInputManifest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CurationInputManifest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CurationInputManifest'
    public baboonTypeIdentifier() {
        return CurationInputManifest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CurationInputManifest_JsonCodec())
    public static get instance(): CurationInputManifest_JsonCodec {
        return CurationInputManifest_JsonCodec.lazyInstance.value
    }
}