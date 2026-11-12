import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package ontology.api {
  sealed trait OriginContextInput extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = OriginContextInput.baboonDomainVersion
    override def baboonDomainIdentifier: String = OriginContextInput.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = OriginContextInput.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = OriginContextInput.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = OriginContextInput.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = OriginContextInput.baboonMinReaderVersions
  }
  
  object OriginContextInput {
    final case class Unknown(
      reason: String
    ) extends OriginContextInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = OriginContextInput.Unknown.baboonDomainVersion
      override def baboonDomainIdentifier: String = OriginContextInput.Unknown.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = OriginContextInput.Unknown.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = OriginContextInput.Unknown.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = OriginContextInput.Unknown.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = OriginContextInput.Unknown.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = OriginContextInput.Unknown.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = OriginContextInput.Unknown.baboonAdtType
    }
    
    object Unknown {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#OriginContextInput]#Unknown"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#OriginContextInput"
      def baboonAdtType: _root_.java.lang.Class[?] = OriginContextInput.getClass
      def codecJson: BaboonJsonCodec[OriginContextInput.Unknown] = OriginContextInput.Unknown_JsonCodec.instance
    }
    
    object Unknown_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[OriginContextInput.Unknown, BaboonJsonCodec[OriginContextInput.Unknown]] {
      def encode(ctx: BaboonCodecContext, value: OriginContextInput.Unknown): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "reason" -> Json.fromString(value.reason)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, OriginContextInput.Unknown] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              reason <- getField(jsonObject, "reason").flatMap(v => decodeString(v.hcursor))
            } yield OriginContextInput.Unknown(reason)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Unknown: object expected"))
        }
      }
    
      def baboonDomainVersion: String = OriginContextInput.Unknown.baboonDomainVersion
      
      def baboonDomainIdentifier: String = OriginContextInput.Unknown.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = OriginContextInput.Unknown.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = OriginContextInput.Unknown.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = OriginContextInput.Unknown.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[OriginContextInput.Unknown]] = Lazy(OriginContextInput.Unknown_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[OriginContextInput.Unknown]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[OriginContextInput.Unknown] = LazyInstance.value
    }
    
    
    final case class ReportedNative(
      context: CaptureContext
    ) extends OriginContextInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = OriginContextInput.ReportedNative.baboonDomainVersion
      override def baboonDomainIdentifier: String = OriginContextInput.ReportedNative.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = OriginContextInput.ReportedNative.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = OriginContextInput.ReportedNative.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = OriginContextInput.ReportedNative.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = OriginContextInput.ReportedNative.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = OriginContextInput.ReportedNative.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = OriginContextInput.ReportedNative.baboonAdtType
    }
    
    object ReportedNative {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#OriginContextInput]#ReportedNative"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#OriginContextInput"
      def baboonAdtType: _root_.java.lang.Class[?] = OriginContextInput.getClass
      def codecJson: BaboonJsonCodec[OriginContextInput.ReportedNative] = OriginContextInput.ReportedNative_JsonCodec.instance
    }
    
    object ReportedNative_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[OriginContextInput.ReportedNative, BaboonJsonCodec[OriginContextInput.ReportedNative]] {
      def encode(ctx: BaboonCodecContext, value: OriginContextInput.ReportedNative): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "context" -> CaptureContext_JsonCodec.instance.encode(ctx, value.context)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, OriginContextInput.ReportedNative] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              context <- getField(jsonObject, "context").flatMap(v => CaptureContext_JsonCodec.circeDecoder(v.hcursor))
            } yield OriginContextInput.ReportedNative(context)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ReportedNative: object expected"))
        }
      }
    
      def baboonDomainVersion: String = OriginContextInput.ReportedNative.baboonDomainVersion
      
      def baboonDomainIdentifier: String = OriginContextInput.ReportedNative.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = OriginContextInput.ReportedNative.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = OriginContextInput.ReportedNative.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = OriginContextInput.ReportedNative.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[OriginContextInput.ReportedNative]] = Lazy(OriginContextInput.ReportedNative_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[OriginContextInput.ReportedNative]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[OriginContextInput.ReportedNative] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#OriginContextInput"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[OriginContextInput] = OriginContextInput_JsonCodec.instance
  }
  
  object OriginContextInput_JsonCodec extends BaboonJsonCodec.BaseGenerated[OriginContextInput, BaboonJsonCodec[OriginContextInput]] {
    def encode(ctx: BaboonCodecContext, value: OriginContextInput): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case unknown: OriginContextInput.Unknown => Json.obj("Unknown" -> OriginContextInput.Unknown_JsonCodec.instance.encode(ctx, unknown))
        
        case reportednative: OriginContextInput.ReportedNative => Json.obj("ReportedNative" -> OriginContextInput.ReportedNative_JsonCodec.instance.encode(ctx, reportednative))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, OriginContextInput] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Unknown" =>
                  OriginContextInput.Unknown_JsonCodec.instance.decode(ctx, json)
                
                case "ReportedNative" =>
                  OriginContextInput.ReportedNative_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to OriginContextInput: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to OriginContextInput: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to OriginContextInput: object expected"))
      }
    }
  
    def baboonDomainVersion: String = OriginContextInput.baboonDomainVersion
    
    def baboonDomainIdentifier: String = OriginContextInput.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = OriginContextInput.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[OriginContextInput]] = Lazy(OriginContextInput_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[OriginContextInput]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[OriginContextInput] = LazyInstance.value
  }
}