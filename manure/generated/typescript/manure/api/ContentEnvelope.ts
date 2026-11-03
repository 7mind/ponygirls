import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ContentCommand, ContentCommand_JsonCodec} from './ContentCommand.js'

export class ContentEnvelope implements BaboonGeneratedLatest {
    private readonly _requestId: string;
    private readonly _apiVersion: string;
    private readonly _command: ContentCommand;

    constructor(requestId: string, apiVersion: string, command: ContentCommand) {
        this._requestId = requestId
        this._apiVersion = apiVersion
        this._command = command
    }

    public get requestId(): string {
        return this._requestId;
    }
    public get apiVersion(): string {
        return this._apiVersion;
    }
    public get command(): ContentCommand {
        return this._command;
    }

    public toJSON(): Record<string, unknown> {
        return {
            requestId: this._requestId,
            apiVersion: this._apiVersion,
            command: this._command
        };
    }

    public with(overrides: {requestId?: string; apiVersion?: string; command?: ContentCommand}): ContentEnvelope {
        return new ContentEnvelope(
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'apiVersion' in overrides ? overrides.apiVersion! : this._apiVersion,
            'command' in overrides ? overrides.command! : this._command
        );
    }

    public static fromPlain(obj: {requestId: string; apiVersion: string; command: ContentCommand}): ContentEnvelope {
        return new ContentEnvelope(
            obj.requestId,
            obj.apiVersion,
            obj.command
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ContentEnvelope.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ContentEnvelope.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ContentEnvelope'
    public baboonTypeIdentifier() {
        return ContentEnvelope.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ContentEnvelope.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ContentEnvelope.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ContentEnvelope.BaboonMinReaderVersions
    }
    public static jsonCodec(): ContentEnvelope_JsonCodec {
        return ContentEnvelope_JsonCodec.instance
    }
}

export class ContentEnvelope_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ContentEnvelope): unknown {
        if (this !== ContentEnvelope_JsonCodec.lazyInstance.value) {
          return ContentEnvelope_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "requestId": value.requestId,
            "apiVersion": value.apiVersion,
            "command": ContentCommand_JsonCodec.instance.encode(BaboonCodecContext.Default, value.command),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ContentEnvelope {
        if (this !== ContentEnvelope_JsonCodec .lazyInstance.value) {
            return ContentEnvelope_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ContentEnvelope (
            obj["requestId"] as string,
            obj["apiVersion"] as string,
            ContentCommand_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["command"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ContentEnvelope_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ContentEnvelope_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ContentEnvelope'
    public baboonTypeIdentifier() {
        return ContentEnvelope_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ContentEnvelope_JsonCodec())
    public static get instance(): ContentEnvelope_JsonCodec {
        return ContentEnvelope_JsonCodec.lazyInstance.value
    }
}