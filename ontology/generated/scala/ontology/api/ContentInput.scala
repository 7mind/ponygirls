import io.circe.Decoder.{decodeList, decodeOption, decodeString}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package ontology.api {
  sealed trait ContentInput extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ContentInput.baboonDomainVersion
    override def baboonDomainIdentifier: String = ContentInput.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ContentInput.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ContentInput.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ContentInput.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ContentInput.baboonMinReaderVersions
  }
  
  object ContentInput {
    final case class Outcome(
      text: String,
      acceptance: AcceptanceInput,
      force: Force
    ) extends ContentInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentInput.Outcome.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentInput.Outcome.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentInput.Outcome.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentInput.Outcome.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentInput.Outcome.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentInput.Outcome.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentInput.Outcome.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Outcome.baboonAdtType
    }
    
    object Outcome {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ContentInput]#Outcome"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ContentInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.getClass
      def codecJson: BaboonJsonCodec[ContentInput.Outcome] = ContentInput.Outcome_JsonCodec.instance
    }
    
    object Outcome_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentInput.Outcome, BaboonJsonCodec[ContentInput.Outcome]] {
      def encode(ctx: BaboonCodecContext, value: ContentInput.Outcome): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "acceptance" -> AcceptanceInput_JsonCodec.instance.encode(ctx, value.acceptance),
          "force" -> Force_JsonCodec.instance.encode(ctx, value.force)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentInput.Outcome] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              acceptance <- getField(jsonObject, "acceptance").flatMap(v => AcceptanceInput_JsonCodec.circeDecoder(v.hcursor))
              force <- getField(jsonObject, "force").flatMap(v => Force_JsonCodec.circeDecoder(v.hcursor))
            } yield ContentInput.Outcome(text,acceptance,force)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Outcome: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentInput.Outcome.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentInput.Outcome.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentInput.Outcome.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentInput.Outcome.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Outcome.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentInput.Outcome]] = Lazy(ContentInput.Outcome_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentInput.Outcome]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentInput.Outcome] = LazyInstance.value
    }
    
    
    final case class Constraint(
      text: String,
      polarity: Polarity,
      force: Force
    ) extends ContentInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentInput.Constraint.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentInput.Constraint.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentInput.Constraint.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentInput.Constraint.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentInput.Constraint.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentInput.Constraint.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentInput.Constraint.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Constraint.baboonAdtType
    }
    
    object Constraint {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ContentInput]#Constraint"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ContentInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.getClass
      def codecJson: BaboonJsonCodec[ContentInput.Constraint] = ContentInput.Constraint_JsonCodec.instance
    }
    
    object Constraint_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentInput.Constraint, BaboonJsonCodec[ContentInput.Constraint]] {
      def encode(ctx: BaboonCodecContext, value: ContentInput.Constraint): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "polarity" -> Polarity_JsonCodec.instance.encode(ctx, value.polarity),
          "force" -> Force_JsonCodec.instance.encode(ctx, value.force)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentInput.Constraint] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              polarity <- getField(jsonObject, "polarity").flatMap(v => Polarity_JsonCodec.circeDecoder(v.hcursor))
              force <- getField(jsonObject, "force").flatMap(v => Force_JsonCodec.circeDecoder(v.hcursor))
            } yield ContentInput.Constraint(text,polarity,force)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Constraint: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentInput.Constraint.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentInput.Constraint.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentInput.Constraint.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentInput.Constraint.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Constraint.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentInput.Constraint]] = Lazy(ContentInput.Constraint_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentInput.Constraint]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentInput.Constraint] = LazyInstance.value
    }
    
    
    final case class Task(
      text: String,
      acceptance: AcceptanceInput,
      execution: Execution
    ) extends ContentInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentInput.Task.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentInput.Task.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentInput.Task.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentInput.Task.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentInput.Task.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentInput.Task.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentInput.Task.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Task.baboonAdtType
    }
    
    object Task {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ContentInput]#Task"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ContentInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.getClass
      def codecJson: BaboonJsonCodec[ContentInput.Task] = ContentInput.Task_JsonCodec.instance
    }
    
    object Task_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentInput.Task, BaboonJsonCodec[ContentInput.Task]] {
      def encode(ctx: BaboonCodecContext, value: ContentInput.Task): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "acceptance" -> AcceptanceInput_JsonCodec.instance.encode(ctx, value.acceptance),
          "execution" -> Execution_JsonCodec.instance.encode(ctx, value.execution)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentInput.Task] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              acceptance <- getField(jsonObject, "acceptance").flatMap(v => AcceptanceInput_JsonCodec.circeDecoder(v.hcursor))
              execution <- getField(jsonObject, "execution").flatMap(v => Execution_JsonCodec.circeDecoder(v.hcursor))
            } yield ContentInput.Task(text,acceptance,execution)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Task: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentInput.Task.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentInput.Task.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentInput.Task.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentInput.Task.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Task.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentInput.Task]] = Lazy(ContentInput.Task_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentInput.Task]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentInput.Task] = LazyInstance.value
    }
    
    
    final case class Statement(
      text: String,
      modality: Modality
    ) extends ContentInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentInput.Statement.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentInput.Statement.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentInput.Statement.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentInput.Statement.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentInput.Statement.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentInput.Statement.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentInput.Statement.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Statement.baboonAdtType
    }
    
    object Statement {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ContentInput]#Statement"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ContentInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.getClass
      def codecJson: BaboonJsonCodec[ContentInput.Statement] = ContentInput.Statement_JsonCodec.instance
    }
    
    object Statement_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentInput.Statement, BaboonJsonCodec[ContentInput.Statement]] {
      def encode(ctx: BaboonCodecContext, value: ContentInput.Statement): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "modality" -> Modality_JsonCodec.instance.encode(ctx, value.modality)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentInput.Statement] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              modality <- getField(jsonObject, "modality").flatMap(v => Modality_JsonCodec.circeDecoder(v.hcursor))
            } yield ContentInput.Statement(text,modality)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Statement: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentInput.Statement.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentInput.Statement.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentInput.Statement.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentInput.Statement.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Statement.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentInput.Statement]] = Lazy(ContentInput.Statement_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentInput.Statement]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentInput.Statement] = LazyInstance.value
    }
    
    
    final case class Hypothesis(
      text: String,
      prediction: String
    ) extends ContentInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentInput.Hypothesis.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentInput.Hypothesis.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentInput.Hypothesis.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentInput.Hypothesis.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentInput.Hypothesis.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentInput.Hypothesis.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentInput.Hypothesis.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Hypothesis.baboonAdtType
    }
    
    object Hypothesis {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ContentInput]#Hypothesis"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ContentInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.getClass
      def codecJson: BaboonJsonCodec[ContentInput.Hypothesis] = ContentInput.Hypothesis_JsonCodec.instance
    }
    
    object Hypothesis_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentInput.Hypothesis, BaboonJsonCodec[ContentInput.Hypothesis]] {
      def encode(ctx: BaboonCodecContext, value: ContentInput.Hypothesis): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "prediction" -> Json.fromString(value.prediction)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentInput.Hypothesis] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              prediction <- getField(jsonObject, "prediction").flatMap(v => decodeString(v.hcursor))
            } yield ContentInput.Hypothesis(text,prediction)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Hypothesis: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentInput.Hypothesis.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentInput.Hypothesis.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentInput.Hypothesis.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentInput.Hypothesis.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Hypothesis.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentInput.Hypothesis]] = Lazy(ContentInput.Hypothesis_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentInput.Hypothesis]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentInput.Hypothesis] = LazyInstance.value
    }
    
    
    final case class Defect(
      text: String,
      observed: String,
      expected: String,
      reproduction: String,
      affected: List[Target],
      correction: Correction
    ) extends ContentInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentInput.Defect.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentInput.Defect.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentInput.Defect.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentInput.Defect.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentInput.Defect.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentInput.Defect.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentInput.Defect.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Defect.baboonAdtType
    }
    
    object Defect {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ContentInput]#Defect"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ContentInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.getClass
      def codecJson: BaboonJsonCodec[ContentInput.Defect] = ContentInput.Defect_JsonCodec.instance
    }
    
    object Defect_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentInput.Defect, BaboonJsonCodec[ContentInput.Defect]] {
      def encode(ctx: BaboonCodecContext, value: ContentInput.Defect): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "observed" -> Json.fromString(value.observed),
          "expected" -> Json.fromString(value.expected),
          "reproduction" -> Json.fromString(value.reproduction),
          "affected" -> Json.fromValues(value.affected.map(e => Target_JsonCodec.instance.encode(ctx, e))),
          "correction" -> Correction_JsonCodec.instance.encode(ctx, value.correction)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentInput.Defect] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              observed <- getField(jsonObject, "observed").flatMap(v => decodeString(v.hcursor))
              expected <- getField(jsonObject, "expected").flatMap(v => decodeString(v.hcursor))
              reproduction <- getField(jsonObject, "reproduction").flatMap(v => decodeString(v.hcursor))
              affected <- getField(jsonObject, "affected").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
              correction <- getField(jsonObject, "correction").flatMap(v => Correction_JsonCodec.circeDecoder(v.hcursor))
            } yield ContentInput.Defect(text,observed,expected,reproduction,affected,correction)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Defect: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentInput.Defect.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentInput.Defect.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentInput.Defect.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentInput.Defect.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Defect.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentInput.Defect]] = Lazy(ContentInput.Defect_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentInput.Defect]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentInput.Defect] = LazyInstance.value
    }
    
    
    final case class Question(
      text: String,
      alternatives: List[String],
      answer: Option[String],
      escalation: Escalation
    ) extends ContentInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentInput.Question.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentInput.Question.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentInput.Question.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentInput.Question.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentInput.Question.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentInput.Question.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentInput.Question.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Question.baboonAdtType
    }
    
    object Question {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ContentInput]#Question"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ContentInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.getClass
      def codecJson: BaboonJsonCodec[ContentInput.Question] = ContentInput.Question_JsonCodec.instance
    }
    
    object Question_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentInput.Question, BaboonJsonCodec[ContentInput.Question]] {
      def encode(ctx: BaboonCodecContext, value: ContentInput.Question): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "alternatives" -> Json.fromValues(value.alternatives.map(e => Json.fromString(e))),
          "answer" -> value.answer.map(v => Json.fromString(v)).getOrElse(Json.Null),
          "escalation" -> Escalation_JsonCodec.instance.encode(ctx, value.escalation)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentInput.Question] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              alternatives <- getField(jsonObject, "alternatives").flatMap(v => decodeList(decodeString)(v.hcursor))
              answer <- getField(jsonObject, "answer").flatMap(v => decodeOption(decodeString)(v.hcursor))
              escalation <- getField(jsonObject, "escalation").flatMap(v => Escalation_JsonCodec.circeDecoder(v.hcursor))
            } yield ContentInput.Question(text,alternatives,answer,escalation)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Question: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentInput.Question.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentInput.Question.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentInput.Question.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentInput.Question.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Question.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentInput.Question]] = Lazy(ContentInput.Question_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentInput.Question]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentInput.Question] = LazyInstance.value
    }
    
    
    final case class Decision(
      text: String,
      alternatives: List[String],
      rationale: String
    ) extends ContentInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentInput.Decision.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentInput.Decision.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentInput.Decision.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentInput.Decision.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentInput.Decision.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentInput.Decision.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentInput.Decision.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Decision.baboonAdtType
    }
    
    object Decision {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ContentInput]#Decision"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ContentInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.getClass
      def codecJson: BaboonJsonCodec[ContentInput.Decision] = ContentInput.Decision_JsonCodec.instance
    }
    
    object Decision_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentInput.Decision, BaboonJsonCodec[ContentInput.Decision]] {
      def encode(ctx: BaboonCodecContext, value: ContentInput.Decision): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "alternatives" -> Json.fromValues(value.alternatives.map(e => Json.fromString(e))),
          "rationale" -> Json.fromString(value.rationale)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentInput.Decision] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              alternatives <- getField(jsonObject, "alternatives").flatMap(v => decodeList(decodeString)(v.hcursor))
              rationale <- getField(jsonObject, "rationale").flatMap(v => decodeString(v.hcursor))
            } yield ContentInput.Decision(text,alternatives,rationale)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Decision: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentInput.Decision.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentInput.Decision.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentInput.Decision.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentInput.Decision.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Decision.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentInput.Decision]] = Lazy(ContentInput.Decision_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentInput.Decision]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentInput.Decision] = LazyInstance.value
    }
    
    
    final case class Review(
      text: String,
      findings: List[String],
      subjects: List[Target],
      basis: List[Target],
      uncertainty: String,
      assessment: Assessment
    ) extends ContentInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentInput.Review.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentInput.Review.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentInput.Review.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentInput.Review.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentInput.Review.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentInput.Review.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentInput.Review.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Review.baboonAdtType
    }
    
    object Review {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ContentInput]#Review"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ContentInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.getClass
      def codecJson: BaboonJsonCodec[ContentInput.Review] = ContentInput.Review_JsonCodec.instance
    }
    
    object Review_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentInput.Review, BaboonJsonCodec[ContentInput.Review]] {
      def encode(ctx: BaboonCodecContext, value: ContentInput.Review): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "findings" -> Json.fromValues(value.findings.map(e => Json.fromString(e))),
          "subjects" -> Json.fromValues(value.subjects.map(e => Target_JsonCodec.instance.encode(ctx, e))),
          "basis" -> Json.fromValues(value.basis.map(e => Target_JsonCodec.instance.encode(ctx, e))),
          "uncertainty" -> Json.fromString(value.uncertainty),
          "assessment" -> Assessment_JsonCodec.instance.encode(ctx, value.assessment)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentInput.Review] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              findings <- getField(jsonObject, "findings").flatMap(v => decodeList(decodeString)(v.hcursor))
              subjects <- getField(jsonObject, "subjects").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
              basis <- getField(jsonObject, "basis").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
              uncertainty <- getField(jsonObject, "uncertainty").flatMap(v => decodeString(v.hcursor))
              assessment <- getField(jsonObject, "assessment").flatMap(v => Assessment_JsonCodec.circeDecoder(v.hcursor))
            } yield ContentInput.Review(text,findings,subjects,basis,uncertainty,assessment)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Review: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentInput.Review.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentInput.Review.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentInput.Review.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentInput.Review.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Review.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentInput.Review]] = Lazy(ContentInput.Review_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentInput.Review]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentInput.Review] = LazyInstance.value
    }
    
    
    final case class Conflict(
      text: String,
      subjects: List[Target],
      status: ConflictState,
      resolution: Option[String],
      uncertainty: String
    ) extends ContentInput with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ContentInput.Conflict.baboonDomainVersion
      override def baboonDomainIdentifier: String = ContentInput.Conflict.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ContentInput.Conflict.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ContentInput.Conflict.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ContentInput.Conflict.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ContentInput.Conflict.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ContentInput.Conflict.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Conflict.baboonAdtType
    }
    
    object Conflict {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#ContentInput]#Conflict"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#ContentInput"
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.getClass
      def codecJson: BaboonJsonCodec[ContentInput.Conflict] = ContentInput.Conflict_JsonCodec.instance
    }
    
    object Conflict_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ContentInput.Conflict, BaboonJsonCodec[ContentInput.Conflict]] {
      def encode(ctx: BaboonCodecContext, value: ContentInput.Conflict): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "subjects" -> Json.fromValues(value.subjects.map(e => Target_JsonCodec.instance.encode(ctx, e))),
          "status" -> ConflictState_JsonCodec.instance.encode(ctx, value.status),
          "resolution" -> value.resolution.map(v => Json.fromString(v)).getOrElse(Json.Null),
          "uncertainty" -> Json.fromString(value.uncertainty)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentInput.Conflict] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              subjects <- getField(jsonObject, "subjects").flatMap(v => decodeList(Target_JsonCodec.circeDecoder)(v.hcursor))
              status <- getField(jsonObject, "status").flatMap(v => ConflictState_JsonCodec.circeDecoder(v.hcursor))
              resolution <- getField(jsonObject, "resolution").flatMap(v => decodeOption(decodeString)(v.hcursor))
              uncertainty <- getField(jsonObject, "uncertainty").flatMap(v => decodeString(v.hcursor))
            } yield ContentInput.Conflict(text,subjects,status,resolution,uncertainty)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Conflict: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ContentInput.Conflict.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ContentInput.Conflict.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ContentInput.Conflict.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ContentInput.Conflict.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ContentInput.Conflict.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentInput.Conflict]] = Lazy(ContentInput.Conflict_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentInput.Conflict]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ContentInput.Conflict] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#ContentInput"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ContentInput] = ContentInput_JsonCodec.instance
  }
  
  object ContentInput_JsonCodec extends BaboonJsonCodec.BaseGenerated[ContentInput, BaboonJsonCodec[ContentInput]] {
    def encode(ctx: BaboonCodecContext, value: ContentInput): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case outcome: ContentInput.Outcome => Json.obj("Outcome" -> ContentInput.Outcome_JsonCodec.instance.encode(ctx, outcome))
        
        case constraint: ContentInput.Constraint => Json.obj("Constraint" -> ContentInput.Constraint_JsonCodec.instance.encode(ctx, constraint))
        
        case task: ContentInput.Task => Json.obj("Task" -> ContentInput.Task_JsonCodec.instance.encode(ctx, task))
        
        case statement: ContentInput.Statement => Json.obj("Statement" -> ContentInput.Statement_JsonCodec.instance.encode(ctx, statement))
        
        case hypothesis: ContentInput.Hypothesis => Json.obj("Hypothesis" -> ContentInput.Hypothesis_JsonCodec.instance.encode(ctx, hypothesis))
        
        case defect: ContentInput.Defect => Json.obj("Defect" -> ContentInput.Defect_JsonCodec.instance.encode(ctx, defect))
        
        case question: ContentInput.Question => Json.obj("Question" -> ContentInput.Question_JsonCodec.instance.encode(ctx, question))
        
        case decision: ContentInput.Decision => Json.obj("Decision" -> ContentInput.Decision_JsonCodec.instance.encode(ctx, decision))
        
        case review: ContentInput.Review => Json.obj("Review" -> ContentInput.Review_JsonCodec.instance.encode(ctx, review))
        
        case conflict: ContentInput.Conflict => Json.obj("Conflict" -> ContentInput.Conflict_JsonCodec.instance.encode(ctx, conflict))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ContentInput] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Outcome" =>
                  ContentInput.Outcome_JsonCodec.instance.decode(ctx, json)
                
                case "Constraint" =>
                  ContentInput.Constraint_JsonCodec.instance.decode(ctx, json)
                
                case "Task" =>
                  ContentInput.Task_JsonCodec.instance.decode(ctx, json)
                
                case "Statement" =>
                  ContentInput.Statement_JsonCodec.instance.decode(ctx, json)
                
                case "Hypothesis" =>
                  ContentInput.Hypothesis_JsonCodec.instance.decode(ctx, json)
                
                case "Defect" =>
                  ContentInput.Defect_JsonCodec.instance.decode(ctx, json)
                
                case "Question" =>
                  ContentInput.Question_JsonCodec.instance.decode(ctx, json)
                
                case "Decision" =>
                  ContentInput.Decision_JsonCodec.instance.decode(ctx, json)
                
                case "Review" =>
                  ContentInput.Review_JsonCodec.instance.decode(ctx, json)
                
                case "Conflict" =>
                  ContentInput.Conflict_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ContentInput: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ContentInput: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ContentInput: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ContentInput.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ContentInput.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ContentInput.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ContentInput]] = Lazy(ContentInput_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ContentInput]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ContentInput] = LazyInstance.value
  }
}