import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package manure.api {
  sealed trait EvidenceField
  
  object EvidenceField extends BaboonEnum[EvidenceField] {
    case object Name extends EvidenceField
    case object ManifestPath extends EvidenceField
    
    def parse(s: String): Option[EvidenceField] = {
      s match {
        case "Name" => Some(Name)
        case "ManifestPath" => Some(ManifestPath)
        case _ => None
      }
    }
    
    def all: List[EvidenceField] = List(
      Name,
      ManifestPath
    ) 
  }
  
  object EvidenceField_JsonCodec extends BaboonJsonCodec.Base[EvidenceField, BaboonJsonCodec[EvidenceField]] {
    def encode(ctx: BaboonCodecContext, value: EvidenceField): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, EvidenceField] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          EvidenceField.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to EvidenceField: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to EvidenceField: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.0.0"
    
    def baboonDomainIdentifier: String = "manure.api"
    
    def baboonTypeIdentifier: String = "manure.api/:#EvidenceField"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[EvidenceField]] = Lazy(EvidenceField_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[EvidenceField]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[EvidenceField] = LazyInstance.value
  }
}