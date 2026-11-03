import { BaboonDecoderFailure, Lazy } from '../../BaboonSharedRuntime.js';
export var ErrorCode;
(function (ErrorCode) {
    ErrorCode["BadEnvelope"] = "BadEnvelope";
    ErrorCode["InvalidPath"] = "InvalidPath";
    ErrorCode["InvalidManifest"] = "InvalidManifest";
    ErrorCode["InvalidRange"] = "InvalidRange";
    ErrorCode["InvalidTtl"] = "InvalidTtl";
    ErrorCode["InvalidVisibility"] = "InvalidVisibility";
    ErrorCode["BadHost"] = "BadHost";
    ErrorCode["AmbiguousCredentials"] = "AmbiguousCredentials";
    ErrorCode["Unauthorized"] = "Unauthorized";
    ErrorCode["PasswordRequired"] = "PasswordRequired";
    ErrorCode["PasswordInvalid"] = "PasswordInvalid";
    ErrorCode["GrantRequired"] = "GrantRequired";
    ErrorCode["GrantInvalid"] = "GrantInvalid";
    ErrorCode["GrantExpired"] = "GrantExpired";
    ErrorCode["SessionNotOwned"] = "SessionNotOwned";
    ErrorCode["Forbidden"] = "Forbidden";
    ErrorCode["TlsRequired"] = "TlsRequired";
    ErrorCode["NotFound"] = "NotFound";
    ErrorCode["DashboardDisabled"] = "DashboardDisabled";
    ErrorCode["ChunkConflict"] = "ChunkConflict";
    ErrorCode["StateConflict"] = "StateConflict";
    ErrorCode["HashMismatch"] = "HashMismatch";
    ErrorCode["IncompleteUpload"] = "IncompleteUpload";
    ErrorCode["Expired"] = "Expired";
    ErrorCode["TooLarge"] = "TooLarge";
    ErrorCode["QuotaExceeded"] = "QuotaExceeded";
    ErrorCode["SessionLimit"] = "SessionLimit";
    ErrorCode["RateLimited"] = "RateLimited";
    ErrorCode["Unavailable"] = "Unavailable";
    ErrorCode["UnsupportedVersion"] = "UnsupportedVersion";
    ErrorCode["SearchUnavailable"] = "SearchUnavailable";
    ErrorCode["SearchNotReady"] = "SearchNotReady";
})(ErrorCode || (ErrorCode = {}));
export const ErrorCode_values = [
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
];
export function ErrorCode_parse(s) {
    const found = ErrorCode_values.find(v => v === s);
    if (found === undefined) {
        throw new BaboonDecoderFailure("Unknown ErrorCode variant: " + s);
    }
    return found;
}
export class ErrorCode_JsonCodec {
    encode(ctx, value) {
        if (this !== ErrorCode_JsonCodec.lazyInstance.value) {
            return ErrorCode_JsonCodec.lazyInstance.value.encode(ctx, value);
        }
        return value;
    }
    decode(ctx, json) {
        if (this !== ErrorCode_JsonCodec.lazyInstance.value) {
            return ErrorCode_JsonCodec.lazyInstance.value.decode(ctx, json);
        }
        return ErrorCode_parse(json);
    }
    static BaboonDomainVersion = '1.0.0';
    baboonDomainVersion() {
        return ErrorCode_JsonCodec.BaboonDomainVersion;
    }
    static BaboonDomainIdentifier = 'manure.api';
    baboonDomainIdentifier() {
        return ErrorCode_JsonCodec.BaboonDomainIdentifier;
    }
    static BaboonTypeIdentifier = 'manure.api/:#ErrorCode';
    baboonTypeIdentifier() {
        return ErrorCode_JsonCodec.BaboonTypeIdentifier;
    }
    static lazyInstance = new Lazy(() => new ErrorCode_JsonCodec());
    static get instance() {
        return ErrorCode_JsonCodec.lazyInstance.value;
    }
}
