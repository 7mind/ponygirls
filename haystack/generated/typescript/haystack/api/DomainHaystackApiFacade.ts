

import { AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, BaboonBinCodec, BaboonJsonCodec, BaboonDomainVersion, BaboonMeta, Lazy } from '../../BaboonSharedRuntime.js';
import type { AbstractBaboonConversions } from '../../BaboonSharedRuntime.js';
import { BaboonCodecsFacade } from '../../BaboonCodecsFacade.js';
import { Ack, Ack_JsonCodec } from './Ack.js';
import { AnalyzeResult, AnalyzeResult_JsonCodec } from './AnalyzeResult.js';
import { CompletionResult, CompletionResult_JsonCodec } from './CompletionResult.js';
import { DocumentPayload, DocumentPayload_JsonCodec } from './DocumentPayload.js';
import { Failure, Failure_JsonCodec } from './Failure.js';
import { GetRequest, GetRequest_JsonCodec } from './GetRequest.js';
import { HistoryRequest, HistoryRequest_JsonCodec } from './HistoryRequest.js';
import { HistoryResult, HistoryResult_JsonCodec } from './HistoryResult.js';
import { Identity, Identity_JsonCodec } from './Identity.js';
import { Item, Item_JsonCodec } from './Item.js';
import { LiveFrame, LiveFrame_JsonCodec } from './LiveFrame.js';
import { LoginRequest, LoginRequest_JsonCodec } from './LoginRequest.js';
import { LoginResult, LoginResult_JsonCodec } from './LoginResult.js';
import { Metadata, Metadata_JsonCodec } from './Metadata.js';
import { PutRequest, PutRequest_JsonCodec } from './PutRequest.js';
import { PutResult, PutResult_JsonCodec } from './PutResult.js';
import { QueryRequest, QueryRequest_JsonCodec } from './QueryRequest.js';
import { RetrievalMode, RetrievalMode_JsonCodec } from './RetrievalMode.js';
import { RetrieveRequest, RetrieveRequest_JsonCodec } from './RetrieveRequest.js';
import { RetrieveResult, RetrieveResult_JsonCodec } from './RetrieveResult.js';
import { RetrievedSource, RetrievedSource_JsonCodec } from './RetrievedSource.js';
import { RevisionInfo, RevisionInfo_JsonCodec } from './RevisionInfo.js';
import { SearchRequest, SearchRequest_JsonCodec } from './SearchRequest.js';
import { SearchResult, SearchResult_JsonCodec } from './SearchResult.js';
import { SearchSort, SearchSort_JsonCodec } from './SearchSort.js';
import { Span, Span_JsonCodec } from './Span.js';
import { Summary, Summary_JsonCodec } from './Summary.js';
import { ValuesRequest, ValuesRequest_JsonCodec } from './ValuesRequest.js';
import { ValuesResult, ValuesResult_JsonCodec } from './ValuesResult.js';
import { VersionInfo, VersionInfo_JsonCodec } from './VersionInfo.js';

