import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package manure.api {
  sealed trait ArtifactState
  
  object ArtifactState extends BaboonEnum[ArtifactState] {
    case object Uploading extends ArtifactState
    case object Publishing extends ArtifactState
    case object Ready extends ArtifactState
    
    def parse(s: String): Option[ArtifactState] = {
      s match {
        case "Uploading" => Some(Uploading)
        case "Publishing" => Some(Publishing)
        case "Ready" => Some(Ready)
        case _ => None
      }
    }
    
    def all: List[ArtifactState] = List(
      Uploading,
      Publishing,
      Ready
    ) 
  }
  
  object ArtifactState_JsonCodec extends BaboonJsonCodec.Base[ArtifactState, BaboonJsonCodec[ArtifactState]] {
    def encode(ctx: BaboonCodecContext, value: ArtifactState): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ArtifactState] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ArtifactState.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ArtifactState: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ArtifactState: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.0.0"
    
    def baboonDomainIdentifier: String = "manure.api"
    
    def baboonTypeIdentifier: String = "manure.api/:#ArtifactState"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ArtifactState]] = Lazy(ArtifactState_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ArtifactState]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ArtifactState] = LazyInstance.value
  }
}