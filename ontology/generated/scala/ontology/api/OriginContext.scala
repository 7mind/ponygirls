import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package ontology.api {
  sealed trait OriginContext extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = OriginContext.baboonDomainVersion
    override def baboonDomainIdentifier: String = OriginContext.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = OriginContext.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = OriginContext.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = OriginContext.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = OriginContext.baboonMinReaderVersions
  }
  
  object OriginContext {
    final case class Unknown(
      reason: String
    ) extends OriginContext with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = OriginContext.Unknown.baboonDomainVersion
      override def baboonDomainIdentifier: String = OriginContext.Unknown.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = OriginContext.Unknown.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = OriginContext.Unknown.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = OriginContext.Unknown.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = OriginContext.Unknown.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = OriginContext.Unknown.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = OriginContext.Unknown.baboonAdtType
    }
    
    object Unknown {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#OriginContext]#Unknown"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#OriginContext"
      def baboonAdtType: _root_.java.lang.Class[?] = OriginContext.getClass
      def codecJson: BaboonJsonCodec[OriginContext.Unknown] = OriginContext.Unknown_JsonCodec.instance
    }
    
    object Unknown_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[OriginContext.Unknown, BaboonJsonCodec[OriginContext.Unknown]] {
      def encode(ctx: BaboonCodecContext, value: OriginContext.Unknown): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "reason" -> Json.fromString(value.reason)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, OriginContext.Unknown] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              reason <- getField(jsonObject, "reason").flatMap(v => decodeString(v.hcursor))
            } yield OriginContext.Unknown(reason)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Unknown: object expected"))
        }
      }
    
      def baboonDomainVersion: String = OriginContext.Unknown.baboonDomainVersion
      
      def baboonDomainIdentifier: String = OriginContext.Unknown.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = OriginContext.Unknown.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = OriginContext.Unknown.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = OriginContext.Unknown.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[OriginContext.Unknown]] = Lazy(OriginContext.Unknown_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[OriginContext.Unknown]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[OriginContext.Unknown] = LazyInstance.value
    }
    
    
    final case class ReportedNative(
      context: CaptureContext
    ) extends OriginContext with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = OriginContext.ReportedNative.baboonDomainVersion
      override def baboonDomainIdentifier: String = OriginContext.ReportedNative.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = OriginContext.ReportedNative.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = OriginContext.ReportedNative.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = OriginContext.ReportedNative.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = OriginContext.ReportedNative.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = OriginContext.ReportedNative.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = OriginContext.ReportedNative.baboonAdtType
    }
    
    object ReportedNative {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#OriginContext]#ReportedNative"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#OriginContext"
      def baboonAdtType: _root_.java.lang.Class[?] = OriginContext.getClass
      def codecJson: BaboonJsonCodec[OriginContext.ReportedNative] = OriginContext.ReportedNative_JsonCodec.instance
    }
    
    object ReportedNative_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[OriginContext.ReportedNative, BaboonJsonCodec[OriginContext.ReportedNative]] {
      def encode(ctx: BaboonCodecContext, value: OriginContext.ReportedNative): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "context" -> CaptureContext_JsonCodec.instance.encode(ctx, value.context)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, OriginContext.ReportedNative] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              context <- getField(jsonObject, "context").flatMap(v => CaptureContext_JsonCodec.circeDecoder(v.hcursor))
            } yield OriginContext.ReportedNative(context)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ReportedNative: object expected"))
        }
      }
    
      def baboonDomainVersion: String = OriginContext.ReportedNative.baboonDomainVersion
      
      def baboonDomainIdentifier: String = OriginContext.ReportedNative.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = OriginContext.ReportedNative.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = OriginContext.ReportedNative.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = OriginContext.ReportedNative.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[OriginContext.ReportedNative]] = Lazy(OriginContext.ReportedNative_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[OriginContext.ReportedNative]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[OriginContext.ReportedNative] = LazyInstance.value
    }
    
    
    final case class ServiceRequest(
      trace: RequestTrace
    ) extends OriginContext with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = OriginContext.ServiceRequest.baboonDomainVersion
      override def baboonDomainIdentifier: String = OriginContext.ServiceRequest.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = OriginContext.ServiceRequest.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = OriginContext.ServiceRequest.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = OriginContext.ServiceRequest.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = OriginContext.ServiceRequest.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = OriginContext.ServiceRequest.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = OriginContext.ServiceRequest.baboonAdtType
    }
    
    object ServiceRequest {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#OriginContext]#ServiceRequest"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#OriginContext"
      def baboonAdtType: _root_.java.lang.Class[?] = OriginContext.getClass
      def codecJson: BaboonJsonCodec[OriginContext.ServiceRequest] = OriginContext.ServiceRequest_JsonCodec.instance
    }
    
    object ServiceRequest_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[OriginContext.ServiceRequest, BaboonJsonCodec[OriginContext.ServiceRequest]] {
      def encode(ctx: BaboonCodecContext, value: OriginContext.ServiceRequest): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "trace" -> RequestTrace_JsonCodec.instance.encode(ctx, value.trace)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, OriginContext.ServiceRequest] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              trace <- getField(jsonObject, "trace").flatMap(v => RequestTrace_JsonCodec.circeDecoder(v.hcursor))
            } yield OriginContext.ServiceRequest(trace)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ServiceRequest: object expected"))
        }
      }
    
      def baboonDomainVersion: String = OriginContext.ServiceRequest.baboonDomainVersion
      
      def baboonDomainIdentifier: String = OriginContext.ServiceRequest.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = OriginContext.ServiceRequest.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = OriginContext.ServiceRequest.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = OriginContext.ServiceRequest.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[OriginContext.ServiceRequest]] = Lazy(OriginContext.ServiceRequest_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[OriginContext.ServiceRequest]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[OriginContext.ServiceRequest] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#OriginContext"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[OriginContext] = OriginContext_JsonCodec.instance
  }
  
  object OriginContext_JsonCodec extends BaboonJsonCodec.BaseGenerated[OriginContext, BaboonJsonCodec[OriginContext]] {
    def encode(ctx: BaboonCodecContext, value: OriginContext): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case unknown: OriginContext.Unknown => Json.obj("Unknown" -> OriginContext.Unknown_JsonCodec.instance.encode(ctx, unknown))
        
        case reportednative: OriginContext.ReportedNative => Json.obj("ReportedNative" -> OriginContext.ReportedNative_JsonCodec.instance.encode(ctx, reportednative))
        
        case servicerequest: OriginContext.ServiceRequest => Json.obj("ServiceRequest" -> OriginContext.ServiceRequest_JsonCodec.instance.encode(ctx, servicerequest))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, OriginContext] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Unknown" =>
                  OriginContext.Unknown_JsonCodec.instance.decode(ctx, json)
                
                case "ReportedNative" =>
                  OriginContext.ReportedNative_JsonCodec.instance.decode(ctx, json)
                
                case "ServiceRequest" =>
                  OriginContext.ServiceRequest_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to OriginContext: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to OriginContext: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to OriginContext: object expected"))
      }
    }
  
    def baboonDomainVersion: String = OriginContext.baboonDomainVersion
    
    def baboonDomainIdentifier: String = OriginContext.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = OriginContext.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[OriginContext]] = Lazy(OriginContext_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[OriginContext]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[OriginContext] = LazyInstance.value
  }
}