class DomainHaystackApiV1_0_0JsonCodecs extends AbstractBaboonJsonCodecs {
    constructor() {
        super();
        this.register(Ack_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Ack_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(AnalyzeResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => AnalyzeResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(CompletionResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => CompletionResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(DocumentPayload_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => DocumentPayload_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Failure_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Failure_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(GetRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => GetRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(HistoryRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => HistoryRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(HistoryResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => HistoryResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Identity_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Identity_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Item_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Item_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LiveFrame_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LiveFrame_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(LoginResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => LoginResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Metadata_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Metadata_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PutRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PutRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(PutResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => PutResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(QueryRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => QueryRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetrievalMode_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetrievalMode_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetrieveRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetrieveRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetrieveResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetrieveResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RetrievedSource_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RetrievedSource_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(RevisionInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => RevisionInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(SearchSort_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => SearchSort_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Span_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Span_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(Summary_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => Summary_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ValuesRequest_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ValuesRequest_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(ValuesResult_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => ValuesResult_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
        this.register(VersionInfo_JsonCodec.BaboonTypeIdentifier, new Lazy<BaboonJsonCodec<unknown>>(() => VersionInfo_JsonCodec.instance as unknown as BaboonJsonCodec<unknown>));
    }
}

class DomainHaystackApiV1_0_0UebaCodecs extends AbstractBaboonUebaCodecs {
    constructor() {
        super();
        
    }
}

class DomainHaystackApiV1_0_0Conversions implements AbstractBaboonConversions {
    public versionsFrom(): string[] { return []; }
    public versionTo(): string { return '1.0.0'; }
}

class DomainHaystackApiV1_0_0Meta implements BaboonMeta {
    private static readonly SAME_IN: { readonly [typeId: string]: readonly string[] } = {
        "haystack.api/:#Ack": ['1.0.0'],
        "haystack.api/:#AnalyzeResult": ['1.0.0'],
        "haystack.api/:#CompletionResult": ['1.0.0'],
        "haystack.api/:#DocumentPayload": ['1.0.0'],
        "haystack.api/:#Failure": ['1.0.0'],
        "haystack.api/:#GetRequest": ['1.0.0'],
        "haystack.api/:#HistoryRequest": ['1.0.0'],
        "haystack.api/:#HistoryResult": ['1.0.0'],
        "haystack.api/:#Identity": ['1.0.0'],
        "haystack.api/:#Item": ['1.0.0'],
        "haystack.api/:#LiveFrame": ['1.0.0'],
        "haystack.api/:#LoginRequest": ['1.0.0'],
        "haystack.api/:#LoginResult": ['1.0.0'],
        "haystack.api/:#Metadata": ['1.0.0'],
        "haystack.api/:#PutRequest": ['1.0.0'],
        "haystack.api/:#PutResult": ['1.0.0'],
        "haystack.api/:#QueryRequest": ['1.0.0'],
        "haystack.api/:#RetrievalMode": ['1.0.0'],
        "haystack.api/:#RetrieveRequest": ['1.0.0'],
        "haystack.api/:#RetrieveResult": ['1.0.0'],
        "haystack.api/:#RetrievedSource": ['1.0.0'],
        "haystack.api/:#RevisionInfo": ['1.0.0'],
        "haystack.api/:#SearchRequest": ['1.0.0'],
        "haystack.api/:#SearchResult": ['1.0.0'],
        "haystack.api/:#SearchSort": ['1.0.0'],
        "haystack.api/:#Span": ['1.0.0'],
        "haystack.api/:#Summary": ['1.0.0'],
        "haystack.api/:#ValuesRequest": ['1.0.0'],
        "haystack.api/:#ValuesResult": ['1.0.0'],
        "haystack.api/:#VersionInfo": ['1.0.0'],
    };
    private static readonly FORWARD: { readonly [typeId: string]: { readonly [version: string]: string } } = {
        "haystack.api/:#Ack": { '1.0.0': 'identical' },
        "haystack.api/:#AnalyzeResult": { '1.0.0': 'identical' },
        "haystack.api/:#CompletionResult": { '1.0.0': 'identical' },
        "haystack.api/:#DocumentPayload": { '1.0.0': 'identical' },
        "haystack.api/:#Failure": { '1.0.0': 'identical' },
        "haystack.api/:#GetRequest": { '1.0.0': 'identical' },
        "haystack.api/:#HistoryRequest": { '1.0.0': 'identical' },
        "haystack.api/:#HistoryResult": { '1.0.0': 'identical' },
        "haystack.api/:#Identity": { '1.0.0': 'identical' },
        "haystack.api/:#Item": { '1.0.0': 'identical' },
        "haystack.api/:#LiveFrame": { '1.0.0': 'identical' },
        "haystack.api/:#LoginRequest": { '1.0.0': 'identical' },
        "haystack.api/:#LoginResult": { '1.0.0': 'identical' },
        "haystack.api/:#Metadata": { '1.0.0': 'identical' },
        "haystack.api/:#PutRequest": { '1.0.0': 'identical' },
        "haystack.api/:#PutResult": { '1.0.0': 'identical' },
        "haystack.api/:#QueryRequest": { '1.0.0': 'identical' },
        "haystack.api/:#RetrievalMode": { '1.0.0': 'identical' },
        "haystack.api/:#RetrieveRequest": { '1.0.0': 'identical' },
        "haystack.api/:#RetrieveResult": { '1.0.0': 'identical' },
        "haystack.api/:#RetrievedSource": { '1.0.0': 'identical' },
        "haystack.api/:#RevisionInfo": { '1.0.0': 'identical' },
        "haystack.api/:#SearchRequest": { '1.0.0': 'identical' },
        "haystack.api/:#SearchResult": { '1.0.0': 'identical' },
        "haystack.api/:#SearchSort": { '1.0.0': 'identical' },
        "haystack.api/:#Span": { '1.0.0': 'identical' },
        "haystack.api/:#Summary": { '1.0.0': 'identical' },
        "haystack.api/:#ValuesRequest": { '1.0.0': 'identical' },
        "haystack.api/:#ValuesResult": { '1.0.0': 'identical' },
        "haystack.api/:#VersionInfo": { '1.0.0': 'identical' },
    };
    public sameInVersions(typeId: string): string[] { return [...(DomainHaystackApiV1_0_0Meta.SAME_IN[typeId] ?? [])]; }
    public forwardReadableVersions(typeId: string): { readonly [version: string]: string } { return DomainHaystackApiV1_0_0Meta.FORWARD[typeId] ?? {}; }
}

export class DomainHaystackApiFacade extends BaboonCodecsFacade {
    constructor() {
        super();
        this.register(
            new BaboonDomainVersion('haystack.api', '1.0.0'),
            () => new DomainHaystackApiV1_0_0JsonCodecs(),
            () => new DomainHaystackApiV1_0_0UebaCodecs(),
            () => new DomainHaystackApiV1_0_0Conversions(),
            () => new DomainHaystackApiV1_0_0Meta(),
        );
    }
}