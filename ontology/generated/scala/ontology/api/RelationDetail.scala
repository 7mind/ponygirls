import io.circe.Decoder.{decodeList, decodeOption, decodeString, decodeUUID}
import io.circe.Json

import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}
import java.util.UUID

package ontology.api {
  sealed trait RelationDetail extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RelationDetail.baboonDomainVersion
    override def baboonDomainIdentifier: String = RelationDetail.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RelationDetail.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RelationDetail.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RelationDetail.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RelationDetail.baboonMinReaderVersions
  }
  
  object RelationDetail {
    final case class Empty(
      
    ) extends RelationDetail with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = RelationDetail.Empty.baboonDomainVersion
      override def baboonDomainIdentifier: String = RelationDetail.Empty.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = RelationDetail.Empty.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = RelationDetail.Empty.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = RelationDetail.Empty.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = RelationDetail.Empty.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = RelationDetail.Empty.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.Empty.baboonAdtType
    }
    
    object Empty {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#RelationDetail]#Empty"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#RelationDetail"
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.getClass
      def codecJson: BaboonJsonCodec[RelationDetail.Empty] = RelationDetail.Empty_JsonCodec.instance
    }
    
    object Empty_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[RelationDetail.Empty, BaboonJsonCodec[RelationDetail.Empty]] {
      def encode(ctx: BaboonCodecContext, value: RelationDetail.Empty): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetail.Empty] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(RelationDetail.Empty())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Empty: object expected"))
        }
      }
    
      def baboonDomainVersion: String = RelationDetail.Empty.baboonDomainVersion
      
      def baboonDomainIdentifier: String = RelationDetail.Empty.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = RelationDetail.Empty.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = RelationDetail.Empty.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.Empty.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetail.Empty]] = Lazy(RelationDetail.Empty_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetail.Empty]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[RelationDetail.Empty] = LazyInstance.value
    }
    
    
    final case class Dependency(
      gate: Gate,
      consumption: Consumption,
      event: Option[Ref],
      applicability: String
    ) extends RelationDetail with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = RelationDetail.Dependency.baboonDomainVersion
      override def baboonDomainIdentifier: String = RelationDetail.Dependency.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = RelationDetail.Dependency.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = RelationDetail.Dependency.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = RelationDetail.Dependency.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = RelationDetail.Dependency.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = RelationDetail.Dependency.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.Dependency.baboonAdtType
    }
    
    object Dependency {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#RelationDetail]#Dependency"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#RelationDetail"
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.getClass
      def codecJson: BaboonJsonCodec[RelationDetail.Dependency] = RelationDetail.Dependency_JsonCodec.instance
    }
    
    object Dependency_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[RelationDetail.Dependency, BaboonJsonCodec[RelationDetail.Dependency]] {
      def encode(ctx: BaboonCodecContext, value: RelationDetail.Dependency): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "gate" -> Gate_JsonCodec.instance.encode(ctx, value.gate),
          "consumption" -> Consumption_JsonCodec.instance.encode(ctx, value.consumption),
          "event" -> value.event.map(v => Ref_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
          "applicability" -> Json.fromString(value.applicability)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetail.Dependency] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              gate <- getField(jsonObject, "gate").flatMap(v => Gate_JsonCodec.circeDecoder(v.hcursor))
              consumption <- getField(jsonObject, "consumption").flatMap(v => Consumption_JsonCodec.circeDecoder(v.hcursor))
              event <- getField(jsonObject, "event").flatMap(v => decodeOption(Ref_JsonCodec.circeDecoder)(v.hcursor))
              applicability <- getField(jsonObject, "applicability").flatMap(v => decodeString(v.hcursor))
            } yield RelationDetail.Dependency(gate,consumption,event,applicability)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Dependency: object expected"))
        }
      }
    
      def baboonDomainVersion: String = RelationDetail.Dependency.baboonDomainVersion
      
      def baboonDomainIdentifier: String = RelationDetail.Dependency.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = RelationDetail.Dependency.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = RelationDetail.Dependency.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.Dependency.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetail.Dependency]] = Lazy(RelationDetail.Dependency_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetail.Dependency]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[RelationDetail.Dependency] = LazyInstance.value
    }
    
    
    final case class Decomposition(
      grouping: Grouping
    ) extends RelationDetail with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = RelationDetail.Decomposition.baboonDomainVersion
      override def baboonDomainIdentifier: String = RelationDetail.Decomposition.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = RelationDetail.Decomposition.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = RelationDetail.Decomposition.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = RelationDetail.Decomposition.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = RelationDetail.Decomposition.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = RelationDetail.Decomposition.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.Decomposition.baboonAdtType
    }
    
    object Decomposition {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#RelationDetail]#Decomposition"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#RelationDetail"
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.getClass
      def codecJson: BaboonJsonCodec[RelationDetail.Decomposition] = RelationDetail.Decomposition_JsonCodec.instance
    }
    
    object Decomposition_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[RelationDetail.Decomposition, BaboonJsonCodec[RelationDetail.Decomposition]] {
      def encode(ctx: BaboonCodecContext, value: RelationDetail.Decomposition): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "grouping" -> Grouping_JsonCodec.instance.encode(ctx, value.grouping)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetail.Decomposition] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              grouping <- getField(jsonObject, "grouping").flatMap(v => Grouping_JsonCodec.circeDecoder(v.hcursor))
            } yield RelationDetail.Decomposition(grouping)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Decomposition: object expected"))
        }
      }
    
      def baboonDomainVersion: String = RelationDetail.Decomposition.baboonDomainVersion
      
      def baboonDomainIdentifier: String = RelationDetail.Decomposition.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = RelationDetail.Decomposition.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = RelationDetail.Decomposition.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.Decomposition.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetail.Decomposition]] = Lazy(RelationDetail.Decomposition_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetail.Decomposition]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[RelationDetail.Decomposition] = LazyInstance.value
    }
    
    
    final case class Delegation(
      actors: List[String],
      operations: List[String],
      outcomes: List[Ref]
    ) extends RelationDetail with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = RelationDetail.Delegation.baboonDomainVersion
      override def baboonDomainIdentifier: String = RelationDetail.Delegation.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = RelationDetail.Delegation.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = RelationDetail.Delegation.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = RelationDetail.Delegation.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = RelationDetail.Delegation.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = RelationDetail.Delegation.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.Delegation.baboonAdtType
    }
    
    object Delegation {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#RelationDetail]#Delegation"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#RelationDetail"
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.getClass
      def codecJson: BaboonJsonCodec[RelationDetail.Delegation] = RelationDetail.Delegation_JsonCodec.instance
    }
    
    object Delegation_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[RelationDetail.Delegation, BaboonJsonCodec[RelationDetail.Delegation]] {
      def encode(ctx: BaboonCodecContext, value: RelationDetail.Delegation): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "actors" -> Json.fromValues(value.actors.map(e => Json.fromString(e))),
          "operations" -> Json.fromValues(value.operations.map(e => Json.fromString(e))),
          "outcomes" -> Json.fromValues(value.outcomes.map(e => Ref_JsonCodec.instance.encode(ctx, e)))
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetail.Delegation] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              actors <- getField(jsonObject, "actors").flatMap(v => decodeList(decodeString)(v.hcursor))
              operations <- getField(jsonObject, "operations").flatMap(v => decodeList(decodeString)(v.hcursor))
              outcomes <- getField(jsonObject, "outcomes").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            } yield RelationDetail.Delegation(actors,operations,outcomes)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Delegation: object expected"))
        }
      }
    
      def baboonDomainVersion: String = RelationDetail.Delegation.baboonDomainVersion
      
      def baboonDomainIdentifier: String = RelationDetail.Delegation.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = RelationDetail.Delegation.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = RelationDetail.Delegation.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.Delegation.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetail.Delegation]] = Lazy(RelationDetail.Delegation_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetail.Delegation]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[RelationDetail.Delegation] = LazyInstance.value
    }
    
    
    final case class Adoption(
      presentationId: UUID,
      origin: AdoptionOrigin
    ) extends RelationDetail with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = RelationDetail.Adoption.baboonDomainVersion
      override def baboonDomainIdentifier: String = RelationDetail.Adoption.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = RelationDetail.Adoption.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = RelationDetail.Adoption.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = RelationDetail.Adoption.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = RelationDetail.Adoption.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = RelationDetail.Adoption.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.Adoption.baboonAdtType
    }
    
    object Adoption {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#RelationDetail]#Adoption"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#RelationDetail"
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.getClass
      def codecJson: BaboonJsonCodec[RelationDetail.Adoption] = RelationDetail.Adoption_JsonCodec.instance
    }
    
    object Adoption_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[RelationDetail.Adoption, BaboonJsonCodec[RelationDetail.Adoption]] {
      def encode(ctx: BaboonCodecContext, value: RelationDetail.Adoption): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "presentationId" -> Json.fromString(value.presentationId.toString()),
          "origin" -> AdoptionOrigin_JsonCodec.instance.encode(ctx, value.origin)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetail.Adoption] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              presentationId <- getField(jsonObject, "presentationId").flatMap(v => decodeUUID(v.hcursor))
              origin <- getField(jsonObject, "origin").flatMap(v => AdoptionOrigin_JsonCodec.circeDecoder(v.hcursor))
            } yield RelationDetail.Adoption(presentationId,origin)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Adoption: object expected"))
        }
      }
    
      def baboonDomainVersion: String = RelationDetail.Adoption.baboonDomainVersion
      
      def baboonDomainIdentifier: String = RelationDetail.Adoption.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = RelationDetail.Adoption.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = RelationDetail.Adoption.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.Adoption.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetail.Adoption]] = Lazy(RelationDetail.Adoption_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetail.Adoption]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[RelationDetail.Adoption] = LazyInstance.value
    }
    
    
    final case class AssessmentUse(
      requirement: Ref,
      disposition: AssessmentUseDisposition,
      basis: List[Ref]
    ) extends RelationDetail with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = RelationDetail.AssessmentUse.baboonDomainVersion
      override def baboonDomainIdentifier: String = RelationDetail.AssessmentUse.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = RelationDetail.AssessmentUse.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = RelationDetail.AssessmentUse.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = RelationDetail.AssessmentUse.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = RelationDetail.AssessmentUse.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = RelationDetail.AssessmentUse.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.AssessmentUse.baboonAdtType
    }
    
    object AssessmentUse {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#RelationDetail]#AssessmentUse"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#RelationDetail"
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.getClass
      def codecJson: BaboonJsonCodec[RelationDetail.AssessmentUse] = RelationDetail.AssessmentUse_JsonCodec.instance
    }
    
    object AssessmentUse_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[RelationDetail.AssessmentUse, BaboonJsonCodec[RelationDetail.AssessmentUse]] {
      def encode(ctx: BaboonCodecContext, value: RelationDetail.AssessmentUse): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "requirement" -> Ref_JsonCodec.instance.encode(ctx, value.requirement),
          "disposition" -> AssessmentUseDisposition_JsonCodec.instance.encode(ctx, value.disposition),
          "basis" -> Json.fromValues(value.basis.map(e => Ref_JsonCodec.instance.encode(ctx, e)))
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetail.AssessmentUse] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              requirement <- getField(jsonObject, "requirement").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
              disposition <- getField(jsonObject, "disposition").flatMap(v => AssessmentUseDisposition_JsonCodec.circeDecoder(v.hcursor))
              basis <- getField(jsonObject, "basis").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
            } yield RelationDetail.AssessmentUse(requirement,disposition,basis)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to AssessmentUse: object expected"))
        }
      }
    
      def baboonDomainVersion: String = RelationDetail.AssessmentUse.baboonDomainVersion
      
      def baboonDomainIdentifier: String = RelationDetail.AssessmentUse.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = RelationDetail.AssessmentUse.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = RelationDetail.AssessmentUse.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetail.AssessmentUse.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetail.AssessmentUse]] = Lazy(RelationDetail.AssessmentUse_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetail.AssessmentUse]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[RelationDetail.AssessmentUse] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#RelationDetail"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RelationDetail] = RelationDetail_JsonCodec.instance
  }
  
  object RelationDetail_JsonCodec extends BaboonJsonCodec.BaseGenerated[RelationDetail, BaboonJsonCodec[RelationDetail]] {
    def encode(ctx: BaboonCodecContext, value: RelationDetail): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case empty: RelationDetail.Empty => Json.obj("Empty" -> RelationDetail.Empty_JsonCodec.instance.encode(ctx, empty))
        
        case dependency: RelationDetail.Dependency => Json.obj("Dependency" -> RelationDetail.Dependency_JsonCodec.instance.encode(ctx, dependency))
        
        case decomposition: RelationDetail.Decomposition => Json.obj("Decomposition" -> RelationDetail.Decomposition_JsonCodec.instance.encode(ctx, decomposition))
        
        case delegation: RelationDetail.Delegation => Json.obj("Delegation" -> RelationDetail.Delegation_JsonCodec.instance.encode(ctx, delegation))
        
        case adoption: RelationDetail.Adoption => Json.obj("Adoption" -> RelationDetail.Adoption_JsonCodec.instance.encode(ctx, adoption))
        
        case assessmentuse: RelationDetail.AssessmentUse => Json.obj("AssessmentUse" -> RelationDetail.AssessmentUse_JsonCodec.instance.encode(ctx, assessmentuse))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetail] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Empty" =>
                  RelationDetail.Empty_JsonCodec.instance.decode(ctx, json)
                
                case "Dependency" =>
                  RelationDetail.Dependency_JsonCodec.instance.decode(ctx, json)
                
                case "Decomposition" =>
                  RelationDetail.Decomposition_JsonCodec.instance.decode(ctx, json)
                
                case "Delegation" =>
                  RelationDetail.Delegation_JsonCodec.instance.decode(ctx, json)
                
                case "Adoption" =>
                  RelationDetail.Adoption_JsonCodec.instance.decode(ctx, json)
                
                case "AssessmentUse" =>
                  RelationDetail.AssessmentUse_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to RelationDetail: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to RelationDetail: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to RelationDetail: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RelationDetail.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RelationDetail.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RelationDetail.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetail]] = Lazy(RelationDetail_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetail]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RelationDetail] = LazyInstance.value
  }
}