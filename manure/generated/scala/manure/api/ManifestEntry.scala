import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package manure.api {
  sealed trait ManifestEntry extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ManifestEntry.baboonDomainVersion
    override def baboonDomainIdentifier: String = ManifestEntry.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ManifestEntry.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ManifestEntry.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ManifestEntry.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ManifestEntry.baboonMinReaderVersions
  }
  
  object ManifestEntry {
    final case class File(
      path: String,
      size: Long,
      sha256: String
    ) extends ManifestEntry with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ManifestEntry.File.baboonDomainVersion
      override def baboonDomainIdentifier: String = ManifestEntry.File.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ManifestEntry.File.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ManifestEntry.File.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ManifestEntry.File.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ManifestEntry.File.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ManifestEntry.File.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ManifestEntry.File.baboonAdtType
    }
    
    object File {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#ManifestEntry]#File"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#ManifestEntry"
      def baboonAdtType: _root_.java.lang.Class[?] = ManifestEntry.getClass
      def codecJson: BaboonJsonCodec[ManifestEntry.File] = ManifestEntry.File_JsonCodec.instance
    }
    
    object File_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ManifestEntry.File, BaboonJsonCodec[ManifestEntry.File]] {
      def encode(ctx: BaboonCodecContext, value: ManifestEntry.File): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "path" -> Json.fromString(value.path),
          "size" -> Json.fromString(value.size.toString),
          "sha256" -> Json.fromString(value.sha256)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ManifestEntry.File] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              path <- getField(jsonObject, "path").flatMap(v => decodeString(v.hcursor))
              size <- getField(jsonObject, "size").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
              sha256 <- getField(jsonObject, "sha256").flatMap(v => decodeString(v.hcursor))
            } yield ManifestEntry.File(path,size,sha256)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to File: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ManifestEntry.File.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ManifestEntry.File.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ManifestEntry.File.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ManifestEntry.File.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ManifestEntry.File.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ManifestEntry.File]] = Lazy(ManifestEntry.File_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ManifestEntry.File]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ManifestEntry.File] = LazyInstance.value
    }
    
    
    final case class Directory(
      path: String
    ) extends ManifestEntry with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ManifestEntry.Directory.baboonDomainVersion
      override def baboonDomainIdentifier: String = ManifestEntry.Directory.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ManifestEntry.Directory.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ManifestEntry.Directory.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ManifestEntry.Directory.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ManifestEntry.Directory.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ManifestEntry.Directory.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ManifestEntry.Directory.baboonAdtType
    }
    
    object Directory {
      def baboonDomainVersion: String = "1.0.0"
      def baboonDomainIdentifier: String = "manure.api"
      def baboonTypeIdentifier: String = "manure.api/[manure.api/:#ManifestEntry]#Directory"
      private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "manure.api/:#ManifestEntry"
      def baboonAdtType: _root_.java.lang.Class[?] = ManifestEntry.getClass
      def codecJson: BaboonJsonCodec[ManifestEntry.Directory] = ManifestEntry.Directory_JsonCodec.instance
    }
    
    object Directory_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ManifestEntry.Directory, BaboonJsonCodec[ManifestEntry.Directory]] {
      def encode(ctx: BaboonCodecContext, value: ManifestEntry.Directory): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "path" -> Json.fromString(value.path)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ManifestEntry.Directory] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              path <- getField(jsonObject, "path").flatMap(v => decodeString(v.hcursor))
            } yield ManifestEntry.Directory(path)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Directory: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ManifestEntry.Directory.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ManifestEntry.Directory.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ManifestEntry.Directory.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ManifestEntry.Directory.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ManifestEntry.Directory.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ManifestEntry.Directory]] = Lazy(ManifestEntry.Directory_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ManifestEntry.Directory]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ManifestEntry.Directory] = LazyInstance.value
    }
    def baboonDomainVersion: String = "1.0.0"
    def baboonDomainIdentifier: String = "manure.api"
    def baboonTypeIdentifier: String = "manure.api/:#ManifestEntry"
    private lazy val _baboonSameInVersions: List[String] = List("1.0.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.0.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.0.0", "prefix-compact" -> "1.0.0", "prefix-any-mode" -> "1.0.0", "identical" -> "1.0.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ManifestEntry] = ManifestEntry_JsonCodec.instance
  }
  
  object ManifestEntry_JsonCodec extends BaboonJsonCodec.BaseGenerated[ManifestEntry, BaboonJsonCodec[ManifestEntry]] {
    def encode(ctx: BaboonCodecContext, value: ManifestEntry): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case file: ManifestEntry.File => Json.obj("File" -> ManifestEntry.File_JsonCodec.instance.encode(ctx, file))
        
        case directory: ManifestEntry.Directory => Json.obj("Directory" -> ManifestEntry.Directory_JsonCodec.instance.encode(ctx, directory))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ManifestEntry] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "File" =>
                  ManifestEntry.File_JsonCodec.instance.decode(ctx, json)
                
                case "Directory" =>
                  ManifestEntry.Directory_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ManifestEntry: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ManifestEntry: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ManifestEntry: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ManifestEntry.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ManifestEntry.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ManifestEntry.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ManifestEntry]] = Lazy(ManifestEntry_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ManifestEntry]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ManifestEntry] = LazyInstance.value
  }
}