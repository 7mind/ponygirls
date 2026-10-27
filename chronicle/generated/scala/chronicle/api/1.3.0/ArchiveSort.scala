import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonCodecContext, BaboonEnum, Lazy}

package chronicle.api.v1_3_0 {
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.5.0")
  sealed trait ArchiveSort
  
  object ArchiveSort extends BaboonEnum[ArchiveSort] {
    case object LastTimestamp extends ArchiveSort
    case object Title extends ArchiveSort
    case object Owner extends ArchiveSort
    case object Project extends ArchiveSort
    case object Branch extends ArchiveSort
    case object Producer extends ArchiveSort
    case object Format extends ArchiveSort
    case object Model extends ArchiveSort
    case object Status extends ArchiveSort
    case object MessageCount extends ArchiveSort
    case object Tags extends ArchiveSort
    
    def parse(s: String): Option[ArchiveSort] = {
      s match {
        case "LastTimestamp" => Some(LastTimestamp)
        case "Title" => Some(Title)
        case "Owner" => Some(Owner)
        case "Project" => Some(Project)
        case "Branch" => Some(Branch)
        case "Producer" => Some(Producer)
        case "Format" => Some(Format)
        case "Model" => Some(Model)
        case "Status" => Some(Status)
        case "MessageCount" => Some(MessageCount)
        case "Tags" => Some(Tags)
        case _ => None
      }
    }
    
    def all: List[ArchiveSort] = List(
      LastTimestamp,
      Title,
      Owner,
      Project,
      Branch,
      Producer,
      Format,
      Model,
      Status,
      MessageCount,
      Tags
    ) 
  }
  
  @deprecated("Version 1.3.0 is deprecated, you should migrate to 1.5.0")
  object ArchiveSort_JsonCodec extends BaboonJsonCodec.Base[ArchiveSort, BaboonJsonCodec[ArchiveSort]] {
    def encode(ctx: BaboonCodecContext, value: ArchiveSort): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      Json.fromString(value.toString)
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ArchiveSort] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asString match {
        case Some(str) =>
          ArchiveSort.parse(str.trim) match {
            case Some(result) => Right(result)
            case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ArchiveSort: no matching value"))
          }
        case None => Left(new IllegalArgumentException(s"Cannot decode $wire to ArchiveSort: string expected"))
      }
    }
  
    def baboonDomainVersion: String = "1.3.0"
    
    def baboonDomainIdentifier: String = "chronicle.api"
    
    def baboonTypeIdentifier: String = "chronicle.api/:#ArchiveSort"
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ArchiveSort]] = Lazy(ArchiveSort_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ArchiveSort]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ArchiveSort] = LazyInstance.value
  }
}