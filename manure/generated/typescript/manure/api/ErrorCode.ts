import {BaboonCodecContext, BaboonDecoderFailure, Lazy} from '../../BaboonSharedRuntime.js'

export enum ErrorCode {
    BadEnvelope = "BadEnvelope",
    InvalidPath = "InvalidPath",
    InvalidManifest = "InvalidManifest",
    InvalidRange = "InvalidRange",
    InvalidTtl = "InvalidTtl",
    InvalidVisibility = "InvalidVisibility",
    BadHost = "BadHost",
    AmbiguousCredentials = "AmbiguousCredentials",
    Unauthorized = "Unauthorized",
    PasswordRequired = "PasswordRequired",
    PasswordInvalid = "PasswordInvalid",
    GrantRequired = "GrantRequired",
    GrantInvalid = "GrantInvalid",
    GrantExpired = "GrantExpired",
    SessionNotOwned = "SessionNotOwned",
    Forbidden = "Forbidden",
    TlsRequired = "TlsRequired",
    NotFound = "NotFound",
    DashboardDisabled = "DashboardDisabled",
    ChunkConflict = "ChunkConflict",
    StateConflict = "StateConflict",
    HashMismatch = "HashMismatch",
    IncompleteUpload = "IncompleteUpload",
    Expired = "Expired",
    TooLarge = "TooLarge",
    QuotaExceeded = "QuotaExceeded",
    SessionLimit = "SessionLimit",
    RateLimited = "RateLimited",
    Unavailable = "Unavailable",
    UnsupportedVersion = "UnsupportedVersion",
    SearchUnavailable = "SearchUnavailable",
    SearchNotReady = "SearchNotReady"
}

export const ErrorCode_values: ReadonlyArray<ErrorCode> = [
    ErrorCode.BadEnvelope,
    ErrorCode.InvalidPath,
    ErrorCode.InvalidManifest,
    ErrorCode.InvalidRange,
    ErrorCode.InvalidTtl,
    ErrorCode.InvalidVisibility,
    ErrorCode.BadHost,
    ErrorCode.AmbiguousCredentials,
    ErrorCode.Unauthorized,
    ErrorCode.PasswordRequired,
    ErrorCode.PasswordInvalid,
    ErrorCode.GrantRequired,
    ErrorCode.GrantInvalid,
    ErrorCode.GrantExpired,
    ErrorCode.SessionNotOwned,
    ErrorCode.Forbidden,
    ErrorCode.TlsRequired,
    ErrorCode.NotFound,
    ErrorCode.DashboardDisabled,
    ErrorCode.ChunkConflict,
    ErrorCode.StateConflict,
    ErrorCode.HashMismatch,
    ErrorCode.IncompleteUpload,
    ErrorCode.Expired,
    ErrorCode.TooLarge,
    ErrorCode.QuotaExceeded,
    ErrorCode.SessionLimit,
    ErrorCode.RateLimited,
    ErrorCode.Unavailable,
    ErrorCode.UnsupportedVersion,
    ErrorCode.SearchUnavailable,
    ErrorCode.SearchNotReady
] as const;

export function ErrorCode_parse(s: string): ErrorCode {
    const found = ErrorCode_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ErrorCode variant: " + s);
    }
    return found;
}

export class ErrorCode_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: ErrorCode): unknown {
        if (this !== ErrorCode_JsonCodec.lazyInstance.value) {
          return ErrorCode_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return value
    }
    public decode(ctx: BaboonCodecContext, json: unknown): ErrorCode {
        if (this !== ErrorCode_JsonCodec .lazyInstance.value) {
            return ErrorCode_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        return ErrorCode_parse(json as string)
    }

    public static readonly BaboonDomainVersion = '1.0.0'
    public baboonDomainVersion() {
        return ErrorCode_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'manure.api'
    public baboonDomainIdentifier() {
        return ErrorCode_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'manure.api/:#ErrorCode'
    public baboonTypeIdentifier() {
        return ErrorCode_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new ErrorCode_JsonCodec())
    public static get instance(): ErrorCode_JsonCodec {
        return ErrorCode_JsonCodec.lazyInstance.value
    }
}