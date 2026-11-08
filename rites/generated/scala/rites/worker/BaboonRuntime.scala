import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractBaboonJsonCodecs, AbstractBaboonUebaCodecs, Lazy}

package rites.worker {
  trait RequiredConversions {
      
  }
  
  class BaboonConversions(@scala.annotation.unused required: RequiredConversions) extends AbstractBaboonConversions {
      
  
      override def versionsFrom: List[String] = List()
      override def versionTo: String = "0.1.0"
  }
  
  object BaboonCodecsUeba extends AbstractBaboonUebaCodecs{
    
  }
  
  object BaboonCodecsJson extends AbstractBaboonJsonCodecs{
    register("rites.worker/:#RunResult", Lazy(RunResult_JsonCodec))
    register("rites.worker/:#RunRequest", Lazy(RunRequest_JsonCodec))
    register("rites.worker/:#VersionInfo", Lazy(VersionInfo_JsonCodec))
    register("rites.worker/:#ModelSelection", Lazy(ModelSelection_JsonCodec))
    register("rites.worker/:#RunOutcome", Lazy(RunOutcome_JsonCodec))
  }
}