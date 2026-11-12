import io.circe.Decoder.decodeUUID
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

import java.util.UUID

package ontology.api {
  sealed trait InheritanceAnchor extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = InheritanceAnchor.baboonDomainVersion
    override def baboonDomainIdentifier: String = InheritanceAnchor.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = InheritanceAnchor.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = InheritanceAnchor.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = InheritanceAnchor.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = InheritanceAnchor.baboonMinReaderVersions
  }
  
  object InheritanceAnchor {
    final case class ReportedEpoch(
      source: Ref,
      epoch: UUID
    ) extends InheritanceAnchor with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = InheritanceAnchor.ReportedEpoch.baboonDomainVersion
      override def baboonDomainIdentifier: String = InheritanceAnchor.ReportedEpoch.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = InheritanceAnchor.ReportedEpoch.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = InheritanceAnchor.ReportedEpoch.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = InheritanceAnchor.ReportedEpoch.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = InheritanceAnchor.ReportedEpoch.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = InheritanceAnchor.ReportedEpoch.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = InheritanceAnchor.ReportedEpoch.baboonAdtType
    }
    
    object ReportedEpoch {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#InheritanceAnchor]#ReportedEpoch"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#InheritanceAnchor"
      def baboonAdtType: _root_.java.lang.Class[?] = InheritanceAnchor.getClass
      def codecJson: BaboonJsonCodec[InheritanceAnchor.ReportedEpoch] = InheritanceAnchor.ReportedEpoch_JsonCodec.instance
    }
    
    object ReportedEpoch_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[InheritanceAnchor.ReportedEpoch, BaboonJsonCodec[InheritanceAnchor.ReportedEpoch]] {
      def encode(ctx: BaboonCodecContext, value: InheritanceAnchor.ReportedEpoch): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "source" -> Ref_JsonCodec.instance.encode(ctx, value.source),
          "epoch" -> Json.fromString(value.epoch.toString())
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, InheritanceAnchor.ReportedEpoch] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              source <- getField(jsonObject, "source").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
              epoch <- getField(jsonObject, "epoch").flatMap(v => decodeUUID(v.hcursor))
            } yield InheritanceAnchor.ReportedEpoch(source,epoch)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ReportedEpoch: object expected"))
        }
      }
    
      def baboonDomainVersion: String = InheritanceAnchor.ReportedEpoch.baboonDomainVersion
      
      def baboonDomainIdentifier: String = InheritanceAnchor.ReportedEpoch.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = InheritanceAnchor.ReportedEpoch.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = InheritanceAnchor.ReportedEpoch.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = InheritanceAnchor.ReportedEpoch.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[InheritanceAnchor.ReportedEpoch]] = Lazy(InheritanceAnchor.ReportedEpoch_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[InheritanceAnchor.ReportedEpoch]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[InheritanceAnchor.ReportedEpoch] = LazyInstance.value
    }
    
    
    final case class ReportedParent(
      source: Ref,
      epoch: UUID
    ) extends InheritanceAnchor with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = InheritanceAnchor.ReportedParent.baboonDomainVersion
      override def baboonDomainIdentifier: String = InheritanceAnchor.ReportedParent.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = InheritanceAnchor.ReportedParent.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = InheritanceAnchor.ReportedParent.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = InheritanceAnchor.ReportedParent.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = InheritanceAnchor.ReportedParent.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = InheritanceAnchor.ReportedParent.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = InheritanceAnchor.ReportedParent.baboonAdtType
    }
    
    object ReportedParent {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#InheritanceAnchor]#ReportedParent"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#InheritanceAnchor"
      def baboonAdtType: _root_.java.lang.Class[?] = InheritanceAnchor.getClass
      def codecJson: BaboonJsonCodec[InheritanceAnchor.ReportedParent] = InheritanceAnchor.ReportedParent_JsonCodec.instance
    }
    
    object ReportedParent_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[InheritanceAnchor.ReportedParent, BaboonJsonCodec[InheritanceAnchor.ReportedParent]] {
      def encode(ctx: BaboonCodecContext, value: InheritanceAnchor.ReportedParent): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "source" -> Ref_JsonCodec.instance.encode(ctx, value.source),
          "epoch" -> Json.fromString(value.epoch.toString())
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, InheritanceAnchor.ReportedParent] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              source <- getField(jsonObject, "source").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
              epoch <- getField(jsonObject, "epoch").flatMap(v => decodeUUID(v.hcursor))
            } yield InheritanceAnchor.ReportedParent(source,epoch)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ReportedParent: object expected"))
        }
      }
    
      def baboonDomainVersion: String = InheritanceAnchor.ReportedParent.baboonDomainVersion
      
      def baboonDomainIdentifier: String = InheritanceAnchor.ReportedParent.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = InheritanceAnchor.ReportedParent.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = InheritanceAnchor.ReportedParent.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = InheritanceAnchor.ReportedParent.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[InheritanceAnchor.ReportedParent]] = Lazy(InheritanceAnchor.ReportedParent_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[InheritanceAnchor.ReportedParent]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[InheritanceAnchor.ReportedParent] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#InheritanceAnchor"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[InheritanceAnchor] = InheritanceAnchor_JsonCodec.instance
  }
  
  object InheritanceAnchor_JsonCodec extends BaboonJsonCodec.BaseGenerated[InheritanceAnchor, BaboonJsonCodec[InheritanceAnchor]] {
    def encode(ctx: BaboonCodecContext, value: InheritanceAnchor): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case reportedepoch: InheritanceAnchor.ReportedEpoch => Json.obj("ReportedEpoch" -> InheritanceAnchor.ReportedEpoch_JsonCodec.instance.encode(ctx, reportedepoch))
        
        case reportedparent: InheritanceAnchor.ReportedParent => Json.obj("ReportedParent" -> InheritanceAnchor.ReportedParent_JsonCodec.instance.encode(ctx, reportedparent))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, InheritanceAnchor] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "ReportedEpoch" =>
                  InheritanceAnchor.ReportedEpoch_JsonCodec.instance.decode(ctx, json)
                
                case "ReportedParent" =>
                  InheritanceAnchor.ReportedParent_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to InheritanceAnchor: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to InheritanceAnchor: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to InheritanceAnchor: object expected"))
      }
    }
  
    def baboonDomainVersion: String = InheritanceAnchor.baboonDomainVersion
    
    def baboonDomainIdentifier: String = InheritanceAnchor.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = InheritanceAnchor.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[InheritanceAnchor]] = Lazy(InheritanceAnchor_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[InheritanceAnchor]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[InheritanceAnchor] = LazyInstance.value
  }
}