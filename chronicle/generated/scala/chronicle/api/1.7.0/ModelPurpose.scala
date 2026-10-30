import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_7_0 {
  @deprecated("Version 1.7.0 is deprecated, you should migrate to 1.8.0")
  sealed trait ModelPurpose
  
  object ModelPurpose extends BaboonEnum[ModelPurpose] {
    case object Annotation extends ModelPurpose
    case object DocumentEmbedding extends ModelPurpose
    case object QueryEmbedding extends ModelPurpose
    case object McpTest extends ModelPurpose
    
    def parse(s: String): Option[ModelPurpose] = {
      s match {
        case "Annotation" => Some(Annotation)
        case "DocumentEmbedding" => Some(DocumentEmbedding)
        case "QueryEmbedding" => Some(QueryEmbedding)
        case "McpTest" => Some(McpTest)
        case _ => None
      }
    }
    
    def all: List[ModelPurpose] = List(
      Annotation,
      DocumentEmbedding,
      QueryEmbedding,
      McpTest
    ) 
  }
  
  @deprecated("Version 1.7.0 is deprecated, you should migrate to 1.8.0")
  object ModelPurpose_JsonCodec extends BaboonJsonCodec.Base[ModelPurpose, BaboonJsonCodec[ModelPurpose]] {
    def encode(ctx: BaboonCodecContext, value: ModelPurpose): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ModelPurpose] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ModelPurpose.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ModelPurpose: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ModelPurpose: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.7.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#ModelPurpose"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ModelPurpose]] = Lazy(ModelPurpose_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ModelPurpose]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ModelPurpose] = LazyInstance.value
  }
}