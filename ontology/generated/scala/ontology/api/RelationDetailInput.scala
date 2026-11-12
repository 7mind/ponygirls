import io.circe.Decoder.{decodeList, decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

import java.util.UUID

package ontology.api {
  sealed trait RelationDetailInput extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = RelationDetailInput.baboonDomainVersion
    override def baboonDomainIdentifier: String = RelationDetailInput.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = RelationDetailInput.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = RelationDetailInput.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = RelationDetailInput.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = RelationDetailInput.baboonMinReaderVersions
  }
  
  object RelationDetailInput {
    final case class Empty(
      
    ) extends RelationDetailInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = RelationDetailInput.Empty.baboonDomainVersion
      override def baboonDomainIdentifier: String = RelationDetailInput.Empty.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = RelationDetailInput.Empty.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = RelationDetailInput.Empty.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = RelationDetailInput.Empty.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = RelationDetailInput.Empty.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = RelationDetailInput.Empty.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.Empty.baboonAdtType
    }
    
    object Empty {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#RelationDetailInput]#Empty"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#RelationDetailInput"
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.getClass
      def codecJson: BaboonJsonCodec[RelationDetailInput.Empty] = RelationDetailInput.Empty_JsonCodec.instance
    }
    
    object Empty_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[RelationDetailInput.Empty, BaboonJsonCodec[RelationDetailInput.Empty]] {
      def encode(ctx: BaboonCodecContext, value: RelationDetailInput.Empty): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetailInput.Empty] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(RelationDetailInput.Empty())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Empty: object expected"))
        }
      }
    
      def baboonDomainVersion: String = RelationDetailInput.Empty.baboonDomainVersion
      
      def baboonDomainIdentifier: String = RelationDetailInput.Empty.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = RelationDetailInput.Empty.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = RelationDetailInput.Empty.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.Empty.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.Empty]] = Lazy(RelationDetailInput.Empty_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.Empty]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[RelationDetailInput.Empty] = LazyInstance.value
    }
    
    
    final case class Dependency(
      gate: Gate,
      consumption: Consumption,
      event: Option[Target],
      applicability: String
    ) extends RelationDetailInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = RelationDetailInput.Dependency.baboonDomainVersion
      override def baboonDomainIdentifier: String = RelationDetailInput.Dependency.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = RelationDetailInput.Dependency.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = RelationDetailInput.Dependency.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = RelationDetailInput.Dependency.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = RelationDetailInput.Dependency.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = RelationDetailInput.Dependency.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.Dependency.baboonAdtType
    }
    
    object Dependency {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#RelationDetailInput]#Dependency"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#RelationDetailInput"
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.getClass
      def codecJson: BaboonJsonCodec[RelationDetailInput.Dependency] = RelationDetailInput.Dependency_JsonCodec.instance
    }
    
    object Dependency_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[RelationDetailInput.Dependency, BaboonJsonCodec[RelationDetailInput.Dependency]] {
      def encode(ctx: BaboonCodecContext, value: RelationDetailInput.Dependency): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "gate" -> Gate_JsonCodec.instance.encode(ctx, value.gate),
          "consumption" -> Consumption_JsonCodec.instance.encode(ctx, value.consumption),
          "event" -> value.event.map(v => Target_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
          "applicability" -> Json.fromString(value.applicability)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetailInput.Dependency] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              gate <- getField(jsonObject, "gate").flatMap(v => Gate_JsonCodec.circeDecoder(v.hcursor))
              consumption <- getField(jsonObject, "consumption").flatMap(v => Consumption_JsonCodec.circeDecoder(v.hcursor))
              event <- getField(jsonObject, "event").flatMap(v => decodeOption(Target_JsonCodec.circeDecoder)(v.hcursor))
              applicability <- getField(jsonObject, "applicability").flatMap(v => decodeString(v.hcursor))
            } yield RelationDetailInput.Dependency(gate,consumption,event,applicability)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Dependency: object expected"))
        }
      }
    
      def baboonDomainVersion: String = RelationDetailInput.Dependency.baboonDomainVersion
      
      def baboonDomainIdentifier: String = RelationDetailInput.Dependency.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = RelationDetailInput.Dependency.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = RelationDetailInput.Dependency.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.Dependency.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.Dependency]] = Lazy(RelationDetailInput.Dependency_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.Dependency]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[RelationDetailInput.Dependency] = LazyInstance.value
    }
    
    
    final case class PlanRequirement(
      workContext: String
    ) extends RelationDetailInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = RelationDetailInput.PlanRequirement.baboonDomainVersion
      override def baboonDomainIdentifier: String = RelationDetailInput.PlanRequirement.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = RelationDetailInput.PlanRequirement.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = RelationDetailInput.PlanRequirement.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = RelationDetailInput.PlanRequirement.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = RelationDetailInput.PlanRequirement.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = RelationDetailInput.PlanRequirement.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.PlanRequirement.baboonAdtType
    }
    
    object PlanRequirement {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#RelationDetailInput]#PlanRequirement"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#RelationDetailInput"
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.getClass
      def codecJson: BaboonJsonCodec[RelationDetailInput.PlanRequirement] = RelationDetailInput.PlanRequirement_JsonCodec.instance
    }
    
    object PlanRequirement_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[RelationDetailInput.PlanRequirement, BaboonJsonCodec[RelationDetailInput.PlanRequirement]] {
      def encode(ctx: BaboonCodecContext, value: RelationDetailInput.PlanRequirement): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "workContext" -> Json.fromString(value.workContext)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetailInput.PlanRequirement] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              workContext <- getField(jsonObject, "workContext").flatMap(v => decodeString(v.hcursor))
            } yield RelationDetailInput.PlanRequirement(workContext)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to PlanRequirement: object expected"))
        }
      }
    
      def baboonDomainVersion: String = RelationDetailInput.PlanRequirement.baboonDomainVersion
      
      def baboonDomainIdentifier: String = RelationDetailInput.PlanRequirement.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = RelationDetailInput.PlanRequirement.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = RelationDetailInput.PlanRequirement.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.PlanRequirement.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.PlanRequirement]] = Lazy(RelationDetailInput.PlanRequirement_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.PlanRequirement]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[RelationDetailInput.PlanRequirement] = LazyInstance.value
    }
    
    
    final case class Decomposition(
      grouping: Grouping
    ) extends RelationDetailInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = RelationDetailInput.Decomposition.baboonDomainVersion
      override def baboonDomainIdentifier: String = RelationDetailInput.Decomposition.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = RelationDetailInput.Decomposition.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = RelationDetailInput.Decomposition.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = RelationDetailInput.Decomposition.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = RelationDetailInput.Decomposition.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = RelationDetailInput.Decomposition.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.Decomposition.baboonAdtType
    }
    
    object Decomposition {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#RelationDetailInput]#Decomposition"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#RelationDetailInput"
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.getClass
      def codecJson: BaboonJsonCodec[RelationDetailInput.Decomposition] = RelationDetailInput.Decomposition_JsonCodec.instance
    }
    
    object Decomposition_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[RelationDetailInput.Decomposition, BaboonJsonCodec[RelationDetailInput.Decomposition]] {
      def encode(ctx: BaboonCodecContext, value: RelationDetailInput.Decomposition): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "grouping" -> Grouping_JsonCodec.instance.encode(ctx, value.grouping)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetailInput.Decomposition] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              grouping <- getField(jsonObject, "grouping").flatMap(v => Grouping_JsonCodec.circeDecoder(v.hcursor))
            } yield RelationDetailInput.Decomposition(grouping)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Decomposition: object expected"))
        }
      }
    
      def baboonDomainVersion: String = RelationDetailInput.Decomposition.baboonDomainVersion
      
      def baboonDomainIdentifier: String = RelationDetailInput.Decomposition.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = RelationDetailInput.Decomposition.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = RelationDetailInput.Decomposition.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.Decomposition.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.Decomposition]] = Lazy(RelationDetailInput.Decomposition_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.Decomposition]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[RelationDetailInput.Decomposition] = LazyInstance.value
    }
    
    
    final case class Delegation(
      actors: List[String],
      operations: List[String],
      outcomes: List[Target]
    ) extends RelationDetailInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = RelationDetailInput.Delegation.baboonDomainVersion
      override def baboonDomainIdentifier: String = RelationDetailInput.Delegation.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = RelationDetailInput.Delegation.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = RelationDetailInput.Delegation.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = RelationDetailInput.Delegation.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = RelationDetailInput.Delegation.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = RelationDetailInput.Delegation.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.Delegation.baboonAdtType
    }
    
    object Delegation {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#RelationDetailInput]#Delegation"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#RelationDetailInput"
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.getClass
      def codecJson: BaboonJsonCodec[RelationDetailInput.Delegation] = RelationDetailInput.Delegation_JsonCodec.instance
    }
    
    object Delegation_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[RelationDetailInput.Delegation, BaboonJsonCodec[RelationDetailInput.Delegation]] {
      def encode(ctx: BaboonCodecContext, value: RelationDetailInput.Delegation): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "actors" -> Json.fromValues(value.actors.map(e => Json.fromString(e))),
          "operations" -> Json.fromValues(value.operations.map(e => Json.fromString(e))),
          "outcomes" -> Json.fromValues(value.outcomes.map(e => Target_JsonCodec.instance.encode(ctx, e)))
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetailInput.Delegation] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              actors <- getField(jsonObject, "actors").flatMap(v => decodeList(decodeString)(v.hcursor))
              operations <- getField(jsonObject, "operations").flatMap(v => decodeList(decodeString)(v.hcursor))
              outcomes <- getField(jsonObject, "outcomes").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
            } yield RelationDetailInput.Delegation(actors,operations,outcomes)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Delegation: object expected"))
        }
      }
    
      def baboonDomainVersion: String = RelationDetailInput.Delegation.baboonDomainVersion
      
      def baboonDomainIdentifier: String = RelationDetailInput.Delegation.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = RelationDetailInput.Delegation.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = RelationDetailInput.Delegation.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.Delegation.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.Delegation]] = Lazy(RelationDetailInput.Delegation_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.Delegation]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[RelationDetailInput.Delegation] = LazyInstance.value
    }
    
    
    final case class Adoption(
      presentationId: UUID,
      origin: AdoptionOrigin,
      response: Target,
      selection: PresentedSelectionInput
    ) extends RelationDetailInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = RelationDetailInput.Adoption.baboonDomainVersion
      override def baboonDomainIdentifier: String = RelationDetailInput.Adoption.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = RelationDetailInput.Adoption.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = RelationDetailInput.Adoption.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = RelationDetailInput.Adoption.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = RelationDetailInput.Adoption.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = RelationDetailInput.Adoption.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.Adoption.baboonAdtType
    }
    
    object Adoption {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#RelationDetailInput]#Adoption"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#RelationDetailInput"
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.getClass
      def codecJson: BaboonJsonCodec[RelationDetailInput.Adoption] = RelationDetailInput.Adoption_JsonCodec.instance
    }
    
    object Adoption_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[RelationDetailInput.Adoption, BaboonJsonCodec[RelationDetailInput.Adoption]] {
      def encode(ctx: BaboonCodecContext, value: RelationDetailInput.Adoption): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "presentationId" -> Json.fromString(value.presentationId.toString()),
          "origin" -> AdoptionOrigin_JsonCodec.instance.encode(ctx, value.origin),
          "response" -> Target_JsonCodec.instance.encode(ctx, value.response),
          "selection" -> PresentedSelectionInput_JsonCodec.instance.encode(ctx, value.selection)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetailInput.Adoption] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              presentationId <- getField(jsonObject, "presentationId").flatMap(v => decodeUUID(v.hcursor))
              origin <- getField(jsonObject, "origin").flatMap(v => AdoptionOrigin_JsonCodec.circeDecoder(v.hcursor))
              response <- getField(jsonObject, "response").flatMap(v => Target_JsonCodec.circeDecoder(v.hcursor))
              selection <- getField(jsonObject, "selection").flatMap(v => PresentedSelectionInput_JsonCodec.circeDecoder(v.hcursor))
            } yield RelationDetailInput.Adoption(presentationId,origin,response,selection)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Adoption: object expected"))
        }
      }
    
      def baboonDomainVersion: String = RelationDetailInput.Adoption.baboonDomainVersion
      
      def baboonDomainIdentifier: String = RelationDetailInput.Adoption.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = RelationDetailInput.Adoption.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = RelationDetailInput.Adoption.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.Adoption.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.Adoption]] = Lazy(RelationDetailInput.Adoption_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.Adoption]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[RelationDetailInput.Adoption] = LazyInstance.value
    }
    
    
    final case class AssessmentUse(
      requirement: Target,
      disposition: AssessmentUseDisposition,
      basis: List[Target]
    ) extends RelationDetailInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = RelationDetailInput.AssessmentUse.baboonDomainVersion
      override def baboonDomainIdentifier: String = RelationDetailInput.AssessmentUse.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = RelationDetailInput.AssessmentUse.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = RelationDetailInput.AssessmentUse.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = RelationDetailInput.AssessmentUse.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = RelationDetailInput.AssessmentUse.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = RelationDetailInput.AssessmentUse.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.AssessmentUse.baboonAdtType
    }
    
    object AssessmentUse {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#RelationDetailInput]#AssessmentUse"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#RelationDetailInput"
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.getClass
      def codecJson: BaboonJsonCodec[RelationDetailInput.AssessmentUse] = RelationDetailInput.AssessmentUse_JsonCodec.instance
    }
    
    object AssessmentUse_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[RelationDetailInput.AssessmentUse, BaboonJsonCodec[RelationDetailInput.AssessmentUse]] {
      def encode(ctx: BaboonCodecContext, value: RelationDetailInput.AssessmentUse): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "requirement" -> Target_JsonCodec.instance.encode(ctx, value.requirement),
          "disposition" -> AssessmentUseDisposition_JsonCodec.instance.encode(ctx, value.disposition),
          "basis" -> Json.fromValues(value.basis.map(e => Target_JsonCodec.instance.encode(ctx, e)))
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetailInput.AssessmentUse] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              requirement <- getField(jsonObject, "requirement").flatMap(v => Target_JsonCodec.circeDecoder(v.hcursor))
              disposition <- getField(jsonObject, "disposition").flatMap(v => AssessmentUseDisposition_JsonCodec.circeDecoder(v.hcursor))
              basis <- getField(jsonObject, "basis").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
            } yield RelationDetailInput.AssessmentUse(requirement,disposition,basis)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to AssessmentUse: object expected"))
        }
      }
    
      def baboonDomainVersion: String = RelationDetailInput.AssessmentUse.baboonDomainVersion
      
      def baboonDomainIdentifier: String = RelationDetailInput.AssessmentUse.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = RelationDetailInput.AssessmentUse.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = RelationDetailInput.AssessmentUse.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = RelationDetailInput.AssessmentUse.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.AssessmentUse]] = Lazy(RelationDetailInput.AssessmentUse_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput.AssessmentUse]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[RelationDetailInput.AssessmentUse] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#RelationDetailInput"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[RelationDetailInput] = RelationDetailInput_JsonCodec.instance
  }
  
  object RelationDetailInput_JsonCodec extends BaboonJsonCodec.BaseGenerated[RelationDetailInput, BaboonJsonCodec[RelationDetailInput]] {
    def encode(ctx: BaboonCodecContext, value: RelationDetailInput): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case empty: RelationDetailInput.Empty => Json.obj("Empty" -> RelationDetailInput.Empty_JsonCodec.instance.encode(ctx, empty))
        
        case dependency: RelationDetailInput.Dependency => Json.obj("Dependency" -> RelationDetailInput.Dependency_JsonCodec.instance.encode(ctx, dependency))
        
        case planrequirement: RelationDetailInput.PlanRequirement => Json.obj("PlanRequirement" -> RelationDetailInput.PlanRequirement_JsonCodec.instance.encode(ctx, planrequirement))
        
        case decomposition: RelationDetailInput.Decomposition => Json.obj("Decomposition" -> RelationDetailInput.Decomposition_JsonCodec.instance.encode(ctx, decomposition))
        
        case delegation: RelationDetailInput.Delegation => Json.obj("Delegation" -> RelationDetailInput.Delegation_JsonCodec.instance.encode(ctx, delegation))
        
        case adoption: RelationDetailInput.Adoption => Json.obj("Adoption" -> RelationDetailInput.Adoption_JsonCodec.instance.encode(ctx, adoption))
        
        case assessmentuse: RelationDetailInput.AssessmentUse => Json.obj("AssessmentUse" -> RelationDetailInput.AssessmentUse_JsonCodec.instance.encode(ctx, assessmentuse))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, RelationDetailInput] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Empty" =>
                  RelationDetailInput.Empty_JsonCodec.instance.decode(ctx, json)
                
                case "Dependency" =>
                  RelationDetailInput.Dependency_JsonCodec.instance.decode(ctx, json)
                
                case "PlanRequirement" =>
                  RelationDetailInput.PlanRequirement_JsonCodec.instance.decode(ctx, json)
                
                case "Decomposition" =>
                  RelationDetailInput.Decomposition_JsonCodec.instance.decode(ctx, json)
                
                case "Delegation" =>
                  RelationDetailInput.Delegation_JsonCodec.instance.decode(ctx, json)
                
                case "Adoption" =>
                  RelationDetailInput.Adoption_JsonCodec.instance.decode(ctx, json)
                
                case "AssessmentUse" =>
                  RelationDetailInput.AssessmentUse_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to RelationDetailInput: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to RelationDetailInput: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to RelationDetailInput: object expected"))
      }
    }
  
    def baboonDomainVersion: String = RelationDetailInput.baboonDomainVersion
    
    def baboonDomainIdentifier: String = RelationDetailInput.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = RelationDetailInput.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput]] = Lazy(RelationDetailInput_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[RelationDetailInput]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[RelationDetailInput] = LazyInstance.value
  }
}