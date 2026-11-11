import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, BaboonInt64, Lazy} from '../../BaboonSharedRuntime.js'
import {GraphRecord, GraphRecord_JsonCodec} from './GraphRecord.js'

export class ReadResult implements BaboonGeneratedLatest {
    private readonly _scope: string;
    private readonly _generation: bigint;
    private readonly _records: Array<GraphRecord>;
    private readonly _cursor: string | undefined;

    constructor(scope: string, generation: bigint, records: Array<GraphRecord>, cursor: string | undefined) {
        this._scope = scope
        this._generation = generation
        this._records = records
        this._cursor = cursor
    }

    public get scope(): string {
        return this._scope;
    }
    public get generation(): bigint {
        return this._generation;
    }
    public get records(): Array<GraphRecord> {
        return this._records;
    }
    public get cursor(): string | undefined {
        return this._cursor;
    }

    public toJSON(): Record<string, unknown> {
        return {
            scope: this._scope,
            generation: this._generation,
            records: this._records,
            cursor: this._cursor !== undefined ? this._cursor : undefined
        };
    }

    public with(overrides: {scope?: string; generation?: bigint; records?: Array<GraphRecord>; cursor?: string | undefined}): ReadResult {
        return new ReadResult(
            'scope' in overrides ? overrides.scope! : this._scope,
            'generation' in overrides ? overrides.generation! : this._generation,
            'records' in overrides ? overrides.records! : this._records,
            'cursor' in overrides ? overrides.cursor! : this._cursor
        );
    }

    public static fromPlain(obj: {scope: string; generation: bigint; records: Array<GraphRecord>; cursor: string | undefined}): ReadResult {
        return new ReadResult(
            obj.scope,
            obj.generation,
            obj.records,
            obj.cursor
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReadResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReadResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ReadResult'
    public baboonTypeIdentifier() {
        return ReadResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return ReadResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return ReadResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return ReadResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): ReadResult_JsonCodec {
        return ReadResult_JsonCodec.instance
    }
}

export class ReadResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ReadResult): unknown {
        if (this !== ReadResult_JsonCodec.lazyInstance.value) {
          return ReadResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "scope": value.scope,
            "generation": value.generation.toString(),
            "records": Array.from(value.records).map(item => GraphRecord_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "cursor": value.cursor === undefined ? null : value.cursor,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ReadResult {
        if (this !== ReadResult_JsonCodec .lazyInstance.value) {
            return ReadResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ReadResult (
            obj["scope"] as string,
            BaboonInt64.read(obj["generation"], "i64/u64"),
            (obj["records"] as unknown[]).map(item => GraphRecord_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] === undefined || obj["cursor"] === null ? undefined : obj["cursor"] as string,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return ReadResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return ReadResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#ReadResult'
    public baboonTypeIdentifier() {
        return ReadResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ReadResult_JsonCodec())
    public static get instance(): ReadResult_JsonCodec {
        return ReadResult_JsonCodec.lazyInstance.value
    }
}