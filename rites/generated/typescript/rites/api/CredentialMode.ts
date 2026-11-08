import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum CredentialMode {
    Token = "Token",
    Oauth = "Oauth"
}

export const CredentialMode_values: ReadonlyArray<CredentialMode> = [
    CredentialMode.Token,
    CredentialMode.Oauth
] as const;

export function CredentialMode_parse(s: string): CredentialMode {
    const found = CredentialMode_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown CredentialMode variant: " + s);
    }
    return found;
}

export class CredentialMode_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CredentialMode): unknown {
        if (this !== CredentialMode_JsonCodec.lazyInstance.value) {
          return CredentialMode_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CredentialMode {
        if (this !== CredentialMode_JsonCodec .lazyInstance.value) {
            return CredentialMode_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return CredentialMode_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '0.2.0'
    public baboonDomainVersion() {
        return CredentialMode_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'rites.api'
    public baboonDomainIdentifier() {
        return CredentialMode_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'rites.api/:#CredentialMode'
    public baboonTypeIdentifier() {
        return CredentialMode_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CredentialMode_JsonCodec())
    public static get instance(): CredentialMode_JsonCodec {
        return CredentialMode_JsonCodec.lazyInstance.value
    }
}