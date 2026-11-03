import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Command, Command_JsonCodec} from './Command.js'

export class ClientEnvelope implements BaboonGeneratedLatest {
    private readonly _requestId: string;
    private readonly _apiVersion: string;
    private readonly _command: Command;

    constructor(requestId: string, apiVersion: string, command: Command) {
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
    public get command(): Command {
        return this._command;
    }

    public toJSON(): Record<string, unknown> {
        return {
            requestId: this._requestId,
            apiVersion: this._apiVersion,
            command: this._command
        };
    }

    public with(overrides: {requestId?: string; apiVersion?: string; command?: Command}): ClientEnvelope {
        return new ClientEnvelope(
            'requestId' in overrides ? overrides.requestId! : this._requestId,
            'apiVersion' in overrides ? overrides.apiVersion! : this._apiVersion,
            'command' in overrides ? overrides.command! : this._command
        );
    }

    public static fromPlain(obj: {requestId: string; apiVersion: string; command: Command}): ClientEnvelope {
        return new ClientEnvelope(
            obj.requestId,
            obj.apiVersion,
            obj.command
        );
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ClientEnvelope.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ClientEnvelope.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ClientEnvelope'
    public baboonTypeIdentifier() {
        return ClientEnvelope.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0"]
    public baboonSameInVersions() {
        return ClientEnvelope.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.0.0": "identical" }
    public baboonForwardReadable() {
        return ClientEnvelope.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return ClientEnvelope.BaboonMinReaderVersions
    }
    public static jsonCodec(): ClientEnvelope_JsonCodec {
        return ClientEnvelope_JsonCodec.instance
    }
}

export class ClientEnvelope_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ClientEnvelope): unknown {
        if (this !== ClientEnvelope_JsonCodec.lazyInstance.value) {
          return ClientEnvelope_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "requestId": value.requestId,
            "apiVersion": value.apiVersion,
            "command": Command_JsonCodec.instance.encode(BaboonCodecContext.Default, value.command),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ClientEnvelope {
        if (this !== ClientEnvelope_JsonCodec .lazyInstance.value) {
            return ClientEnvelope_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new ClientEnvelope (
            obj["requestId"] as string,
            obj["apiVersion"] as string,
            Command_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["command"]),
        )
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ClientEnvelope_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ClientEnvelope_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ClientEnvelope'
    public baboonTypeIdentifier() {
        return ClientEnvelope_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ClientEnvelope_JsonCodec())
    public static get instance(): ClientEnvelope_JsonCodec {
        return ClientEnvelope_JsonCodec.lazyInstance.value
    }
}