import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {ForgeKind, ForgeKind_JsonCodec} from './ForgeKind.js'

export class SaveCredentialRequest implements BaboonGeneratedLatest {
    private readonly _id: string | undefined;
    private readonly _name: string;
    private readonly _forge: ForgeKind;
    private readonly _host: string;
    private readonly _secret: string;
    private readonly _expectedRevision: number;

    constructor(id: string | undefined, name: string, forge: ForgeKind, host: string, secret: string, expectedRevision: number) {
        this._id = id
        this._name = name
        this._forge = forge
        this._host = host
        this._secret = secret
        this._expectedRevision = expectedRevision
    }

    public get id(): string | undefined {
        return this._id;
    }
    public get name(): string {
        return this._name;
    }
    public get forge(): ForgeKind {
        return this._forge;
    }
    public get host(): string {
        return this._host;
    }
    public get secret(): string {
        return this._secret;
    }
    public get expectedRevision(): number {
        return this._expectedRevision;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id !== undefined ? this._id : undefined,
            name: this._name,
            forge: this._forge,
            host: this._host,
            secret: this._secret,
            expectedRevision: this._expectedRevision
        };
    }

    public with(overrides: {id?: string | undefined; name?: string; forge?: ForgeKind; host?: string; secret?: string; expectedRevision?: number}): SaveCredentialRequest {
        return new SaveCredentialRequest(
            'id' in overrides ? overrides.id! : this._id,
            'name' in overrides ? overrides.name! : this._name,
            'forge' in overrides ? overrides.forge! : this._forge,
            'host' in overrides ? overrides.host! : this._host,
            'secret' in overrides ? overrides.secret! : this._secret,
            'expectedRevision' in overrides ? overrides.expectedRevision! : this._expectedRevision
        );
    }

    public static fromPlain(obj: {id: string | undefined; name: string; forge: ForgeKind; host: string; secret: string; expectedRevision: number}): SaveCredentialRequest {
        return new SaveCredentialRequest(
            obj.id,
            obj.name,
            obj.forge,
            obj.host,
            obj.secret,
            obj.expectedRevision
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SaveCredentialRequest.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return SaveCredentialRequest.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#SaveCredentialRequest'
    public baboonTypeIdentifier() {
        return SaveCredentialRequest.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return SaveCredentialRequest.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return SaveCredentialRequest.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return SaveCredentialRequest.BaboonMinReaderVersions
    }
    public static jsonCodec(): SaveCredentialRequest_JsonCodec {
        return SaveCredentialRequest_JsonCodec.instance
    }
}

export class SaveCredentialRequest_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: SaveCredentialRequest): unknown {
        if (this !== SaveCredentialRequest_JsonCodec.lazyInstance.value) {
          return SaveCredentialRequest_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id === undefined ? null : value.id,
            "name": value.name,
            "forge": ForgeKind_JsonCodec.instance.encode(BaboonCodecContext.Default, value.forge),
            "host": value.host,
            "secret": value.secret,
            "expectedRevision": value.expectedRevision,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): SaveCredentialRequest {
        if (this !== SaveCredentialRequest_JsonCodec .lazyInstance.value) {
            return SaveCredentialRequest_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new SaveCredentialRequest (
            obj["id"] === undefined || obj["id"] === null ? undefined : obj["id"] === undefined || obj["id"] === null ? undefined : obj["id"] as string,
            obj["name"] as string,
            ForgeKind_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["forge"]),
            obj["host"] as string,
            obj["secret"] as string,
            obj["expectedRevision"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return SaveCredentialRequest_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return SaveCredentialRequest_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#SaveCredentialRequest'
    public baboonTypeIdentifier() {
        return SaveCredentialRequest_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new SaveCredentialRequest_JsonCodec())
    public static get instance(): SaveCredentialRequest_JsonCodec {
        return SaveCredentialRequest_JsonCodec.lazyInstance.value
    }
}