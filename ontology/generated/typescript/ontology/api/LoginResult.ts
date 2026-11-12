import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {Identity, Identity_JsonCodec} from './Identity.js'
import {VersionInfo, VersionInfo_JsonCodec} from './VersionInfo.js'

export class LoginResult implements BaboonGeneratedLatest {
    private readonly _identity: Identity;
    private readonly _versions: VersionInfo;

    constructor(identity: Identity, versions: VersionInfo) {
        this._identity = identity
        this._versions = versions
    }

    public get identity(): Identity {
        return this._identity;
    }
    public get versions(): VersionInfo {
        return this._versions;
    }

    public toJSON(): Record<string, unknown> {
        return {
            identity: this._identity,
            versions: this._versions
        };
    }

    public with(overrides: {identity?: Identity; versions?: VersionInfo}): LoginResult {
        return new LoginResult(
            'identity' in overrides ? overrides.identity! : this._identity,
            'versions' in overrides ? overrides.versions! : this._versions
        );
    }

    public static fromPlain(obj: {identity: Identity; versions: VersionInfo}): LoginResult {
        return new LoginResult(
            obj.identity,
            obj.versions
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return LoginResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return LoginResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#LoginResult'
    public baboonTypeIdentifier() {
        return LoginResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return LoginResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return LoginResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return LoginResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): LoginResult_JsonCodec {
        return LoginResult_JsonCodec.instance
    }
}

export class LoginResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: LoginResult): unknown {
        if (this !== LoginResult_JsonCodec.lazyInstance.value) {
          return LoginResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "identity": Identity_JsonCodec.instance.encode(BaboonCodecContext.Default, value.identity),
            "versions": VersionInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.versions),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): LoginResult {
        if (this !== LoginResult_JsonCodec .lazyInstance.value) {
            return LoginResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new LoginResult (
            Identity_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["identity"]),
            VersionInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["versions"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return LoginResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return LoginResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#LoginResult'
    public baboonTypeIdentifier() {
        return LoginResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new LoginResult_JsonCodec())
    public static get instance(): LoginResult_JsonCodec {
        return LoginResult_JsonCodec.lazyInstance.value
    }
}