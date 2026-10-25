import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, Lazy}

package chronicle.api.v1_0_0 {
  trait RequiredConversions {
      
  }
  
  class BaboonConversions(@scala.annotation.unused required: RequiredConversions) extends AbstractBaboonConversions {
      
  
      override def versionsFrom: List[String] = List()
      override def versionTo: String = "1.0.0"
  }
  
  object BaboonCodecsUeba extends AbstractBaboonUebaCodecs{
    
  }
  
  object BaboonCodecsJson extends AbstractBaboonJsonCodecs{
    register("chronicle.api/:#Metadata", Lazy(Metadata_JsonCodec))
    register("chronicle.api/:#RawResult", Lazy(RawResult_JsonCodec))
    register("chronicle.api/:#MessagesResult", Lazy(MessagesResult_JsonCodec))
    register("chronicle.api/:#UserInfo", Lazy(UserInfo_JsonCodec))
    register("chronicle.api/:#GroupsResult", Lazy(GroupsResult_JsonCodec))
    register("chronicle.api/:#SearchResult", Lazy(SearchResult_JsonCodec))
    register("chronicle.api/:#Operation", Lazy(Operation_JsonCodec))
    register("chronicle.api/:#LoginRequest", Lazy(LoginRequest_JsonCodec))
    register("chronicle.api/:#SearchFilter", Lazy(SearchFilter_JsonCodec))
    register("chronicle.api/:#ContentView", Lazy(ContentView_JsonCodec))
    register("chronicle.api/:#SearchHit", Lazy(SearchHit_JsonCodec))
    register("chronicle.api/:#Scope", Lazy(Scope_JsonCodec))
    register("chronicle.api/:#TokenInfo", Lazy(TokenInfo_JsonCodec))
    register("chronicle.api/:#LoginResponse", Lazy(LoginResponse_JsonCodec))
    register("chronicle.api/:#JobState", Lazy(JobState_JsonCodec))
    register("chronicle.api/:#RelatedResult", Lazy(RelatedResult_JsonCodec))
    register("chronicle.api/:#SearchMode", Lazy(SearchMode_JsonCodec))
    register("chronicle.api/:#SourceFormat", Lazy(SourceFormat_JsonCodec))
    register("chronicle.api/:#SessionResult", Lazy(SessionResult_JsonCodec))
    register("chronicle.api/:#Chunk", Lazy(Chunk_JsonCodec))
    register("chronicle.api/:#RawFile", Lazy(RawFile_JsonCodec))
    register("chronicle.api/:#Message", Lazy(Message_JsonCodec))
    register("chronicle.api/:#SourceIdentity", Lazy(SourceIdentity_JsonCodec))
    register("chronicle.api/:#FacetsResult", Lazy(FacetsResult_JsonCodec))
    register("chronicle.api/:#IngestReceipt", Lazy(IngestReceipt_JsonCodec))
    register("chronicle.api/:#SearchQuery", Lazy(SearchQuery_JsonCodec))
    register("chronicle.api/:#Span", Lazy(Span_JsonCodec))
    register("chronicle.api/:#MutationReceipt", Lazy(MutationReceipt_JsonCodec))
    register("chronicle.api/:#ClientEnvelope", Lazy(ClientEnvelope_JsonCodec))
    register("chronicle.api/:#Completion", Lazy(Completion_JsonCodec))
    register("chronicle.api/:#IngestRequest", Lazy(IngestRequest_JsonCodec))
    register("chronicle.api/:#Result", Lazy(Result_JsonCodec))
    register("chronicle.api/:#ChunksResult", Lazy(ChunksResult_JsonCodec))
    register("chronicle.api/:#VersionInfo", Lazy(VersionInfo_JsonCodec))
    register("chronicle.api/:#InviteInfo", Lazy(InviteInfo_JsonCodec))
    register("chronicle.api/:#JobInfo", Lazy(JobInfo_JsonCodec))
    register("chronicle.api/:#SessionInfo", Lazy(SessionInfo_JsonCodec))
    register("chronicle.api/:#StatusResult", Lazy(StatusResult_JsonCodec))
    register("chronicle.api/:#TokenResult", Lazy(TokenResult_JsonCodec))
    register("chronicle.api/:#GroupInfo", Lazy(GroupInfo_JsonCodec))
    register("chronicle.api/:#TokensResult", Lazy(TokensResult_JsonCodec))
    register("chronicle.api/:#Facet", Lazy(Facet_JsonCodec))
    register("chronicle.api/:#ServerEnvelope", Lazy(ServerEnvelope_JsonCodec))
    register("chronicle.api/:#Failure", Lazy(Failure_JsonCodec))
  }
}