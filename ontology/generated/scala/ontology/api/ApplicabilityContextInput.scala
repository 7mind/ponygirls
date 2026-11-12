import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package ontology.api {
  sealed trait ApplicabilityContextInput extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ApplicabilityContextInput.baboonDomainVersion
    override def baboonDomainIdentifier: String = ApplicabilityContextInput.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ApplicabilityContextInput.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ApplicabilityContextInput.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ApplicabilityContextInput.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ApplicabilityContextInput.baboonMinReaderVersions
  }
  
  object ApplicabilityContextInput {
    final case class Capture(
      source: Target
    ) extends ApplicabilityContextInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ApplicabilityContextInput.Capture.baboonDomainVersion
      override def baboonDomainIdentifier: String = ApplicabilityContextInput.Capture.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ApplicabilityContextInput.Capture.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ApplicabilityContextInput.Capture.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ApplicabilityContextInput.Capture.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ApplicabilityContextInput.Capture.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ApplicabilityContextInput.Capture.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityContextInput.Capture.baboonAdtType
    }
    
    object Capture {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ApplicabilityContextInput]#Capture"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ApplicabilityContextInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityContextInput.getClass
      def codecJson: BaboonJsonCodec[ApplicabilityContextInput.Capture] = ApplicabilityContextInput.Capture_JsonCodec.instance
    }
    
    object Capture_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ApplicabilityContextInput.Capture, BaboonJsonCodec[ApplicabilityContextInput.Capture]] {
      def encode(ctx: BaboonCodecContext, value: ApplicabilityContextInput.Capture): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "source" -> Target_JsonCodec.instance.encode(ctx, value.source)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ApplicabilityContextInput.Capture] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              source <- getField(jsonObject, "source").flatMap(v => Target_JsonCodec.circeDecoder(v.hcursor))
            } yield ApplicabilityContextInput.Capture(source)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Capture: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ApplicabilityContextInput.Capture.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ApplicabilityContextInput.Capture.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ApplicabilityContextInput.Capture.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ApplicabilityContextInput.Capture.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityContextInput.Capture.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ApplicabilityContextInput.Capture]] = Lazy(ApplicabilityContextInput.Capture_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ApplicabilityContextInput.Capture]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ApplicabilityContextInput.Capture] = LazyInstance.value
    }
    
    
    final case class Subject(
      ref: Target
    ) extends ApplicabilityContextInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ApplicabilityContextInput.Subject.baboonDomainVersion
      override def baboonDomainIdentifier: String = ApplicabilityContextInput.Subject.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ApplicabilityContextInput.Subject.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ApplicabilityContextInput.Subject.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ApplicabilityContextInput.Subject.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ApplicabilityContextInput.Subject.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ApplicabilityContextInput.Subject.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityContextInput.Subject.baboonAdtType
    }
    
    object Subject {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ApplicabilityContextInput]#Subject"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ApplicabilityContextInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityContextInput.getClass
      def codecJson: BaboonJsonCodec[ApplicabilityContextInput.Subject] = ApplicabilityContextInput.Subject_JsonCodec.instance
    }
    
    object Subject_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ApplicabilityContextInput.Subject, BaboonJsonCodec[ApplicabilityContextInput.Subject]] {
      def encode(ctx: BaboonCodecContext, value: ApplicabilityContextInput.Subject): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "ref" -> Target_JsonCodec.instance.encode(ctx, value.ref)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ApplicabilityContextInput.Subject] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              ref <- getField(jsonObject, "ref").flatMap(v => Target_JsonCodec.circeDecoder(v.hcursor))
            } yield ApplicabilityContextInput.Subject(ref)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Subject: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ApplicabilityContextInput.Subject.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ApplicabilityContextInput.Subject.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ApplicabilityContextInput.Subject.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ApplicabilityContextInput.Subject.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ApplicabilityContextInput.Subject.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ApplicabilityContextInput.Subject]] = Lazy(ApplicabilityContextInput.Subject_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ApplicabilityContextInput.Subject]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ApplicabilityContextInput.Subject] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ApplicabilityContextInput"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ApplicabilityContextInput] = ApplicabilityContextInput_JsonCodec.instance
  }
  
  object ApplicabilityContextInput_JsonCodec extends BaboonJsonCodec.BaseGenerated[ApplicabilityContextInput, BaboonJsonCodec[ApplicabilityContextInput]] {
    def encode(ctx: BaboonCodecContext, value: ApplicabilityContextInput): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case capture: ApplicabilityContextInput.Capture => Json.obj("Capture" -> ApplicabilityContextInput.Capture_JsonCodec.instance.encode(ctx, capture))
        
        case subject: ApplicabilityContextInput.Subject => Json.obj("Subject" -> ApplicabilityContextInput.Subject_JsonCodec.instance.encode(ctx, subject))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ApplicabilityContextInput] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Capture" =>
                  ApplicabilityContextInput.Capture_JsonCodec.instance.decode(ctx, json)
                
                case "Subject" =>
                  ApplicabilityContextInput.Subject_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ApplicabilityContextInput: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ApplicabilityContextInput: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ApplicabilityContextInput: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ApplicabilityContextInput.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ApplicabilityContextInput.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ApplicabilityContextInput.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ApplicabilityContextInput]] = Lazy(ApplicabilityContextInput_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ApplicabilityContextInput]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ApplicabilityContextInput] = LazyInstance.value
  }
}