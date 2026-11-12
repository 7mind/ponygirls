import {type BaboonGeneratedLatest} from '../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../BaboonSharedRuntime.js'
import {CapsuleQualificationCode, CapsuleQualificationCode_JsonCodec} from './CapsuleQualificationCode.js'
import {Ref, Ref_JsonCodec} from './Ref.js'

export class CapsuleQualification implements BaboonGeneratedLatest {
    private readonly _code: CapsuleQualificationCode;
    private readonly _subjects: Array<Ref>;

    constructor(code: CapsuleQualificationCode, subjects: Array<Ref>) {
        this._code = code
        this._subjects = subjects
    }

    public get code(): CapsuleQualificationCode {
        return this._code;
    }
    public get subjects(): Array<Ref> {
        return this._subjects;
    }

    public toJSON(): Record<string, unknown> {
        return {
            code: this._code,
            subjects: this._subjects
        };
    }

    public with(overrides: {code?: CapsuleQualificationCode; subjects?: Array<Ref>}): CapsuleQualification {
        return new CapsuleQualification(
            'code' in overrides ? overrides.code! : this._code,
            'subjects' in overrides ? overrides.subjects! : this._subjects
        );
    }

    public static fromPlain(obj: {code: CapsuleQualificationCode; subjects: Array<Ref>}): CapsuleQualification {
        return new CapsuleQualification(
            obj.code,
            obj.subjects
        );
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleQualification.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleQualification.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleQualification'
    public baboonTypeIdentifier() {
        return CapsuleQualification.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["0.1.0"]
    public baboonSameInVersions() {
        return CapsuleQualification.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "0.1.0": "identical" }
    public baboonForwardReadable() {
        return CapsuleQualification.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "0.1.0", "prefix-compact": "0.1.0", "prefix-any-mode": "0.1.0", "identical": "0.1.0" }
    public baboonMinReaderVersions() {
        return CapsuleQualification.BaboonMinReaderVersions
    }
    public static jsonCodec(): CapsuleQualification_JsonCodec {
        return CapsuleQualification_JsonCodec.instance
    }
}

export class CapsuleQualification_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: CapsuleQualification): unknown {
        if (this !== CapsuleQualification_JsonCodec.lazyInstance.value) {
          return CapsuleQualification_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "code": CapsuleQualificationCode_JsonCodec.instance.encode(BaboonCodecContext.Default, value.code),
            "subjects": Array.from(value.subjects).map(item => Ref_JsonCodec.instance.encode(BaboonCodecContext.Default, item)),
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): CapsuleQualification {
        if (this !== CapsuleQualification_JsonCodec .lazyInstance.value) {
            return CapsuleQualification_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new CapsuleQualification (
            CapsuleQualificationCode_JsonCodec.instance.decode(BaboonCodecContext.Default, obj["code"]),
            (obj["subjects"] as unknown[]).map(item => Ref_JsonCodec.instance.decode(BaboonCodecContext.Default, item)),
        )
    }

    public static readonly BaboonDomainVersion = '0.1.0'
    public baboonDomainVersion() {
        return CapsuleQualification_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'ontology.api'
    public baboonDomainIdentifier() {
        return CapsuleQualification_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'ontology.api/:#CapsuleQualification'
    public baboonTypeIdentifier() {
        return CapsuleQualification_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new CapsuleQualification_JsonCodec())
    public static get instance(): CapsuleQualification_JsonCodec {
        return CapsuleQualification_JsonCodec.lazyInstance.value
    }
}