import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package ontology.api {
  sealed trait GraphRecord extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = GraphRecord.baboonDomainVersion
    override def baboonDomainIdentifier: String = GraphRecord.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = GraphRecord.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = GraphRecord.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = GraphRecord.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = GraphRecord.baboonMinReaderVersions
  }
  
  object GraphRecord {
    final case class Input(
      value: InputReceipt
    ) extends GraphRecord with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = GraphRecord.Input.baboonDomainVersion
      override def baboonDomainIdentifier: String = GraphRecord.Input.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = GraphRecord.Input.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = GraphRecord.Input.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = GraphRecord.Input.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = GraphRecord.Input.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = GraphRecord.Input.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Input.baboonAdtType
    }
    
    object Input {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#GraphRecord]#Input"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#GraphRecord"
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.getClass
      def codecJson: BaboonJsonCodec[GraphRecord.Input] = GraphRecord.Input_JsonCodec.instance
    }
    
    object Input_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[GraphRecord.Input, BaboonJsonCodec[GraphRecord.Input]] {
      def encode(ctx: BaboonCodecContext, value: GraphRecord.Input): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "value" -> InputReceipt_JsonCodec.instance.encode(ctx, value.value)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GraphRecord.Input] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              value <- getField(jsonObject, "value").flatMap(v => InputReceipt_JsonCodec.circeDecoder(v.hcursor))
            } yield GraphRecord.Input(value)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Input: object expected"))
        }
      }
    
      def baboonDomainVersion: String = GraphRecord.Input.baboonDomainVersion
      
      def baboonDomainIdentifier: String = GraphRecord.Input.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = GraphRecord.Input.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = GraphRecord.Input.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Input.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Input]] = Lazy(GraphRecord.Input_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Input]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[GraphRecord.Input] = LazyInstance.value
    }
    
    
    final case class Person(
      value: ActorRecord
    ) extends GraphRecord with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = GraphRecord.Person.baboonDomainVersion
      override def baboonDomainIdentifier: String = GraphRecord.Person.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = GraphRecord.Person.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = GraphRecord.Person.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = GraphRecord.Person.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = GraphRecord.Person.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = GraphRecord.Person.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Person.baboonAdtType
    }
    
    object Person {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#GraphRecord]#Person"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#GraphRecord"
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.getClass
      def codecJson: BaboonJsonCodec[GraphRecord.Person] = GraphRecord.Person_JsonCodec.instance
    }
    
    object Person_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[GraphRecord.Person, BaboonJsonCodec[GraphRecord.Person]] {
      def encode(ctx: BaboonCodecContext, value: GraphRecord.Person): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "value" -> ActorRecord_JsonCodec.instance.encode(ctx, value.value)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GraphRecord.Person] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              value <- getField(jsonObject, "value").flatMap(v => ActorRecord_JsonCodec.circeDecoder(v.hcursor))
            } yield GraphRecord.Person(value)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Person: object expected"))
        }
      }
    
      def baboonDomainVersion: String = GraphRecord.Person.baboonDomainVersion
      
      def baboonDomainIdentifier: String = GraphRecord.Person.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = GraphRecord.Person.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = GraphRecord.Person.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Person.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Person]] = Lazy(GraphRecord.Person_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Person]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[GraphRecord.Person] = LazyInstance.value
    }
    
    
    final case class Node(
      value: Definition
    ) extends GraphRecord with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = GraphRecord.Node.baboonDomainVersion
      override def baboonDomainIdentifier: String = GraphRecord.Node.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = GraphRecord.Node.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = GraphRecord.Node.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = GraphRecord.Node.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = GraphRecord.Node.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = GraphRecord.Node.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Node.baboonAdtType
    }
    
    object Node {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#GraphRecord]#Node"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#GraphRecord"
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.getClass
      def codecJson: BaboonJsonCodec[GraphRecord.Node] = GraphRecord.Node_JsonCodec.instance
    }
    
    object Node_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[GraphRecord.Node, BaboonJsonCodec[GraphRecord.Node]] {
      def encode(ctx: BaboonCodecContext, value: GraphRecord.Node): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "value" -> Definition_JsonCodec.instance.encode(ctx, value.value)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GraphRecord.Node] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              value <- getField(jsonObject, "value").flatMap(v => Definition_JsonCodec.circeDecoder(v.hcursor))
            } yield GraphRecord.Node(value)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Node: object expected"))
        }
      }
    
      def baboonDomainVersion: String = GraphRecord.Node.baboonDomainVersion
      
      def baboonDomainIdentifier: String = GraphRecord.Node.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = GraphRecord.Node.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = GraphRecord.Node.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Node.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Node]] = Lazy(GraphRecord.Node_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Node]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[GraphRecord.Node] = LazyInstance.value
    }
    
    
    final case class Edge(
      value: Relation
    ) extends GraphRecord with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = GraphRecord.Edge.baboonDomainVersion
      override def baboonDomainIdentifier: String = GraphRecord.Edge.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = GraphRecord.Edge.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = GraphRecord.Edge.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = GraphRecord.Edge.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = GraphRecord.Edge.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = GraphRecord.Edge.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Edge.baboonAdtType
    }
    
    object Edge {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#GraphRecord]#Edge"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#GraphRecord"
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.getClass
      def codecJson: BaboonJsonCodec[GraphRecord.Edge] = GraphRecord.Edge_JsonCodec.instance
    }
    
    object Edge_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[GraphRecord.Edge, BaboonJsonCodec[GraphRecord.Edge]] {
      def encode(ctx: BaboonCodecContext, value: GraphRecord.Edge): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "value" -> Relation_JsonCodec.instance.encode(ctx, value.value)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GraphRecord.Edge] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              value <- getField(jsonObject, "value").flatMap(v => Relation_JsonCodec.circeDecoder(v.hcursor))
            } yield GraphRecord.Edge(value)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Edge: object expected"))
        }
      }
    
      def baboonDomainVersion: String = GraphRecord.Edge.baboonDomainVersion
      
      def baboonDomainIdentifier: String = GraphRecord.Edge.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = GraphRecord.Edge.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = GraphRecord.Edge.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Edge.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Edge]] = Lazy(GraphRecord.Edge_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Edge]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[GraphRecord.Edge] = LazyInstance.value
    }
    
    
    final case class Contract(
      value: Binding
    ) extends GraphRecord with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = GraphRecord.Contract.baboonDomainVersion
      override def baboonDomainIdentifier: String = GraphRecord.Contract.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = GraphRecord.Contract.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = GraphRecord.Contract.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = GraphRecord.Contract.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = GraphRecord.Contract.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = GraphRecord.Contract.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Contract.baboonAdtType
    }
    
    object Contract {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#GraphRecord]#Contract"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#GraphRecord"
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.getClass
      def codecJson: BaboonJsonCodec[GraphRecord.Contract] = GraphRecord.Contract_JsonCodec.instance
    }
    
    object Contract_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[GraphRecord.Contract, BaboonJsonCodec[GraphRecord.Contract]] {
      def encode(ctx: BaboonCodecContext, value: GraphRecord.Contract): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "value" -> Binding_JsonCodec.instance.encode(ctx, value.value)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GraphRecord.Contract] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              value <- getField(jsonObject, "value").flatMap(v => Binding_JsonCodec.circeDecoder(v.hcursor))
            } yield GraphRecord.Contract(value)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Contract: object expected"))
        }
      }
    
      def baboonDomainVersion: String = GraphRecord.Contract.baboonDomainVersion
      
      def baboonDomainIdentifier: String = GraphRecord.Contract.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = GraphRecord.Contract.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = GraphRecord.Contract.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Contract.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Contract]] = Lazy(GraphRecord.Contract_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Contract]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[GraphRecord.Contract] = LazyInstance.value
    }
    
    
    final case class Progress(
      value: StateEvent
    ) extends GraphRecord with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = GraphRecord.Progress.baboonDomainVersion
      override def baboonDomainIdentifier: String = GraphRecord.Progress.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = GraphRecord.Progress.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = GraphRecord.Progress.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = GraphRecord.Progress.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = GraphRecord.Progress.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = GraphRecord.Progress.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Progress.baboonAdtType
    }
    
    object Progress {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#GraphRecord]#Progress"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#GraphRecord"
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.getClass
      def codecJson: BaboonJsonCodec[GraphRecord.Progress] = GraphRecord.Progress_JsonCodec.instance
    }
    
    object Progress_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[GraphRecord.Progress, BaboonJsonCodec[GraphRecord.Progress]] {
      def encode(ctx: BaboonCodecContext, value: GraphRecord.Progress): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "value" -> StateEvent_JsonCodec.instance.encode(ctx, value.value)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GraphRecord.Progress] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              value <- getField(jsonObject, "value").flatMap(v => StateEvent_JsonCodec.circeDecoder(v.hcursor))
            } yield GraphRecord.Progress(value)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Progress: object expected"))
        }
      }
    
      def baboonDomainVersion: String = GraphRecord.Progress.baboonDomainVersion
      
      def baboonDomainIdentifier: String = GraphRecord.Progress.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = GraphRecord.Progress.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = GraphRecord.Progress.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Progress.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Progress]] = Lazy(GraphRecord.Progress_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Progress]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[GraphRecord.Progress] = LazyInstance.value
    }
    
    
    final case class Selection(
      value: BindingSelection
    ) extends GraphRecord with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = GraphRecord.Selection.baboonDomainVersion
      override def baboonDomainIdentifier: String = GraphRecord.Selection.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = GraphRecord.Selection.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = GraphRecord.Selection.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = GraphRecord.Selection.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = GraphRecord.Selection.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = GraphRecord.Selection.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Selection.baboonAdtType
    }
    
    object Selection {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#GraphRecord]#Selection"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#GraphRecord"
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.getClass
      def codecJson: BaboonJsonCodec[GraphRecord.Selection] = GraphRecord.Selection_JsonCodec.instance
    }
    
    object Selection_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[GraphRecord.Selection, BaboonJsonCodec[GraphRecord.Selection]] {
      def encode(ctx: BaboonCodecContext, value: GraphRecord.Selection): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "value" -> BindingSelection_JsonCodec.instance.encode(ctx, value.value)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GraphRecord.Selection] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              value <- getField(jsonObject, "value").flatMap(v => BindingSelection_JsonCodec.circeDecoder(v.hcursor))
            } yield GraphRecord.Selection(value)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Selection: object expected"))
        }
      }
    
      def baboonDomainVersion: String = GraphRecord.Selection.baboonDomainVersion
      
      def baboonDomainIdentifier: String = GraphRecord.Selection.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = GraphRecord.Selection.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = GraphRecord.Selection.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = GraphRecord.Selection.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Selection]] = Lazy(GraphRecord.Selection_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[GraphRecord.Selection]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[GraphRecord.Selection] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#GraphRecord"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[GraphRecord] = GraphRecord_JsonCodec.instance
  }
  
  object GraphRecord_JsonCodec extends BaboonJsonCodec.BaseGenerated[GraphRecord, BaboonJsonCodec[GraphRecord]] {
    def encode(ctx: BaboonCodecContext, value: GraphRecord): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case input: GraphRecord.Input => Json.obj("Input" -> GraphRecord.Input_JsonCodec.instance.encode(ctx, input))
        
        case person: GraphRecord.Person => Json.obj("Person" -> GraphRecord.Person_JsonCodec.instance.encode(ctx, person))
        
        case node: GraphRecord.Node => Json.obj("Node" -> GraphRecord.Node_JsonCodec.instance.encode(ctx, node))
        
        case edge: GraphRecord.Edge => Json.obj("Edge" -> GraphRecord.Edge_JsonCodec.instance.encode(ctx, edge))
        
        case contract: GraphRecord.Contract => Json.obj("Contract" -> GraphRecord.Contract_JsonCodec.instance.encode(ctx, contract))
        
        case progress: GraphRecord.Progress => Json.obj("Progress" -> GraphRecord.Progress_JsonCodec.instance.encode(ctx, progress))
        
        case selection: GraphRecord.Selection => Json.obj("Selection" -> GraphRecord.Selection_JsonCodec.instance.encode(ctx, selection))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, GraphRecord] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Input" =>
                  GraphRecord.Input_JsonCodec.instance.decode(ctx, json)
                
                case "Person" =>
                  GraphRecord.Person_JsonCodec.instance.decode(ctx, json)
                
                case "Node" =>
                  GraphRecord.Node_JsonCodec.instance.decode(ctx, json)
                
                case "Edge" =>
                  GraphRecord.Edge_JsonCodec.instance.decode(ctx, json)
                
                case "Contract" =>
                  GraphRecord.Contract_JsonCodec.instance.decode(ctx, json)
                
                case "Progress" =>
                  GraphRecord.Progress_JsonCodec.instance.decode(ctx, json)
                
                case "Selection" =>
                  GraphRecord.Selection_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to GraphRecord: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to GraphRecord: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to GraphRecord: object expected"))
      }
    }
  
    def baboonDomainVersion: String = GraphRecord.baboonDomainVersion
    
    def baboonDomainIdentifier: String = GraphRecord.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = GraphRecord.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[GraphRecord]] = Lazy(GraphRecord_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[GraphRecord]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[GraphRecord] = LazyInstance.value
  }
}