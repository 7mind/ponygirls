import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}

import io.circe.Decoder.{decodeOption, decodeString}

package chronicle.api {
  sealed trait ExpressionHintTarget extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ExpressionHintTarget.baboonDomainVersion
    override def baboonDomainIdentifier: String = ExpressionHintTarget.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ExpressionHintTarget.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ExpressionHintTarget.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ExpressionHintTarget.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ExpressionHintTarget.baboonMinReaderVersions
  }
  
  object ExpressionHintTarget {
    final case class Archive(
      
    ) extends ExpressionHintTarget with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ExpressionHintTarget.Archive.baboonDomainVersion
      override def baboonDomainIdentifier: String = ExpressionHintTarget.Archive.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ExpressionHintTarget.Archive.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ExpressionHintTarget.Archive.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ExpressionHintTarget.Archive.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ExpressionHintTarget.Archive.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ExpressionHintTarget.Archive.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ExpressionHintTarget.Archive.baboonAdtType
    }
    
    object Archive {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ExpressionHintTarget"
      def baboonAdtType: _root_.java.lang.Class[?] = ExpressionHintTarget.getClass
      def codecJson: BaboonJsonCodec[ExpressionHintTarget.Archive] = ExpressionHintTarget.Archive_JsonCodec.instance
    }
    
    object Archive_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ExpressionHintTarget.Archive, BaboonJsonCodec[ExpressionHintTarget.Archive]] {
      def encode(ctx: BaboonCodecContext, value: ExpressionHintTarget.Archive): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ExpressionHintTarget.Archive] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ExpressionHintTarget.Archive())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Archive: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ExpressionHintTarget.Archive.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ExpressionHintTarget.Archive.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ExpressionHintTarget.Archive.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ExpressionHintTarget.Archive.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ExpressionHintTarget.Archive.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ExpressionHintTarget.Archive]] = Lazy(ExpressionHintTarget.Archive_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ExpressionHintTarget.Archive]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ExpressionHintTarget.Archive] = LazyInstance.value
    }
    
    
    final case class ActivityCollectors(
      
    ) extends ExpressionHintTarget with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ExpressionHintTarget.ActivityCollectors.baboonDomainVersion
      override def baboonDomainIdentifier: String = ExpressionHintTarget.ActivityCollectors.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ExpressionHintTarget.ActivityCollectors.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ExpressionHintTarget.ActivityCollectors.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ExpressionHintTarget.ActivityCollectors.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ExpressionHintTarget.ActivityCollectors.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ExpressionHintTarget.ActivityCollectors.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ExpressionHintTarget.ActivityCollectors.baboonAdtType
    }
    
    object ActivityCollectors {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityCollectors"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ExpressionHintTarget"
      def baboonAdtType: _root_.java.lang.Class[?] = ExpressionHintTarget.getClass
      def codecJson: BaboonJsonCodec[ExpressionHintTarget.ActivityCollectors] = ExpressionHintTarget.ActivityCollectors_JsonCodec.instance
    }
    
    object ActivityCollectors_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ExpressionHintTarget.ActivityCollectors, BaboonJsonCodec[ExpressionHintTarget.ActivityCollectors]] {
      def encode(ctx: BaboonCodecContext, value: ExpressionHintTarget.ActivityCollectors): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ExpressionHintTarget.ActivityCollectors] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ExpressionHintTarget.ActivityCollectors())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityCollectors: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ExpressionHintTarget.ActivityCollectors.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ExpressionHintTarget.ActivityCollectors.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ExpressionHintTarget.ActivityCollectors.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ExpressionHintTarget.ActivityCollectors.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ExpressionHintTarget.ActivityCollectors.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ExpressionHintTarget.ActivityCollectors]] = Lazy(ExpressionHintTarget.ActivityCollectors_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ExpressionHintTarget.ActivityCollectors]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ExpressionHintTarget.ActivityCollectors] = LazyInstance.value
    }
    
    
    final case class ActivityJobs(
      scope: ActivityJobScope,
      collectorId: Option[String]
    ) extends ExpressionHintTarget with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ExpressionHintTarget.ActivityJobs.baboonDomainVersion
      override def baboonDomainIdentifier: String = ExpressionHintTarget.ActivityJobs.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ExpressionHintTarget.ActivityJobs.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ExpressionHintTarget.ActivityJobs.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ExpressionHintTarget.ActivityJobs.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ExpressionHintTarget.ActivityJobs.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ExpressionHintTarget.ActivityJobs.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ExpressionHintTarget.ActivityJobs.baboonAdtType
    }
    
    object ActivityJobs {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#ActivityJobs"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ExpressionHintTarget"
      def baboonAdtType: _root_.java.lang.Class[?] = ExpressionHintTarget.getClass
      def codecJson: BaboonJsonCodec[ExpressionHintTarget.ActivityJobs] = ExpressionHintTarget.ActivityJobs_JsonCodec.instance
    }
    
    object ActivityJobs_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ExpressionHintTarget.ActivityJobs, BaboonJsonCodec[ExpressionHintTarget.ActivityJobs]] {
      def encode(ctx: BaboonCodecContext, value: ExpressionHintTarget.ActivityJobs): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "scope" -> ActivityJobScope_JsonCodec.instance.encode(ctx, value.scope),
          "collectorId" -> value.collectorId.map(v => Json.fromString(v)).getOrElse(Json.Null)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ExpressionHintTarget.ActivityJobs] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              scope <- getField(jsonObject, "scope").flatMap(v => ActivityJobScope_JsonCodec.circeDecoder(v.hcursor))
              collectorId <- getField(jsonObject, "collectorId").flatMap(v => decodeOption(decodeString)(v.hcursor))
            } yield ExpressionHintTarget.ActivityJobs(scope,collectorId)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ActivityJobs: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ExpressionHintTarget.ActivityJobs.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ExpressionHintTarget.ActivityJobs.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ExpressionHintTarget.ActivityJobs.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ExpressionHintTarget.ActivityJobs.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ExpressionHintTarget.ActivityJobs.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ExpressionHintTarget.ActivityJobs]] = Lazy(ExpressionHintTarget.ActivityJobs_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ExpressionHintTarget.ActivityJobs]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ExpressionHintTarget.ActivityJobs] = LazyInstance.value
    }
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ExpressionHintTarget"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ExpressionHintTarget] = ExpressionHintTarget_JsonCodec.instance
  }
  
  object ExpressionHintTarget_JsonCodec extends BaboonJsonCodec.BaseGenerated[ExpressionHintTarget, BaboonJsonCodec[ExpressionHintTarget]] {
    def encode(ctx: BaboonCodecContext, value: ExpressionHintTarget): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case archive: ExpressionHintTarget.Archive => Json.obj("Archive" -> ExpressionHintTarget.Archive_JsonCodec.instance.encode(ctx, archive))
        
        case activitycollectors: ExpressionHintTarget.ActivityCollectors => Json.obj("ActivityCollectors" -> ExpressionHintTarget.ActivityCollectors_JsonCodec.instance.encode(ctx, activitycollectors))
        
        case activityjobs: ExpressionHintTarget.ActivityJobs => Json.obj("ActivityJobs" -> ExpressionHintTarget.ActivityJobs_JsonCodec.instance.encode(ctx, activityjobs))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ExpressionHintTarget] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Archive" =>
                  ExpressionHintTarget.Archive_JsonCodec.instance.decode(ctx, json)
                
                case "ActivityCollectors" =>
                  ExpressionHintTarget.ActivityCollectors_JsonCodec.instance.decode(ctx, json)
                
                case "ActivityJobs" =>
                  ExpressionHintTarget.ActivityJobs_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ExpressionHintTarget: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ExpressionHintTarget: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ExpressionHintTarget: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ExpressionHintTarget.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ExpressionHintTarget.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ExpressionHintTarget.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ExpressionHintTarget]] = Lazy(ExpressionHintTarget_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ExpressionHintTarget]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ExpressionHintTarget] = LazyInstance.value
  }
}