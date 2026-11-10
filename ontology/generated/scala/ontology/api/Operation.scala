import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package ontology.api {
  sealed trait Operation extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Operation.baboonDomainVersion
    override def baboonDomainIdentifier: String = Operation.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Operation.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Operation.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Operation.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Operation.baboonMinReaderVersions
  }
  
  object Operation {
    final case class Create(
      alias: String,
      content: Content,
      basis: List[Target]
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Create.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Create.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Create.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Create.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Create.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Create.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Create.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Create.baboonAdtType
    }
    
    object Create {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Operation]#Create"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Create] = Operation.Create_JsonCodec.instance
    }
    
    object Create_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Create, BaboonJsonCodec[Operation.Create]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Create): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "alias" -> Json.fromString(value.alias),
          "content" -> Content_JsonCodec.instance.encode(ctx, value.content),
          "basis" -> Json.fromValues(value.basis.map(e => Target_JsonCodec.instance.encode(ctx, e)))
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Create] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              alias <- getField(jsonObject, "alias").flatMap(v => decodeString(v.hcursor))
              content <- getField(jsonObject, "content").flatMap(v => Content_JsonCodec.circeDecoder(v.hcursor))
              basis <- getField(jsonObject, "basis").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
            } yield Operation.Create(alias,content,basis)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Create: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Create.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Create.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Create.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Create.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Create.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Create]] = Lazy(Operation.Create_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Create]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Create] = LazyInstance.value
    }
    
    
    final case class Revise(
      alias: String,
      ref: Ref,
      content: Content,
      standing: Standing,
      basis: List[Target],
      reason: String
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Revise.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Revise.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Revise.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Revise.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Revise.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Revise.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Revise.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Revise.baboonAdtType
    }
    
    object Revise {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Operation]#Revise"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Revise] = Operation.Revise_JsonCodec.instance
    }
    
    object Revise_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Revise, BaboonJsonCodec[Operation.Revise]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Revise): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "alias" -> Json.fromString(value.alias),
          "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref),
          "content" -> Content_JsonCodec.instance.encode(ctx, value.content),
          "standing" -> Standing_JsonCodec.instance.encode(ctx, value.standing),
          "basis" -> Json.fromValues(value.basis.map(e => Target_JsonCodec.instance.encode(ctx, e))),
          "reason" -> Json.fromString(value.reason)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Revise] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              alias <- getField(jsonObject, "alias").flatMap(v => decodeString(v.hcursor))
              ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
              content <- getField(jsonObject, "content").flatMap(v => Content_JsonCodec.circeDecoder(v.hcursor))
              standing <- getField(jsonObject, "standing").flatMap(v => Standing_JsonCodec.circeDecoder(v.hcursor))
              basis <- getField(jsonObject, "basis").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
              reason <- getField(jsonObject, "reason").flatMap(v => decodeString(v.hcursor))
            } yield Operation.Revise(alias,ref,content,standing,basis,reason)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Revise: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Revise.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Revise.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Revise.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Revise.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Revise.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Revise]] = Lazy(Operation.Revise_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Revise]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Revise] = LazyInstance.value
    }
    
    
    final case class Relate(
      alias: String,
      kind: RelationKind,
      sources: List[Target],
      targets: List[Target],
      detail: RelationDetail,
      why: String
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Relate.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Relate.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Relate.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Relate.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Relate.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Relate.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Relate.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Relate.baboonAdtType
    }
    
    object Relate {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Operation]#Relate"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Relate] = Operation.Relate_JsonCodec.instance
    }
    
    object Relate_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Relate, BaboonJsonCodec[Operation.Relate]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Relate): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "alias" -> Json.fromString(value.alias),
          "kind" -> RelationKind_JsonCodec.instance.encode(ctx, value.kind),
          "sources" -> Json.fromValues(value.sources.map(e => Target_JsonCodec.instance.encode(ctx, e))),
          "targets" -> Json.fromValues(value.targets.map(e => Target_JsonCodec.instance.encode(ctx, e))),
          "detail" -> RelationDetail_JsonCodec.instance.encode(ctx, value.detail),
          "why" -> Json.fromString(value.why)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Relate] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              alias <- getField(jsonObject, "alias").flatMap(v => decodeString(v.hcursor))
              kind <- getField(jsonObject, "kind").flatMap(v => RelationKind_JsonCodec.circeDecoder(v.hcursor))
              sources <- getField(jsonObject, "sources").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
              targets <- getField(jsonObject, "targets").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
              detail <- getField(jsonObject, "detail").flatMap(v => RelationDetail_JsonCodec.circeDecoder(v.hcursor))
              why <- getField(jsonObject, "why").flatMap(v => decodeString(v.hcursor))
            } yield Operation.Relate(alias,kind,sources,targets,detail,why)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Relate: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Relate.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Relate.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Relate.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Relate.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Relate.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Relate]] = Lazy(Operation.Relate_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Relate]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Relate] = LazyInstance.value
    }
    
    
    final case class ReviseRelation(
      alias: String,
      ref: Ref,
      sources: List[Target],
      targets: List[Target],
      detail: RelationDetail,
      why: String,
      standing: Standing
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.ReviseRelation.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.ReviseRelation.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.ReviseRelation.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.ReviseRelation.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.ReviseRelation.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.ReviseRelation.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.ReviseRelation.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.ReviseRelation.baboonAdtType
    }
    
    object ReviseRelation {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Operation]#ReviseRelation"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.ReviseRelation] = Operation.ReviseRelation_JsonCodec.instance
    }
    
    object ReviseRelation_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.ReviseRelation, BaboonJsonCodec[Operation.ReviseRelation]] {
      def encode(ctx: BaboonCodecContext, value: Operation.ReviseRelation): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "alias" -> Json.fromString(value.alias),
          "ref" -> Ref_JsonCodec.instance.encode(ctx, value.ref),
          "sources" -> Json.fromValues(value.sources.map(e => Target_JsonCodec.instance.encode(ctx, e))),
          "targets" -> Json.fromValues(value.targets.map(e => Target_JsonCodec.instance.encode(ctx, e))),
          "detail" -> RelationDetail_JsonCodec.instance.encode(ctx, value.detail),
          "why" -> Json.fromString(value.why),
          "standing" -> Standing_JsonCodec.instance.encode(ctx, value.standing)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.ReviseRelation] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              alias <- getField(jsonObject, "alias").flatMap(v => decodeString(v.hcursor))
              ref <- getField(jsonObject, "ref").flatMap(v => Ref_JsonCodec.circeDecoder(v.hcursor))
              sources <- getField(jsonObject, "sources").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
              targets <- getField(jsonObject, "targets").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
              detail <- getField(jsonObject, "detail").flatMap(v => RelationDetail_JsonCodec.circeDecoder(v.hcursor))
              why <- getField(jsonObject, "why").flatMap(v => decodeString(v.hcursor))
              standing <- getField(jsonObject, "standing").flatMap(v => Standing_JsonCodec.circeDecoder(v.hcursor))
            } yield Operation.ReviseRelation(alias,ref,sources,targets,detail,why,standing)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ReviseRelation: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.ReviseRelation.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.ReviseRelation.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.ReviseRelation.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.ReviseRelation.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.ReviseRelation.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.ReviseRelation]] = Lazy(Operation.ReviseRelation_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.ReviseRelation]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.ReviseRelation] = LazyInstance.value
    }
    
    
    final case class Bind(
      alias: String,
      definition: Target,
      context: List[Target]
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.Bind.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.Bind.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.Bind.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.Bind.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.Bind.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.Bind.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.Bind.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.Bind.baboonAdtType
    }
    
    object Bind {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Operation]#Bind"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.Bind] = Operation.Bind_JsonCodec.instance
    }
    
    object Bind_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.Bind, BaboonJsonCodec[Operation.Bind]] {
      def encode(ctx: BaboonCodecContext, value: Operation.Bind): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "alias" -> Json.fromString(value.alias),
          "definition" -> Target_JsonCodec.instance.encode(ctx, value.definition),
          "context" -> Json.fromValues(value.context.map(e => Target_JsonCodec.instance.encode(ctx, e)))
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.Bind] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              alias <- getField(jsonObject, "alias").flatMap(v => decodeString(v.hcursor))
              definition <- getField(jsonObject, "definition").flatMap(v => Target_JsonCodec.circeDecoder(v.hcursor))
              context <- getField(jsonObject, "context").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
            } yield Operation.Bind(alias,definition,context)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Bind: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.Bind.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.Bind.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.Bind.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.Bind.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.Bind.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.Bind]] = Lazy(Operation.Bind_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.Bind]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.Bind] = LazyInstance.value
    }
    
    
    final case class State(
      alias: String,
      subject: Target,
      previous: Option[Ref],
      phase: Phase,
      result: Option[Resolution],
      resolution: Option[String],
      evidence: List[Target],
      uncertainty: String
    ) extends Operation with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Operation.State.baboonDomainVersion
      override def baboonDomainIdentifier: String = Operation.State.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Operation.State.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Operation.State.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Operation.State.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Operation.State.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Operation.State.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Operation.State.baboonAdtType
    }
    
    object State {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Operation]#State"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Operation"
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.getClass
      def codecJson: BaboonJsonCodec[Operation.State] = Operation.State_JsonCodec.instance
    }
    
    object State_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Operation.State, BaboonJsonCodec[Operation.State]] {
      def encode(ctx: BaboonCodecContext, value: Operation.State): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "alias" -> Json.fromString(value.alias),
          "subject" -> Target_JsonCodec.instance.encode(ctx, value.subject),
          "previous" -> value.previous.map(v => Ref_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
          "phase" -> Phase_JsonCodec.instance.encode(ctx, value.phase),
          "result" -> value.result.map(v => Resolution_JsonCodec.instance.encode(ctx, v)).getOrElse(Json.Null),
          "resolution" -> value.resolution.map(v => Json.fromString(v)).getOrElse(Json.Null),
          "evidence" -> Json.fromValues(value.evidence.map(e => Target_JsonCodec.instance.encode(ctx, e))),
          "uncertainty" -> Json.fromString(value.uncertainty)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation.State] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              alias <- getField(jsonObject, "alias").flatMap(v => decodeString(v.hcursor))
              subject <- getField(jsonObject, "subject").flatMap(v => Target_JsonCodec.circeDecoder(v.hcursor))
              previous <- getField(jsonObject, "previous").flatMap(v => decodeOption(Ref_JsonCodec.circeDecoder)(v.hcursor))
              phase <- getField(jsonObject, "phase").flatMap(v => Phase_JsonCodec.circeDecoder(v.hcursor))
              result <- getField(jsonObject, "result").flatMap(v => decodeOption(Resolution_JsonCodec.circeDecoder)(v.hcursor))
              resolution <- getField(jsonObject, "resolution").flatMap(v => decodeOption(decodeString)(v.hcursor))
              evidence <- getField(jsonObject, "evidence").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
              uncertainty <- getField(jsonObject, "uncertainty").flatMap(v => decodeString(v.hcursor))
            } yield Operation.State(alias,subject,previous,phase,result,resolution,evidence,uncertainty)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to State: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Operation.State.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Operation.State.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Operation.State.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Operation.State.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Operation.State.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation.State]] = Lazy(Operation.State_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation.State]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Operation.State] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Operation"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Operation] = Operation_JsonCodec.instance
  }
  
  object Operation_JsonCodec extends BaboonJsonCodec.BaseGenerated[Operation, BaboonJsonCodec[Operation]] {
    def encode(ctx: BaboonCodecContext, value: Operation): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case create: Operation.Create => Json.obj("Create" -> Operation.Create_JsonCodec.instance.encode(ctx, create))
        
        case revise: Operation.Revise => Json.obj("Revise" -> Operation.Revise_JsonCodec.instance.encode(ctx, revise))
        
        case relate: Operation.Relate => Json.obj("Relate" -> Operation.Relate_JsonCodec.instance.encode(ctx, relate))
        
        case reviserelation: Operation.ReviseRelation => Json.obj("ReviseRelation" -> Operation.ReviseRelation_JsonCodec.instance.encode(ctx, reviserelation))
        
        case bind: Operation.Bind => Json.obj("Bind" -> Operation.Bind_JsonCodec.instance.encode(ctx, bind))
        
        case state: Operation.State => Json.obj("State" -> Operation.State_JsonCodec.instance.encode(ctx, state))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Operation] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Create" =>
                  Operation.Create_JsonCodec.instance.decode(ctx, json)
                
                case "Revise" =>
                  Operation.Revise_JsonCodec.instance.decode(ctx, json)
                
                case "Relate" =>
                  Operation.Relate_JsonCodec.instance.decode(ctx, json)
                
                case "ReviseRelation" =>
                  Operation.ReviseRelation_JsonCodec.instance.decode(ctx, json)
                
                case "Bind" =>
                  Operation.Bind_JsonCodec.instance.decode(ctx, json)
                
                case "State" =>
                  Operation.State_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Operation: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Operation: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Operation: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Operation.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Operation.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Operation.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Operation]] = Lazy(Operation_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Operation]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Operation] = LazyInstance.value
  }
}