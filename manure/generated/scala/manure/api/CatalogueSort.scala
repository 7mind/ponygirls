import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package manure.api {
  sealed trait CatalogueSort
  
  object CatalogueSort extends BaboonEnum[CatalogueSort] {
    case object Name extends CatalogueSort
    case object CreatedAt extends CatalogueSort
    case object ExpiresAt extends CatalogueSort
    case object TotalBytes extends CatalogueSort
    case object FileCount extends CatalogueSort
    case object Visibility extends CatalogueSort
    case object State extends CatalogueSort
    case object Kind extends CatalogueSort
    case object CreatedByUser extends CatalogueSort
    
    def parse(s: String): Option[CatalogueSort] = {
      s match {
        case "Name" => Some(Name)
        case "CreatedAt" => Some(CreatedAt)
        case "ExpiresAt" => Some(ExpiresAt)
        case "TotalBytes" => Some(TotalBytes)
        case "FileCount" => Some(FileCount)
        case "Visibility" => Some(Visibility)
        case "State" => Some(State)
        case "Kind" => Some(Kind)
        case "CreatedByUser" => Some(CreatedByUser)
        case _ => None
      }
    }
    
    def all: List[CatalogueSort] = List(
      Name,
      CreatedAt,
      ExpiresAt,
      TotalBytes,
      FileCount,
      Visibility,
      State,
      Kind,
      CreatedByUser
    ) 
  }
  
  object CatalogueSort_JsonCodec extends BaboonJsonCodec.Base[CatalogueSort, BaboonJsonCodec[CatalogueSort]] {
    def encode(ctx: BaboonCodecContext, value: CatalogueSort): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, CatalogueSort] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          CatalogueSort.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CatalogueSort: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to CatalogueSort: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.0.0"
    
    def baboonDomainIdentifier: String = "manure.api"
    
    def baboonTypeIdentifier: String = "manure.api/:#CatalogueSort"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[CatalogueSort]] = Lazy(CatalogueSort_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[CatalogueSort]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[CatalogueSort] = LazyInstance.value
  }
}