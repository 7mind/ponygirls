import {type BaboonGenerated} from '../../../BaboonSharedRuntime.js'
import {BaboonCodecContext, Lazy} from '../../../BaboonSharedRuntime.js'

export class Message implements BaboonGenerated {
    private readonly _id: string;
    private readonly _parentId: string | undefined;
    private readonly _role: string;
    private readonly _text: string;
    private readonly _timestamp: string | undefined;
    private readonly _recordIndex: number;

    constructor(id: string, parentId: string | undefined, role: string, text: string, timestamp: string | undefined, recordIndex: number) {
        this._id = id
        this._parentId = parentId
        this._role = role
        this._text = text
        this._timestamp = timestamp
        this._recordIndex = recordIndex
    }

    public get id(): string {
        return this._id;
    }
    public get parentId(): string | undefined {
        return this._parentId;
    }
    public get role(): string {
        return this._role;
    }
    public get text(): string {
        return this._text;
    }
    public get timestamp(): string | undefined {
        return this._timestamp;
    }
    public get recordIndex(): number {
        return this._recordIndex;
    }

    public toJSON(): Record<string, unknown> {
        return {
            id: this._id,
            parentId: this._parentId !== undefined ? this._parentId : undefined,
            role: this._role,
            text: this._text,
            timestamp: this._timestamp !== undefined ? this._timestamp : undefined,
            recordIndex: this._recordIndex
        };
    }

    public with(overrides: {id?: string; parentId?: string | undefined; role?: string; text?: string; timestamp?: string | undefined; recordIndex?: number}): Message {
        return new Message(
            'id' in overrides ? overrides.id! : this._id,
            'parentId' in overrides ? overrides.parentId! : this._parentId,
            'role' in overrides ? overrides.role! : this._role,
            'text' in overrides ? overrides.text! : this._text,
            'timestamp' in overrides ? overrides.timestamp! : this._timestamp,
            'recordIndex' in overrides ? overrides.recordIndex! : this._recordIndex
        );
    }

    public static fromPlain(obj: {id: string; parentId: string | undefined; role: string; text: string; timestamp: string | undefined; recordIndex: number}): Message {
        return new Message(
            obj.id,
            obj.parentId,
            obj.role,
            obj.text,
            obj.timestamp,
            obj.recordIndex
        );
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Message.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Message.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Message'
    public baboonTypeIdentifier() {
        return Message.BaboonTypeIdentifier
    }
    public static readonly BaboonSameInVersions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0"]
    public baboonSameInVersions() {
        return Message.BaboonSameInVersions
    }
    public static readonly BaboonForwardReadable: { readonly [version: string]: string } = { "1.4.0": "identical", "1.5.0": "identical" }
    public baboonForwardReadable() {
        return Message.BaboonForwardReadable
    }
    public static readonly BaboonMinReaderVersions: { readonly [tier: string]: string } = { "json-additive": "1.0.0", "prefix-compact": "1.0.0", "prefix-any-mode": "1.0.0", "identical": "1.0.0" }
    public baboonMinReaderVersions() {
        return Message.BaboonMinReaderVersions
    }
    public static jsonCodec(): Message_JsonCodec {
        return Message_JsonCodec.instance
    }
}

/** @deprecated Version 1.4.0 is deprecated, you should migrate to 1.5.0 */
export class Message_JsonCodec {
    public encode(ctx: BaboonCodecContext, value: Message): unknown {
        if (this !== Message_JsonCodec.lazyInstance.value) {
          return Message_JsonCodec.lazyInstance.value.encode(ctx, value)
        }
    
        return {
            "id": value.id,
            "parentId": value.parentId === undefined ? null : value.parentId,
            "role": value.role,
            "text": value.text,
            "timestamp": value.timestamp === undefined ? null : value.timestamp,
            "recordIndex": value.recordIndex,
        }
    }
    public decode(ctx: BaboonCodecContext, json: unknown): Message {
        if (this !== Message_JsonCodec .lazyInstance.value) {
            return Message_JsonCodec.lazyInstance.value.decode(ctx, json)
        }
    
        const obj = json as Record<string, unknown>;
        return new Message (
            obj["id"] as string,
            obj["parentId"] === undefined || obj["parentId"] === null ? undefined : obj["parentId"] === undefined || obj["parentId"] === null ? undefined : obj["parentId"] as string,
            obj["role"] as string,
            obj["text"] as string,
            obj["timestamp"] === undefined || obj["timestamp"] === null ? undefined : obj["timestamp"] === undefined || obj["timestamp"] === null ? undefined : obj["timestamp"] as string,
            obj["recordIndex"] as number,
        )
    }

    public static readonly BaboonDomainVersion = '1.4.0'
    public baboonDomainVersion() {
        return Message_JsonCodec.BaboonDomainVersion
    }
    public static readonly BaboonDomainIdentifier = 'chronicle.api'
    public baboonDomainIdentifier() {
        return Message_JsonCodec.BaboonDomainIdentifier
    }
    public static readonly BaboonTypeIdentifier = 'chronicle.api/:#Message'
    public baboonTypeIdentifier() {
        return Message_JsonCodec.BaboonTypeIdentifier
    }

    public static lazyInstance = new Lazy(() => new Message_JsonCodec())
    public static get instance(): Message_JsonCodec {
        return Message_JsonCodec.lazyInstance.value
    }
}