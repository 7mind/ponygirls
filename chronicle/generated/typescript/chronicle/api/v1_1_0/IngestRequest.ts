import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'
import {Completion, Completion_JsonCodec} from './Completion.js'
import {Message, Message_JsonCodec} from './Message.js'
import {Metadata, Metadata_JsonCodec} from './Metadata.js'
import {RawFile, RawFile_JsonCodec} from './RawFile.js'
import {SourceIdentity, SourceIdentity_JsonCodec} from './SourceIdentity.js'

export class IngestRequest implements BaboonGenerated {
    private readonly _requestId: string;
    private readonly _source: SourceIdentity;
    private readonly _expectedRevision: number;
    private readonly _digest: string;
    private readonly _completion: Completion;
    private readonly _redacted: boolean;
    private readonly _metadata: Metadata;
    private readonly _messages: Array<Message>;
    private readonly _files: Array<RawFile>;

    constructor(requestId: string, source: SourceIdentity, expectedRevision: number, digest: string, completion: Completion, redacted: boolean, metadata: Metadata, messages: Array<Message>, files: Array<RawFile>) {
        this._requestId = requestId
        this._source = source
        this._expectedRevision = expectedRevision
        this._digest = digest
        this._completion = completion
        this._redacted = redacted
        this._metadata = metadata
        this._messages = messages
        this._files = files
    }

    public get requestId(): string {
        return this._requestId;
    }
    public get source(): SourceIdentity {
        return this._source;
    }
    public get expectedRevision(): number {
        return this._expectedRevision;
    }
    public get digest(): string {
        return this._digest;
    }
    public get completion(): Completion {
        return this._completion;
    }
    public get redacted(): boolean {
        return this._redacted;
    }
    public get metadata(): Metadata {
        return this._metadata;
    }
    public get messages(): Array<Message> {
        return this._messages;
    }
    public get files(): Array<RawFile> {
        return this._files;
    }

    public toJSON(): Record<string, unknown> {
        return {
            requestId: this._requestId,
            source: this._source,
            expectedRevision: this._expectedRevision,
            digest: this._digest,
            completion: this._completion,
            redacted: this._redacted,
            metadata: this._metadata,
            messages: this._messages,
            files: this._files
        };
    }

    public with(overrides: {requestId?: string; source?: SourceIdentity; expectedRevision?: number; digest?: string; completion?: Completion; redacted?: boolean; metadata?: Metadata; messages?: Array<Message>; files?: Array<RawFile>}): IngestRequest {
        return new IngestRequest(
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'source' in overrides ? overrides.source! : this._source,
            'expectedRevision' in overrides ? overrides.expectedRevision! : this._expectedRevision,
            'digest' in overrides ? overrides.digest! : this._digest,
            'completion' in overrides ? overrides.completion! : this._completion,
            'redacted' in overrides ? overrides.redacted! : this._redacted,
            'metadata' in overrides ? overrides.metadata! : this._metadata,
            'messages' in overrides ? overrides.messages! : this._messages,
            'files' in overrides ? overrides.files! : this._files
        );
    }

    public static fromPlain(obj: {requestId: string; source: SourceIdentity; expectedRevision: number; digest: string; completion: Completion; redacted: boolean; metadata: Metadata; messages: Array<Message>; files: Array<RawFile>}): IngestRequest {
        return new IngestRequest(
            obj.requestId,
            obj.source,
            obj.expectedRevision,
            obj.digest,
            obj.completion,
            obj.redacted,
            obj.metadata,
            obj.messages,
            obj.files
        );
    }

    public static readonly BaboonDomainVersion = '1.1.0'
    public baboonDomainVersion() {
        return IngestRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return IngestRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#IngestRequest'
    public baboonTypeIdentifier() {
        return IngestRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.7.0"]
    public baboonSameInVersions() {
        return IngestRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.1.0": "identical", "1.2.0": "identical", "1.3.0": "identical", "1.4.0": "identical", "1.5.0": "identical", "1.6.0": "identical", "1.7.0": "identical" }
    public baboonForwardReadable() {
        return IngestRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return IngestRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): IngestRequest_JsonCodec {
        return IngestRequest_JsonCodec.instance
    }
}

/** @deprecated Version 1.1.0 is deprecated, you should migrate to 1.7.0 */
export class IngestRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: IngestRequest): unknown {
        if (this !== IngestRequest_JsonCodec.lazyInstance.value) {
          return IngestRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "requestId": value.requestId,
            "source": SourceIdentity_JsonCodec.instance.encode(BaboonCodecContext.Default, value.source),
            "expectedRevision": value.expectedRevision,
            "digest": value.digest,
            "completion": Completion_JsonCodec.instance.encode(BaboonCodecContext.Default, value.completion),
            "redacted": value.redacted,
            "metadata": Metadata_JsonCodec.instance.encode(BaboonCodecContext.Default, value.metadata),
            "messages": Array.from(value.messages).map(item => Message_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
            "files": Array.from(value.files).map(item => RawFile_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): IngestRequest {
        if (this !== IngestRequest_JsonCodec .lazyInstance.value) {
            return IngestRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new IngestRequest (
            obj["requestId"] as string,
            SourceIdentity_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["source"]),
            obj["expectedRevision"] as number,
            obj["digest"] as string,
            Completion_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["completion"]),
            obj["redacted"] as boolean,
            Metadata_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["metadata"]),
            (obj["messages"] as unknown[]).map(item => Message_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
            (obj["files"] as unknown[]).map(item => RawFile_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '1.1.0'
    public baboonDomainVersion() {
        return IngestRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return IngestRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#IngestRequest'
    public baboonTypeIdentifier() {
        return IngestRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new IngestRequest_JsonCodec())
    public static get instance(): IngestRequest_JsonCodec {
        return IngestRequest_JsonCodec.lazyInstance.value
    }
}