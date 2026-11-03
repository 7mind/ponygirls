import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package manure.api {
  sealed trait ArtifactKind
  
  object ArtifactKind extends BaboonEnum[ArtifactKind] {
    case object File extends ArtifactKind
    case object Directory extends ArtifactKind
    
    def parse(s: String): Option[ArtifactKind] = {
      s match {
        case "File" => Some(File)
        case "Directory" => Some(Directory)
        case _ => None
      }
    }
    
    def all: List[ArtifactKind] = List(
      File,
      Directory
    ) 
  }
  
  object ArtifactKind_JsonCodec extends BaboonJsonCodec.Base[ArtifactKind, BaboonJsonCodec[ArtifactKind]] {
    def encode(ctx: BaboonCodecContext, value: ArtifactKind): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ArtifactKind] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ArtifactKind.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ArtifactKind: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ArtifactKind: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.0.0"
    
    def baboonDomainIdentifier: String = "manure.api"
    
    def baboonTypeIdentifier: String = "manure.api/:#ArtifactKind"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ArtifactKind]] = Lazy(ArtifactKind_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ArtifactKind]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ArtifactKind] = LazyInstance.value
  }
}