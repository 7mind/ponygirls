import io.circe.Decoder.{decodeList, decodeOption, decodeString, decodeUUID}
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

import java.util.UUID

package ontology.api {
  sealed trait Content extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = Content.baboonDomainVersion
    override def baboonDomainIdentifier: String = Content.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = Content.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = Content.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = Content.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = Content.baboonMinReaderVersions
  }
  
  object Content {
    final case class Outcome(
      text: String,
      acceptance: Acceptance,
      force: Force
    ) extends Content with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Content.Outcome.baboonDomainVersion
      override def baboonDomainIdentifier: String = Content.Outcome.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Content.Outcome.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Content.Outcome.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Content.Outcome.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Content.Outcome.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Content.Outcome.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Content.Outcome.baboonAdtType
    }
    
    object Outcome {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Content]#Outcome"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Content"
      def baboonAdtType: _root_.java.lang.Class[?] = Content.getClass
      def codecJson: BaboonJsonCodec[Content.Outcome] = Content.Outcome_JsonCodec.instance
    }
    
    object Outcome_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Content.Outcome, BaboonJsonCodec[Content.Outcome]] {
      def encode(ctx: BaboonCodecContext, value: Content.Outcome): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "acceptance" -> Acceptance_JsonCodec.instance.encode(ctx, value.acceptance),
          "force" -> Force_JsonCodec.instance.encode(ctx, value.force)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Content.Outcome] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              acceptance <- getField(jsonObject, "acceptance").flatMap(v => Acceptance_JsonCodec.circeDecoder(v.hcursor))
              force <- getField(jsonObject, "force").flatMap(v => Force_JsonCodec.circeDecoder(v.hcursor))
            } yield Content.Outcome(text,acceptance,force)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Outcome: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Content.Outcome.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Content.Outcome.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Content.Outcome.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Content.Outcome.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Content.Outcome.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Content.Outcome]] = Lazy(Content.Outcome_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Content.Outcome]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Content.Outcome] = LazyInstance.value
    }
    
    
    final case class Constraint(
      text: String,
      polarity: Polarity,
      force: Force
    ) extends Content with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Content.Constraint.baboonDomainVersion
      override def baboonDomainIdentifier: String = Content.Constraint.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Content.Constraint.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Content.Constraint.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Content.Constraint.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Content.Constraint.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Content.Constraint.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Content.Constraint.baboonAdtType
    }
    
    object Constraint {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Content]#Constraint"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Content"
      def baboonAdtType: _root_.java.lang.Class[?] = Content.getClass
      def codecJson: BaboonJsonCodec[Content.Constraint] = Content.Constraint_JsonCodec.instance
    }
    
    object Constraint_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Content.Constraint, BaboonJsonCodec[Content.Constraint]] {
      def encode(ctx: BaboonCodecContext, value: Content.Constraint): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "polarity" -> Polarity_JsonCodec.instance.encode(ctx, value.polarity),
          "force" -> Force_JsonCodec.instance.encode(ctx, value.force)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Content.Constraint] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              polarity <- getField(jsonObject, "polarity").flatMap(v => Polarity_JsonCodec.circeDecoder(v.hcursor))
              force <- getField(jsonObject, "force").flatMap(v => Force_JsonCodec.circeDecoder(v.hcursor))
            } yield Content.Constraint(text,polarity,force)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Constraint: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Content.Constraint.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Content.Constraint.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Content.Constraint.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Content.Constraint.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Content.Constraint.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Content.Constraint]] = Lazy(Content.Constraint_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Content.Constraint]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Content.Constraint] = LazyInstance.value
    }
    
    
    final case class Task(
      text: String,
      acceptance: Acceptance,
      execution: Execution
    ) extends Content with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Content.Task.baboonDomainVersion
      override def baboonDomainIdentifier: String = Content.Task.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Content.Task.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Content.Task.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Content.Task.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Content.Task.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Content.Task.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Content.Task.baboonAdtType
    }
    
    object Task {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Content]#Task"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Content"
      def baboonAdtType: _root_.java.lang.Class[?] = Content.getClass
      def codecJson: BaboonJsonCodec[Content.Task] = Content.Task_JsonCodec.instance
    }
    
    object Task_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Content.Task, BaboonJsonCodec[Content.Task]] {
      def encode(ctx: BaboonCodecContext, value: Content.Task): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "acceptance" -> Acceptance_JsonCodec.instance.encode(ctx, value.acceptance),
          "execution" -> Execution_JsonCodec.instance.encode(ctx, value.execution)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Content.Task] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              acceptance <- getField(jsonObject, "acceptance").flatMap(v => Acceptance_JsonCodec.circeDecoder(v.hcursor))
              execution <- getField(jsonObject, "execution").flatMap(v => Execution_JsonCodec.circeDecoder(v.hcursor))
            } yield Content.Task(text,acceptance,execution)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Task: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Content.Task.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Content.Task.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Content.Task.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Content.Task.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Content.Task.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Content.Task]] = Lazy(Content.Task_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Content.Task]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Content.Task] = LazyInstance.value
    }
    
    
    final case class Statement(
      text: String,
      modality: Modality
    ) extends Content with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Content.Statement.baboonDomainVersion
      override def baboonDomainIdentifier: String = Content.Statement.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Content.Statement.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Content.Statement.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Content.Statement.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Content.Statement.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Content.Statement.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Content.Statement.baboonAdtType
    }
    
    object Statement {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Content]#Statement"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Content"
      def baboonAdtType: _root_.java.lang.Class[?] = Content.getClass
      def codecJson: BaboonJsonCodec[Content.Statement] = Content.Statement_JsonCodec.instance
    }
    
    object Statement_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Content.Statement, BaboonJsonCodec[Content.Statement]] {
      def encode(ctx: BaboonCodecContext, value: Content.Statement): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "modality" -> Modality_JsonCodec.instance.encode(ctx, value.modality)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Content.Statement] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              modality <- getField(jsonObject, "modality").flatMap(v => Modality_JsonCodec.circeDecoder(v.hcursor))
            } yield Content.Statement(text,modality)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Statement: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Content.Statement.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Content.Statement.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Content.Statement.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Content.Statement.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Content.Statement.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Content.Statement]] = Lazy(Content.Statement_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Content.Statement]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Content.Statement] = LazyInstance.value
    }
    
    
    final case class Hypothesis(
      text: String,
      prediction: String
    ) extends Content with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Content.Hypothesis.baboonDomainVersion
      override def baboonDomainIdentifier: String = Content.Hypothesis.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Content.Hypothesis.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Content.Hypothesis.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Content.Hypothesis.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Content.Hypothesis.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Content.Hypothesis.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Content.Hypothesis.baboonAdtType
    }
    
    object Hypothesis {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Content]#Hypothesis"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Content"
      def baboonAdtType: _root_.java.lang.Class[?] = Content.getClass
      def codecJson: BaboonJsonCodec[Content.Hypothesis] = Content.Hypothesis_JsonCodec.instance
    }
    
    object Hypothesis_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Content.Hypothesis, BaboonJsonCodec[Content.Hypothesis]] {
      def encode(ctx: BaboonCodecContext, value: Content.Hypothesis): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "prediction" -> Json.fromString(value.prediction)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Content.Hypothesis] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              prediction <- getField(jsonObject, "prediction").flatMap(v => decodeString(v.hcursor))
            } yield Content.Hypothesis(text,prediction)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Hypothesis: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Content.Hypothesis.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Content.Hypothesis.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Content.Hypothesis.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Content.Hypothesis.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Content.Hypothesis.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Content.Hypothesis]] = Lazy(Content.Hypothesis_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Content.Hypothesis]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Content.Hypothesis] = LazyInstance.value
    }
    
    
    final case class Defect(
      text: String,
      observed: String,
      expected: String,
      reproduction: String,
      affected: List[Ref],
      correction: Correction
    ) extends Content with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Content.Defect.baboonDomainVersion
      override def baboonDomainIdentifier: String = Content.Defect.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Content.Defect.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Content.Defect.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Content.Defect.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Content.Defect.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Content.Defect.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Content.Defect.baboonAdtType
    }
    
    object Defect {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Content]#Defect"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Content"
      def baboonAdtType: _root_.java.lang.Class[?] = Content.getClass
      def codecJson: BaboonJsonCodec[Content.Defect] = Content.Defect_JsonCodec.instance
    }
    
    object Defect_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Content.Defect, BaboonJsonCodec[Content.Defect]] {
      def encode(ctx: BaboonCodecContext, value: Content.Defect): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "observed" -> Json.fromString(value.observed),
          "expected" -> Json.fromString(value.expected),
          "reproduction" -> Json.fromString(value.reproduction),
          "affected" -> Json.fromValues(value.affected.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
          "correction" -> Correction_JsonCodec.instance.encode(ctx, value.correction)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Content.Defect] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              observed <- getField(jsonObject, "observed").flatMap(v => decodeString(v.hcursor))
              expected <- getField(jsonObject, "expected").flatMap(v => decodeString(v.hcursor))
              reproduction <- getField(jsonObject, "reproduction").flatMap(v => decodeString(v.hcursor))
              affected <- getField(jsonObject, "affected").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
              correction <- getField(jsonObject, "correction").flatMap(v => Correction_JsonCodec.circeDecoder(v.hcursor))
            } yield Content.Defect(text,observed,expected,reproduction,affected,correction)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Defect: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Content.Defect.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Content.Defect.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Content.Defect.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Content.Defect.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Content.Defect.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Content.Defect]] = Lazy(Content.Defect_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Content.Defect]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Content.Defect] = LazyInstance.value
    }
    
    
    final case class Question(
      text: String,
      alternatives: List[String],
      answer: Option[String],
      escalation: Escalation
    ) extends Content with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Content.Question.baboonDomainVersion
      override def baboonDomainIdentifier: String = Content.Question.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Content.Question.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Content.Question.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Content.Question.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Content.Question.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Content.Question.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Content.Question.baboonAdtType
    }
    
    object Question {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Content]#Question"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Content"
      def baboonAdtType: _root_.java.lang.Class[?] = Content.getClass
      def codecJson: BaboonJsonCodec[Content.Question] = Content.Question_JsonCodec.instance
    }
    
    object Question_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Content.Question, BaboonJsonCodec[Content.Question]] {
      def encode(ctx: BaboonCodecContext, value: Content.Question): Json = {
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
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Content.Question] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              alternatives <- getField(jsonObject, "alternatives").flatMap(v => decodeList(decodeString)(v.hcursor))
              answer <- getField(jsonObject, "answer").flatMap(v => decodeOption(decodeString)(v.hcursor))
              escalation <- getField(jsonObject, "escalation").flatMap(v => Escalation_JsonCodec.circeDecoder(v.hcursor))
            } yield Content.Question(text,alternatives,answer,escalation)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Question: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Content.Question.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Content.Question.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Content.Question.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Content.Question.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Content.Question.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Content.Question]] = Lazy(Content.Question_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Content.Question]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Content.Question] = LazyInstance.value
    }
    
    
    final case class Decision(
      text: String,
      alternatives: List[String],
      rationale: String
    ) extends Content with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Content.Decision.baboonDomainVersion
      override def baboonDomainIdentifier: String = Content.Decision.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Content.Decision.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Content.Decision.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Content.Decision.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Content.Decision.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Content.Decision.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Content.Decision.baboonAdtType
    }
    
    object Decision {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Content]#Decision"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Content"
      def baboonAdtType: _root_.java.lang.Class[?] = Content.getClass
      def codecJson: BaboonJsonCodec[Content.Decision] = Content.Decision_JsonCodec.instance
    }
    
    object Decision_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Content.Decision, BaboonJsonCodec[Content.Decision]] {
      def encode(ctx: BaboonCodecContext, value: Content.Decision): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "alternatives" -> Json.fromValues(value.alternatives.map(e => Json.fromString(e))),
          "rationale" -> Json.fromString(value.rationale)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Content.Decision] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              alternatives <- getField(jsonObject, "alternatives").flatMap(v => decodeList(decodeString)(v.hcursor))
              rationale <- getField(jsonObject, "rationale").flatMap(v => decodeString(v.hcursor))
            } yield Content.Decision(text,alternatives,rationale)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Decision: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Content.Decision.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Content.Decision.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Content.Decision.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Content.Decision.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Content.Decision.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Content.Decision]] = Lazy(Content.Decision_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Content.Decision]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Content.Decision] = LazyInstance.value
    }
    
    
    final case class Review(
      text: String,
      findings: List[String],
      subjects: List[Ref],
      basis: List[Ref],
      uncertainty: String,
      assessment: Assessment
    ) extends Content with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Content.Review.baboonDomainVersion
      override def baboonDomainIdentifier: String = Content.Review.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Content.Review.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Content.Review.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Content.Review.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Content.Review.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Content.Review.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Content.Review.baboonAdtType
    }
    
    object Review {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Content]#Review"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Content"
      def baboonAdtType: _root_.java.lang.Class[?] = Content.getClass
      def codecJson: BaboonJsonCodec[Content.Review] = Content.Review_JsonCodec.instance
    }
    
    object Review_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Content.Review, BaboonJsonCodec[Content.Review]] {
      def encode(ctx: BaboonCodecContext, value: Content.Review): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "findings" -> Json.fromValues(value.findings.map(e => Json.fromString(e))),
          "subjects" -> Json.fromValues(value.subjects.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
          "basis" -> Json.fromValues(value.basis.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
          "uncertainty" -> Json.fromString(value.uncertainty),
          "assessment" -> Assessment_JsonCodec.instance.encode(ctx, value.assessment)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Content.Review] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              findings <- getField(jsonObject, "findings").flatMap(v => decodeList(decodeString)(v.hcursor))
              subjects <- getField(jsonObject, "subjects").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
              basis <- getField(jsonObject, "basis").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
              uncertainty <- getField(jsonObject, "uncertainty").flatMap(v => decodeString(v.hcursor))
              assessment <- getField(jsonObject, "assessment").flatMap(v => Assessment_JsonCodec.circeDecoder(v.hcursor))
            } yield Content.Review(text,findings,subjects,basis,uncertainty,assessment)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Review: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Content.Review.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Content.Review.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Content.Review.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Content.Review.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Content.Review.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Content.Review]] = Lazy(Content.Review_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Content.Review]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Content.Review] = LazyInstance.value
    }
    
    
    final case class Source(
      text: String,
      context: List[Ref],
      rawDigest: String,
      eventId: UUID
    ) extends Content with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Content.Source.baboonDomainVersion
      override def baboonDomainIdentifier: String = Content.Source.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Content.Source.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Content.Source.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Content.Source.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Content.Source.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Content.Source.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Content.Source.baboonAdtType
    }
    
    object Source {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Content]#Source"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Content"
      def baboonAdtType: _root_.java.lang.Class[?] = Content.getClass
      def codecJson: BaboonJsonCodec[Content.Source] = Content.Source_JsonCodec.instance
    }
    
    object Source_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Content.Source, BaboonJsonCodec[Content.Source]] {
      def encode(ctx: BaboonCodecContext, value: Content.Source): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "context" -> Json.fromValues(value.context.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
          "rawDigest" -> Json.fromString(value.rawDigest),
          "eventId" -> Json.fromString(value.eventId.toString())
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Content.Source] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              context <- getField(jsonObject, "context").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
              rawDigest <- getField(jsonObject, "rawDigest").flatMap(v => decodeString(v.hcursor))
              eventId <- getField(jsonObject, "eventId").flatMap(v => decodeUUID(v.hcursor))
            } yield Content.Source(text,context,rawDigest,eventId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Source: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Content.Source.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Content.Source.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Content.Source.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Content.Source.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Content.Source.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Content.Source]] = Lazy(Content.Source_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Content.Source]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Content.Source] = LazyInstance.value
    }
    
    
    final case class Artifact(
      text: String,
      digest: String,
      mediaType: String,
      locator: String,
      generation: Long
    ) extends Content with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Content.Artifact.baboonDomainVersion
      override def baboonDomainIdentifier: String = Content.Artifact.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Content.Artifact.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Content.Artifact.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Content.Artifact.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Content.Artifact.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Content.Artifact.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Content.Artifact.baboonAdtType
    }
    
    object Artifact {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Content]#Artifact"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Content"
      def baboonAdtType: _root_.java.lang.Class[?] = Content.getClass
      def codecJson: BaboonJsonCodec[Content.Artifact] = Content.Artifact_JsonCodec.instance
    }
    
    object Artifact_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Content.Artifact, BaboonJsonCodec[Content.Artifact]] {
      def encode(ctx: BaboonCodecContext, value: Content.Artifact): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "digest" -> Json.fromString(value.digest),
          "mediaType" -> Json.fromString(value.mediaType),
          "locator" -> Json.fromString(value.locator),
          "generation" -> Json.fromString(value.generation.toString)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Content.Artifact] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              digest <- getField(jsonObject, "digest").flatMap(v => decodeString(v.hcursor))
              mediaType <- getField(jsonObject, "mediaType").flatMap(v => decodeString(v.hcursor))
              locator <- getField(jsonObject, "locator").flatMap(v => decodeString(v.hcursor))
              generation <- getField(jsonObject, "generation").flatMap(v => BaboonJsonCodec.decodeLong(v.hcursor))
            } yield Content.Artifact(text,digest,mediaType,locator,generation)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Artifact: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Content.Artifact.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Content.Artifact.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Content.Artifact.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Content.Artifact.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Content.Artifact.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Content.Artifact]] = Lazy(Content.Artifact_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Content.Artifact]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Content.Artifact] = LazyInstance.value
    }
    
    
    final case class Conflict(
      text: String,
      subjects: List[Ref],
      status: ConflictState,
      resolution: Option[String],
      uncertainty: String
    ) extends Content with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = Content.Conflict.baboonDomainVersion
      override def baboonDomainIdentifier: String = Content.Conflict.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = Content.Conflict.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = Content.Conflict.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = Content.Conflict.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = Content.Conflict.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = Content.Conflict.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = Content.Conflict.baboonAdtType
    }
    
    object Conflict {
      def baboonDomainVersion: String = "0.1.0"
      def baboonDomainIdentifier: String = "ontology.api"
      def baboonTypeIdentifier: String = "ontology.api/[ontology.api/:#Content]#Conflict"
      private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "ontology.api/:#Content"
      def baboonAdtType: _root_.java.lang.Class[?] = Content.getClass
      def codecJson: BaboonJsonCodec[Content.Conflict] = Content.Conflict_JsonCodec.instance
    }
    
    object Conflict_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[Content.Conflict, BaboonJsonCodec[Content.Conflict]] {
      def encode(ctx: BaboonCodecContext, value: Content.Conflict): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "text" -> Json.fromString(value.text),
          "subjects" -> Json.fromValues(value.subjects.map(e => Ref_JsonCodec.instance.encode(ctx, e))),
          "status" -> ConflictState_JsonCodec.instance.encode(ctx, value.status),
          "resolution" -> value.resolution.map(v => Json.fromString(v)).getOrElse(Json.Null),
          "uncertainty" -> Json.fromString(value.uncertainty)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Content.Conflict] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              text <- getField(jsonObject, "text").flatMap(v => decodeString(v.hcursor))
              subjects <- getField(jsonObject, "subjects").flatMap(v => decodeList(Ref_JsonCodec.circeDecoder)(v.hcursor))
              status <- getField(jsonObject, "status").flatMap(v => ConflictState_JsonCodec.circeDecoder(v.hcursor))
              resolution <- getField(jsonObject, "resolution").flatMap(v => decodeOption(decodeString)(v.hcursor))
              uncertainty <- getField(jsonObject, "uncertainty").flatMap(v => decodeString(v.hcursor))
            } yield Content.Conflict(text,subjects,status,resolution,uncertainty)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Conflict: object expected"))
        }
      }
    
      def baboonDomainVersion: String = Content.Conflict.baboonDomainVersion
      
      def baboonDomainIdentifier: String = Content.Conflict.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = Content.Conflict.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = Content.Conflict.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = Content.Conflict.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Content.Conflict]] = Lazy(Content.Conflict_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[Content.Conflict]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[Content.Conflict] = LazyInstance.value
    }
    def baboonDomainVersion: String = "0.1.0"
    def baboonDomainIdentifier: String = "ontology.api"
    def baboonTypeIdentifier: String = "ontology.api/:#Content"
    private lazy val _baboonSameInVersions: List[String] = List("0.1.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("0.1.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "0.1.0", "prefix-compact" -> "0.1.0", "prefix-any-mode" -> "0.1.0", "identical" -> "0.1.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[Content] = Content_JsonCodec.instance
  }
  
  object Content_JsonCodec extends BaboonJsonCodec.BaseGenerated[Content, BaboonJsonCodec[Content]] {
    def encode(ctx: BaboonCodecContext, value: Content): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case outcome: Content.Outcome => Json.obj("Outcome" -> Content.Outcome_JsonCodec.instance.encode(ctx, outcome))
        
        case constraint: Content.Constraint => Json.obj("Constraint" -> Content.Constraint_JsonCodec.instance.encode(ctx, constraint))
        
        case task: Content.Task => Json.obj("Task" -> Content.Task_JsonCodec.instance.encode(ctx, task))
        
        case statement: Content.Statement => Json.obj("Statement" -> Content.Statement_JsonCodec.instance.encode(ctx, statement))
        
        case hypothesis: Content.Hypothesis => Json.obj("Hypothesis" -> Content.Hypothesis_JsonCodec.instance.encode(ctx, hypothesis))
        
        case defect: Content.Defect => Json.obj("Defect" -> Content.Defect_JsonCodec.instance.encode(ctx, defect))
        
        case question: Content.Question => Json.obj("Question" -> Content.Question_JsonCodec.instance.encode(ctx, question))
        
        case decision: Content.Decision => Json.obj("Decision" -> Content.Decision_JsonCodec.instance.encode(ctx, decision))
        
        case review: Content.Review => Json.obj("Review" -> Content.Review_JsonCodec.instance.encode(ctx, review))
        
        case source: Content.Source => Json.obj("Source" -> Content.Source_JsonCodec.instance.encode(ctx, source))
        
        case artifact: Content.Artifact => Json.obj("Artifact" -> Content.Artifact_JsonCodec.instance.encode(ctx, artifact))
        
        case conflict: Content.Conflict => Json.obj("Conflict" -> Content.Conflict_JsonCodec.instance.encode(ctx, conflict))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, Content] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Outcome" =>
                  Content.Outcome_JsonCodec.instance.decode(ctx, json)
                
                case "Constraint" =>
                  Content.Constraint_JsonCodec.instance.decode(ctx, json)
                
                case "Task" =>
                  Content.Task_JsonCodec.instance.decode(ctx, json)
                
                case "Statement" =>
                  Content.Statement_JsonCodec.instance.decode(ctx, json)
                
                case "Hypothesis" =>
                  Content.Hypothesis_JsonCodec.instance.decode(ctx, json)
                
                case "Defect" =>
                  Content.Defect_JsonCodec.instance.decode(ctx, json)
                
                case "Question" =>
                  Content.Question_JsonCodec.instance.decode(ctx, json)
                
                case "Decision" =>
                  Content.Decision_JsonCodec.instance.decode(ctx, json)
                
                case "Review" =>
                  Content.Review_JsonCodec.instance.decode(ctx, json)
                
                case "Source" =>
                  Content.Source_JsonCodec.instance.decode(ctx, json)
                
                case "Artifact" =>
                  Content.Artifact_JsonCodec.instance.decode(ctx, json)
                
                case "Conflict" =>
                  Content.Conflict_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Content: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Content: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to Content: object expected"))
      }
    }
  
    def baboonDomainVersion: String = Content.baboonDomainVersion
    
    def baboonDomainIdentifier: String = Content.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = Content.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[Content]] = Lazy(Content_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[Content]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[Content] = LazyInstance.value
  }
}