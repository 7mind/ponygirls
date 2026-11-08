import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CredentialInfo, CredentialInfo_JsonCodec} from './CredentialInfo.js'

export class CredentialResult implements BaboonGeneratedLatest {
    private readonly _credential: CredentialInfo;

    constructor(credential: CredentialInfo) {
        this._credential = credential
    }

    public get credential(): CredentialInfo {
        return this._credential;
    }

    public toJSON(): Record<string, unknown> {
        return {
            credential: this._credential
        };
    }

    public with(overrides: {credential?: CredentialInfo}): CredentialResult {
        return new CredentialResult(
            'credential' in overrides ? overrides.credential! : this._credential
        );
    }

    public static fromPlain(obj: {credential: CredentialInfo}): CredentialResult {
        return new CredentialResult(
            obj.credential
        );
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return CredentialResult.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return CredentialResult.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#CredentialResult'
    public baboonTypeIdentifier() {
        return CredentialResult.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.2.0"]
    public baboonSameInVersions() {
        return CredentialResult.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.2.0": "identical" }
    public baboonForwardReadable() {
        return CredentialResult.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.2.0", "prefix-compact": "0.2.0", "prefix-any-mode": "0.2.0", "identical": "0.2.0" }
    public baboonMinReaderVersions() {
        return CredentialResult.BaboonMinReaderVersions
    }
    public static jsonCodec(): CredentialResult_JsonCodec {
        return CredentialResult_JsonCodec.instance
    }
}

export class CredentialResult_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CredentialResult): unknown {
        if (this !== CredentialResult_JsonCodec.lazyInstance.value) {
          return CredentialResult_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "credential": CredentialInfo_JsonCodec.instance.encode(BaboonCodecContext.Default, value.credential),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CredentialResult {
        if (this !== CredentialResult_JsonCodec .lazyInstance.value) {
            return CredentialResult_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CredentialResult (
            CredentialInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["credential"]),
        )
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return CredentialResult_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return CredentialResult_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#CredentialResult'
    public baboonTypeIdentifier() {
        return CredentialResult_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CredentialResult_JsonCodec())
    public static get instance(): CredentialResult_JsonCodec {
        return CredentialResult_JsonCodec.lazyInstance.value
    }
}