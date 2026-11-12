import io.circe.Decoder.{decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

import java.util.UUID

package ontology.api {
  sealed trait SourceDescriptor extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = SourceDescriptor.baboonDomainVersion
    override def baboonDomainIdentifier: String = SourceDescriptor.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = SourceDescriptor.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = SourceDescriptor.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = SourceDescriptor.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = SourceDescriptor.baboonMinReaderVersions
  }
  
  object SourceDescriptor {
    final case class PrimaryCapture(
      eventId: UUID,
      sourceNamespace: String,
      captureContext: ContextRecord,
      metadata: CaptureMetadata,
      origin: EventOrigin,
      observation: Observation,
      reviewResponse: Option[ReviewResponseLink]
    ) extends SourceDescriptor with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = SourceDescriptor.PrimaryCapture.baboonDomainVersion
      override def baboonDomainIdentifier: String = SourceDescriptor.PrimaryCapture.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = SourceDescriptor.PrimaryCapture.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = SourceDescriptor.PrimaryCapture.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = SourceDescriptor.PrimaryCapture.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = SourceDescriptor.PrimaryCapture.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = SourceDescriptor.PrimaryCapture.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = SourceDescriptor.PrimaryCapture.baboonAdtType
    }
    
    object PrimaryCapture {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#SourceDescriptor]#PrimaryCapture"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#SourceDescriptor"
      def baboonAdtType: _root_.java.lang.Class[?] = SourceDescriptor.getClass
      def codecJson: BaboonJsonCodec[SourceDescriptor.PrimaryCapture] = SourceDescriptor.PrimaryCapture_JsonCodec.instance
    }
    
    object PrimaryCapture_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[SourceDescriptor.PrimaryCapture, BaboonJsonCodec[SourceDescriptor.PrimaryCapture]] {
      def encode(ctx: BaboonCodecContext, value: SourceDescriptor.PrimaryCapture): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "eventId" -> Json.fromString(value.eventId.toString()),
          "sourceNamespace" -> Json.fromString(value.sourceNamespace),
          "captureContext" -> ContextRecord_JsonCodec.instance.encode(ctx, value.captureContext),
          "metadata" -> CaptureMetadata_JsonCodec.instance.encode(ctx, value.metadata),
          "origin" -> EventOrigin_JsonCodec.instance.encode(ctx, value.origin),
          "observation" -> Observation_JsonCodec.instance.encode(ctx, value.observation),
          "reviewResponse" -> value.reviewResponse.map(v => ReviewResponseLink_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SourceDescriptor.PrimaryCapture] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              eventId <- getField(jsonObject, "eventId").flatMap(v => decodeUUID(v.hcursor))
              sourceNamespace <- getField(jsonObject, "sourceNamespace").flatMap(v => decodeString(v.hcursor))
              captureContext <- getField(jsonObject, "captureContext").flatMap(v => ContextRecord_JsonCodec.circeDecoder(v.hcursor))
              metadata <- getField(jsonObject, "metadata").flatMap(v => CaptureMetadata_JsonCodec.circeDecoder(v.hcursor))
              origin <- getField(jsonObject, "origin").flatMap(v => EventOrigin_JsonCodec.circeDecoder(v.hcursor))
              observation <- getField(jsonObject, "observation").flatMap(v => Observation_JsonCodec.circeDecoder(v.hcursor))
              reviewResponse <- getField(jsonObject, "reviewResponse").flatMap(v => decodeOption(ReviewResponseLink_JsonCodec.circeDecoder)(v.hcursor))
            } yield SourceDescriptor.PrimaryCapture(eventId,sourceNamespace,captureContext,metadata,origin,observation,reviewResponse)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to PrimaryCapture: object expected"))
        }
      }
    
      def baboonDomainVersion: String = SourceDescriptor.PrimaryCapture.baboonDomainVersion
      
      def baboonDomainIdentifier: String = SourceDescriptor.PrimaryCapture.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = SourceDescriptor.PrimaryCapture.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = SourceDescriptor.PrimaryCapture.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = SourceDescriptor.PrimaryCapture.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SourceDescriptor.PrimaryCapture]] = Lazy(SourceDescriptor.PrimaryCapture_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[SourceDescriptor.PrimaryCapture]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[SourceDescriptor.PrimaryCapture] = LazyInstance.value
    }
    
    
    final case class DerivedPresentation(
      presentationId: UUID,
      generation: Long,
      payloadDigest: String,
      preparedAt: String,
      preparationTrace: RequestTrace
    ) extends SourceDescriptor with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = SourceDescriptor.DerivedPresentation.baboonDomainVersion
      override def baboonDomainIdentifier: String = SourceDescriptor.DerivedPresentation.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = SourceDescriptor.DerivedPresentation.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = SourceDescriptor.DerivedPresentation.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = SourceDescriptor.DerivedPresentation.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = SourceDescriptor.DerivedPresentation.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = SourceDescriptor.DerivedPresentation.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = SourceDescriptor.DerivedPresentation.baboonAdtType
    }
    
    object DerivedPresentation {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#SourceDescriptor]#DerivedPresentation"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#SourceDescriptor"
      def baboonAdtType: _root_.java.lang.Class[?] = SourceDescriptor.getClass
      def codecJson: BaboonJsonCodec[SourceDescriptor.DerivedPresentation] = SourceDescriptor.DerivedPresentation_JsonCodec.instance
    }
    
    object DerivedPresentation_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[SourceDescriptor.DerivedPresentation, BaboonJsonCodec[SourceDescriptor.DerivedPresentation]] {
      def encode(ctx: BaboonCodecContext, value: SourceDescriptor.DerivedPresentation): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "presentationId" -> Json.fromString(value.presentationId.toString()),
          "generation" -> Json.fromString(value.generation.toString),
          "payloadDigest" -> Json.fromString(value.payloadDigest),
          "preparedAt" -> Json.fromString(value.preparedAt),
          "preparationTrace" -> RequestTrace_JsonCodec.instance.encode(ctx, value.preparationTrace)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SourceDescriptor.DerivedPresentation] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              presentationId <- getField(jsonObject, "presentationId").flatMap(v => decodeUUID(v.hcursor))
              generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
              payloadDigest <- getField(jsonObject, "payloadDigest").flatMap(v => decodeString(v.hcursor))
              preparedAt <- getField(jsonObject, "preparedAt").flatMap(v => decodeString(v.hcursor))
              preparationTrace <- getField(jsonObject, "preparationTrace").flatMap(v => RequestTrace_JsonCodec.circeDecoder(v.hcursor))
            } yield SourceDescriptor.DerivedPresentation(presentationId,generation,payloadDigest,preparedAt,preparationTrace)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to DerivedPresentation: object expected"))
        }
      }
    
      def baboonDomainVersion: String = SourceDescriptor.DerivedPresentation.baboonDomainVersion
      
      def baboonDomainIdentifier: String = SourceDescriptor.DerivedPresentation.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = SourceDescriptor.DerivedPresentation.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = SourceDescriptor.DerivedPresentation.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = SourceDescriptor.DerivedPresentation.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SourceDescriptor.DerivedPresentation]] = Lazy(SourceDescriptor.DerivedPresentation_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[SourceDescriptor.DerivedPresentation]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[SourceDescriptor.DerivedPresentation] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#SourceDescriptor"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[SourceDescriptor] = SourceDescriptor_JsonCodec.instance
  }
  
  object SourceDescriptor_JsonCodec extends BaboonJsonCodec.BaseGenerated[SourceDescriptor, BaboonJsonCodec[SourceDescriptor]] {
    def encode(ctx: BaboonCodecContext, value: SourceDescriptor): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case primarycapture: SourceDescriptor.PrimaryCapture => Json.obj("PrimaryCapture" -> SourceDescriptor.PrimaryCapture_JsonCodec.instance.encode(ctx, primarycapture))
        
        case derivedpresentation: SourceDescriptor.DerivedPresentation => Json.obj("DerivedPresentation" -> SourceDescriptor.DerivedPresentation_JsonCodec.instance.encode(ctx, derivedpresentation))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, SourceDescriptor] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "PrimaryCapture" =>
                  SourceDescriptor.PrimaryCapture_JsonCodec.instance.decode(ctx, json)
                
                case "DerivedPresentation" =>
                  SourceDescriptor.DerivedPresentation_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to SourceDescriptor: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to SourceDescriptor: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to SourceDescriptor: object expected"))
      }
    }
  
    def baboonDomainVersion: String = SourceDescriptor.baboonDomainVersion
    
    def baboonDomainIdentifier: String = SourceDescriptor.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = SourceDescriptor.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[SourceDescriptor]] = Lazy(SourceDescriptor_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[SourceDescriptor]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[SourceDescriptor] = LazyInstance.value
  }
}