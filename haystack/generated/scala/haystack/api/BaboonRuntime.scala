import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, Lazy}

package haystack.api {
  trait RequiredConversions {
      
  }
  
  class BaboonConversions(@scala.annotation.unused required: RequiredConversions) extends AbstractBaboonConversions {
      
  
      override def versionsFrom: List[String] = List()
      override def versionTo: String = "1.0.0"
  }
  
  object BaboonCodecsUeba extends AbstractBaboonUebaCodecs{
    
  }
  
  object BaboonCodecsJson extends AbstractBaboonJsonCodecs{
    register("haystack.api/:#SearchSort", Lazy(SearchSort_JsonCodec))
    register("haystack.api/:#ValuesRequest", Lazy(ValuesRequest_JsonCodec))
    register("haystack.api/:#DocumentPayload", Lazy(DocumentPayload_JsonCodec))
    register("haystack.api/:#PutRequest", Lazy(PutRequest_JsonCodec))
    register("haystack.api/:#Identity", Lazy(Identity_JsonCodec))
    register("haystack.api/:#Metadata", Lazy(Metadata_JsonCodec))
    register("haystack.api/:#CompletionResult", Lazy(CompletionResult_JsonCodec))
    register("haystack.api/:#RetrieveResult", Lazy(RetrieveResult_JsonCodec))
    register("haystack.api/:#Ack", Lazy(Ack_JsonCodec))
    register("haystack.api/:#Failure", Lazy(Failure_JsonCodec))
    register("haystack.api/:#PutResult", Lazy(PutResult_JsonCodec))
    register("haystack.api/:#HistoryResult", Lazy(HistoryResult_JsonCodec))
    register("haystack.api/:#AnalyzeResult", Lazy(AnalyzeResult_JsonCodec))
    register("haystack.api/:#SearchResult", Lazy(SearchResult_JsonCodec))
    register("haystack.api/:#QueryRequest", Lazy(QueryRequest_JsonCodec))
    register("haystack.api/:#RetrievalMode", Lazy(RetrievalMode_JsonCodec))
    register("haystack.api/:#RetrievedSource", Lazy(RetrievedSource_JsonCodec))
    register("haystack.api/:#HistoryRequest", Lazy(HistoryRequest_JsonCodec))
    register("haystack.api/:#Item", Lazy(Item_JsonCodec))
    register("haystack.api/:#VersionInfo", Lazy(VersionInfo_JsonCodec))
    register("haystack.api/:#Summary", Lazy(Summary_JsonCodec))
    register("haystack.api/:#RevisionInfo", Lazy(RevisionInfo_JsonCodec))
    register("haystack.api/:#Span", Lazy(Span_JsonCodec))
    register("haystack.api/:#LoginResult", Lazy(LoginResult_JsonCodec))
    register("haystack.api/:#SearchRequest", Lazy(SearchRequest_JsonCodec))
    register("haystack.api/:#GetRequest", Lazy(GetRequest_JsonCodec))
    register("haystack.api/:#LoginRequest", Lazy(LoginRequest_JsonCodec))
    register("haystack.api/:#RetrieveRequest", Lazy(RetrieveRequest_JsonCodec))
    register("haystack.api/:#LiveFrame", Lazy(LiveFrame_JsonCodec))
    register("haystack.api/:#ValuesResult", Lazy(ValuesResult_JsonCodec))
  }
}