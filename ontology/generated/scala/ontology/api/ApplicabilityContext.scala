import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package ontology.api {
  sealed trait ApplicabilityContext extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ApplicabilityContext.baboonDomainVersion
    override def baboonDomainIdentifier: String = ApplicabilityContext.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ApplicabilityContext.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ApplicabilityContext.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ApplicabilityContext.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ApplicabilityContext.baboonMinReaderVersions
  }
  
  object ApplicabilityContext {
    final case class Capture(
      source: Ref
    ) extends ApplicabilityContext with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ApplicabilityContext.Capture.baboonDomainVersion
      override def baboonDomainIdentifier: String = ApplicabilityContext.Capture.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ApplicabilityContext.Capture.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ApplicabilityContext.Capture.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ApplicabilityContext.Capture.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ApplicabilityContext.Capture.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ApplicabilityContext.Capture.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityContext.Capture.baboonAdtType
    }
    
    object Capture {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ApplicabilityContext]#Capture"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ApplicabilityContext"
      def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityContext.getClass
      def codecJson: BaboonJsonCodec[ApplicabilityContext.Capture] = ApplicabilityContext.Capture_JsonCodec.instance
    }
    
    object Capture_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ApplicabilityContext.Capture, BaboonJsonCodec[ApplicabilityContext.Capture]] {
      def encode(ctx: BaboonCodecContext, value: ApplicabilityContext.Capture): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "source" -> Ref_JsonCodec.instance.encode(ctx, value.source)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ApplicabilityContext.Capture] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              source <- getField(jsonObject, "source").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            } yield ApplicabilityContext.Capture(source)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Capture: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ApplicabilityContext.Capture.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ApplicabilityContext.Capture.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ApplicabilityContext.Capture.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ApplicabilityContext.Capture.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityContext.Capture.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ApplicabilityContext.Capture]] = Lazy(ApplicabilityContext.Capture_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ApplicabilityContext.Capture]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ApplicabilityContext.Capture] = LazyInstance.value
    }
    
    
    final case class Subject(
      ref: Ref
    ) extends ApplicabilityContext with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ApplicabilityContext.Subject.baboonDomainVersion
      override def baboonDomainIdentifier: String = ApplicabilityContext.Subject.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ApplicabilityContext.Subject.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ApplicabilityContext.Subject.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ApplicabilityContext.Subject.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ApplicabilityContext.Subject.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ApplicabilityContext.Subject.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityContext.Subject.baboonAdtType
    }
    
    object Subject {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ApplicabilityContext]#Subject"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ApplicabilityContext"
      def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityContext.getClass
      def codecJson: BaboonJsonCodec[ApplicabilityContext.Subject] = ApplicabilityContext.Subject_JsonCodec.instance
    }
    
    object Subject_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ApplicabilityContext.Subject, BaboonJsonCodec[ApplicabilityContext.Subject]] {
      def encode(ctx: BaboonCodecContext, value: ApplicabilityContext.Subject): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ApplicabilityContext.Subject] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
            } yield ApplicabilityContext.Subject(ref)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Subject: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ApplicabilityContext.Subject.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ApplicabilityContext.Subject.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ApplicabilityContext.Subject.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ApplicabilityContext.Subject.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityContext.Subject.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ApplicabilityContext.Subject]] = Lazy(ApplicabilityContext.Subject_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ApplicabilityContext.Subject]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ApplicabilityContext.Subject] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ApplicabilityContext"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ApplicabilityContext] = ApplicabilityContext_JsonCodec.instance
  }
  
  object ApplicabilityContext_JsonCodec extends BaboonJsonCodec.BaseGenerated[ApplicabilityContext, BaboonJsonCodec[ApplicabilityContext]] {
    def encode(ctx: BaboonCodecContext, value: ApplicabilityContext): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case capture: ApplicabilityContext.Capture => Json.obj("Capture" -> ApplicabilityContext.Capture_JsonCodec.instance.encode(ctx, capture))
        
        case subject: ApplicabilityContext.Subject => Json.obj("Subject" -> ApplicabilityContext.Subject_JsonCodec.instance.encode(ctx, subject))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ApplicabilityContext] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Capture" =>
                  ApplicabilityContext.Capture_JsonCodec.instance.decode(ctx, json)
                
                case "Subject" =>
                  ApplicabilityContext.Subject_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ApplicabilityContext: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ApplicabilityContext: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ApplicabilityContext: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ApplicabilityContext.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ApplicabilityContext.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ApplicabilityContext.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ApplicabilityContext]] = Lazy(ApplicabilityContext_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ApplicabilityContext]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ApplicabilityContext] = LazyInstance.value
  }
}