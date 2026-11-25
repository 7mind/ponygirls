import io.circe.Decoder.decodeString
import io.circe.Json
import _root_.baboon.runtime.shared.{BaboonJsonCodec, BaboonAdtMemberMeta, BaboonCodecContext, BaboonGeneratedLatest, Lazy}


package chronicle.api {
  sealed trait ActivityJobWaiting extends BaboonGeneratedLatest {
    override def baboonDomainVersion: String = ActivityJobWaiting.baboonDomainVersion
    override def baboonDomainIdentifier: String = ActivityJobWaiting.baboonDomainIdentifier
    override def baboonTypeIdentifier: String = ActivityJobWaiting.baboonTypeIdentifier
    override def baboonSameInVersions: List[String] = ActivityJobWaiting.baboonSameInVersions
    override def baboonForwardReadable: Map[String, String] = ActivityJobWaiting.baboonForwardReadable
    override def baboonMinReaderVersions: Map[String, String] = ActivityJobWaiting.baboonMinReaderVersions
  }
  
  object ActivityJobWaiting {
    final case class Queued(
      
    ) extends ActivityJobWaiting with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ActivityJobWaiting.Queued.baboonDomainVersion
      override def baboonDomainIdentifier: String = ActivityJobWaiting.Queued.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ActivityJobWaiting.Queued.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ActivityJobWaiting.Queued.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ActivityJobWaiting.Queued.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ActivityJobWaiting.Queued.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ActivityJobWaiting.Queued.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.Queued.baboonAdtType
    }
    
    object Queued {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ActivityJobWaiting]#Queued"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ActivityJobWaiting"
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.getClass
      def codecJson: BaboonJsonCodec[ActivityJobWaiting.Queued] = ActivityJobWaiting.Queued_JsonCodec.instance
    }
    
    object Queued_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ActivityJobWaiting.Queued, BaboonJsonCodec[ActivityJobWaiting.Queued]] {
      def encode(ctx: BaboonCodecContext, value: ActivityJobWaiting.Queued): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobWaiting.Queued] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ActivityJobWaiting.Queued())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Queued: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ActivityJobWaiting.Queued.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ActivityJobWaiting.Queued.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ActivityJobWaiting.Queued.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ActivityJobWaiting.Queued.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.Queued.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.Queued]] = Lazy(ActivityJobWaiting.Queued_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.Queued]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ActivityJobWaiting.Queued] = LazyInstance.value
    }
    
    
    final case class IndexingOff(
      
    ) extends ActivityJobWaiting with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ActivityJobWaiting.IndexingOff.baboonDomainVersion
      override def baboonDomainIdentifier: String = ActivityJobWaiting.IndexingOff.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ActivityJobWaiting.IndexingOff.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ActivityJobWaiting.IndexingOff.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ActivityJobWaiting.IndexingOff.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ActivityJobWaiting.IndexingOff.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ActivityJobWaiting.IndexingOff.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.IndexingOff.baboonAdtType
    }
    
    object IndexingOff {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ActivityJobWaiting]#IndexingOff"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ActivityJobWaiting"
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.getClass
      def codecJson: BaboonJsonCodec[ActivityJobWaiting.IndexingOff] = ActivityJobWaiting.IndexingOff_JsonCodec.instance
    }
    
    object IndexingOff_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ActivityJobWaiting.IndexingOff, BaboonJsonCodec[ActivityJobWaiting.IndexingOff]] {
      def encode(ctx: BaboonCodecContext, value: ActivityJobWaiting.IndexingOff): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobWaiting.IndexingOff] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ActivityJobWaiting.IndexingOff())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to IndexingOff: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ActivityJobWaiting.IndexingOff.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ActivityJobWaiting.IndexingOff.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ActivityJobWaiting.IndexingOff.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ActivityJobWaiting.IndexingOff.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.IndexingOff.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.IndexingOff]] = Lazy(ActivityJobWaiting.IndexingOff_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.IndexingOff]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ActivityJobWaiting.IndexingOff] = LazyInstance.value
    }
    
    
    final case class AwaitingReclaim(
      
    ) extends ActivityJobWaiting with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ActivityJobWaiting.AwaitingReclaim.baboonDomainVersion
      override def baboonDomainIdentifier: String = ActivityJobWaiting.AwaitingReclaim.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ActivityJobWaiting.AwaitingReclaim.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ActivityJobWaiting.AwaitingReclaim.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ActivityJobWaiting.AwaitingReclaim.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ActivityJobWaiting.AwaitingReclaim.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ActivityJobWaiting.AwaitingReclaim.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.AwaitingReclaim.baboonAdtType
    }
    
    object AwaitingReclaim {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ActivityJobWaiting]#AwaitingReclaim"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ActivityJobWaiting"
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.getClass
      def codecJson: BaboonJsonCodec[ActivityJobWaiting.AwaitingReclaim] = ActivityJobWaiting.AwaitingReclaim_JsonCodec.instance
    }
    
    object AwaitingReclaim_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ActivityJobWaiting.AwaitingReclaim, BaboonJsonCodec[ActivityJobWaiting.AwaitingReclaim]] {
      def encode(ctx: BaboonCodecContext, value: ActivityJobWaiting.AwaitingReclaim): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobWaiting.AwaitingReclaim] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ActivityJobWaiting.AwaitingReclaim())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to AwaitingReclaim: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ActivityJobWaiting.AwaitingReclaim.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ActivityJobWaiting.AwaitingReclaim.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ActivityJobWaiting.AwaitingReclaim.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ActivityJobWaiting.AwaitingReclaim.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.AwaitingReclaim.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.AwaitingReclaim]] = Lazy(ActivityJobWaiting.AwaitingReclaim_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.AwaitingReclaim]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ActivityJobWaiting.AwaitingReclaim] = LazyInstance.value
    }
    
    
    final case class LeaseExpiredAwaitingReclaim(
      
    ) extends ActivityJobWaiting with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ActivityJobWaiting.LeaseExpiredAwaitingReclaim.baboonDomainVersion
      override def baboonDomainIdentifier: String = ActivityJobWaiting.LeaseExpiredAwaitingReclaim.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ActivityJobWaiting.LeaseExpiredAwaitingReclaim.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ActivityJobWaiting.LeaseExpiredAwaitingReclaim.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ActivityJobWaiting.LeaseExpiredAwaitingReclaim.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ActivityJobWaiting.LeaseExpiredAwaitingReclaim.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ActivityJobWaiting.LeaseExpiredAwaitingReclaim.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.LeaseExpiredAwaitingReclaim.baboonAdtType
    }
    
    object LeaseExpiredAwaitingReclaim {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ActivityJobWaiting]#LeaseExpiredAwaitingReclaim"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ActivityJobWaiting"
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.getClass
      def codecJson: BaboonJsonCodec[ActivityJobWaiting.LeaseExpiredAwaitingReclaim] = ActivityJobWaiting.LeaseExpiredAwaitingReclaim_JsonCodec.instance
    }
    
    object LeaseExpiredAwaitingReclaim_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ActivityJobWaiting.LeaseExpiredAwaitingReclaim, BaboonJsonCodec[ActivityJobWaiting.LeaseExpiredAwaitingReclaim]] {
      def encode(ctx: BaboonCodecContext, value: ActivityJobWaiting.LeaseExpiredAwaitingReclaim): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobWaiting.LeaseExpiredAwaitingReclaim] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ActivityJobWaiting.LeaseExpiredAwaitingReclaim())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to LeaseExpiredAwaitingReclaim: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ActivityJobWaiting.LeaseExpiredAwaitingReclaim.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ActivityJobWaiting.LeaseExpiredAwaitingReclaim.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ActivityJobWaiting.LeaseExpiredAwaitingReclaim.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ActivityJobWaiting.LeaseExpiredAwaitingReclaim.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.LeaseExpiredAwaitingReclaim.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.LeaseExpiredAwaitingReclaim]] = Lazy(ActivityJobWaiting.LeaseExpiredAwaitingReclaim_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.LeaseExpiredAwaitingReclaim]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ActivityJobWaiting.LeaseExpiredAwaitingReclaim] = LazyInstance.value
    }
    
    
    final case class LeaseExhaustedPending(
      
    ) extends ActivityJobWaiting with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ActivityJobWaiting.LeaseExhaustedPending.baboonDomainVersion
      override def baboonDomainIdentifier: String = ActivityJobWaiting.LeaseExhaustedPending.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ActivityJobWaiting.LeaseExhaustedPending.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ActivityJobWaiting.LeaseExhaustedPending.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ActivityJobWaiting.LeaseExhaustedPending.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ActivityJobWaiting.LeaseExhaustedPending.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ActivityJobWaiting.LeaseExhaustedPending.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.LeaseExhaustedPending.baboonAdtType
    }
    
    object LeaseExhaustedPending {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ActivityJobWaiting]#LeaseExhaustedPending"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ActivityJobWaiting"
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.getClass
      def codecJson: BaboonJsonCodec[ActivityJobWaiting.LeaseExhaustedPending] = ActivityJobWaiting.LeaseExhaustedPending_JsonCodec.instance
    }
    
    object LeaseExhaustedPending_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ActivityJobWaiting.LeaseExhaustedPending, BaboonJsonCodec[ActivityJobWaiting.LeaseExhaustedPending]] {
      def encode(ctx: BaboonCodecContext, value: ActivityJobWaiting.LeaseExhaustedPending): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobWaiting.LeaseExhaustedPending] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ActivityJobWaiting.LeaseExhaustedPending())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to LeaseExhaustedPending: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ActivityJobWaiting.LeaseExhaustedPending.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ActivityJobWaiting.LeaseExhaustedPending.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ActivityJobWaiting.LeaseExhaustedPending.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ActivityJobWaiting.LeaseExhaustedPending.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.LeaseExhaustedPending.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.LeaseExhaustedPending]] = Lazy(ActivityJobWaiting.LeaseExhaustedPending_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.LeaseExhaustedPending]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ActivityJobWaiting.LeaseExhaustedPending] = LazyInstance.value
    }
    
    
    final case class RunningWithoutLease(
      
    ) extends ActivityJobWaiting with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ActivityJobWaiting.RunningWithoutLease.baboonDomainVersion
      override def baboonDomainIdentifier: String = ActivityJobWaiting.RunningWithoutLease.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ActivityJobWaiting.RunningWithoutLease.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ActivityJobWaiting.RunningWithoutLease.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ActivityJobWaiting.RunningWithoutLease.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ActivityJobWaiting.RunningWithoutLease.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ActivityJobWaiting.RunningWithoutLease.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.RunningWithoutLease.baboonAdtType
    }
    
    object RunningWithoutLease {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ActivityJobWaiting]#RunningWithoutLease"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ActivityJobWaiting"
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.getClass
      def codecJson: BaboonJsonCodec[ActivityJobWaiting.RunningWithoutLease] = ActivityJobWaiting.RunningWithoutLease_JsonCodec.instance
    }
    
    object RunningWithoutLease_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ActivityJobWaiting.RunningWithoutLease, BaboonJsonCodec[ActivityJobWaiting.RunningWithoutLease]] {
      def encode(ctx: BaboonCodecContext, value: ActivityJobWaiting.RunningWithoutLease): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobWaiting.RunningWithoutLease] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ActivityJobWaiting.RunningWithoutLease())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to RunningWithoutLease: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ActivityJobWaiting.RunningWithoutLease.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ActivityJobWaiting.RunningWithoutLease.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ActivityJobWaiting.RunningWithoutLease.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ActivityJobWaiting.RunningWithoutLease.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.RunningWithoutLease.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.RunningWithoutLease]] = Lazy(ActivityJobWaiting.RunningWithoutLease_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.RunningWithoutLease]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ActivityJobWaiting.RunningWithoutLease] = LazyInstance.value
    }
    
    
    final case class Held(
      nextAttemptAt: String
    ) extends ActivityJobWaiting with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ActivityJobWaiting.Held.baboonDomainVersion
      override def baboonDomainIdentifier: String = ActivityJobWaiting.Held.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ActivityJobWaiting.Held.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ActivityJobWaiting.Held.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ActivityJobWaiting.Held.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ActivityJobWaiting.Held.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ActivityJobWaiting.Held.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.Held.baboonAdtType
    }
    
    object Held {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ActivityJobWaiting]#Held"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ActivityJobWaiting"
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.getClass
      def codecJson: BaboonJsonCodec[ActivityJobWaiting.Held] = ActivityJobWaiting.Held_JsonCodec.instance
    }
    
    object Held_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ActivityJobWaiting.Held, BaboonJsonCodec[ActivityJobWaiting.Held]] {
      def encode(ctx: BaboonCodecContext, value: ActivityJobWaiting.Held): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "nextAttemptAt" -> Json.fromString(value.nextAttemptAt)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobWaiting.Held] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              nextAttemptAt <- getField(jsonObject, "nextAttemptAt").flatMap(v => decodeString(v.hcursor))
            } yield ActivityJobWaiting.Held(nextAttemptAt)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to Held: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ActivityJobWaiting.Held.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ActivityJobWaiting.Held.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ActivityJobWaiting.Held.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ActivityJobWaiting.Held.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.Held.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.Held]] = Lazy(ActivityJobWaiting.Held_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.Held]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ActivityJobWaiting.Held] = LazyInstance.value
    }
    
    
    final case class BlockedByOlderRevision(
      revision: Int
    ) extends ActivityJobWaiting with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ActivityJobWaiting.BlockedByOlderRevision.baboonDomainVersion
      override def baboonDomainIdentifier: String = ActivityJobWaiting.BlockedByOlderRevision.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ActivityJobWaiting.BlockedByOlderRevision.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ActivityJobWaiting.BlockedByOlderRevision.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ActivityJobWaiting.BlockedByOlderRevision.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ActivityJobWaiting.BlockedByOlderRevision.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ActivityJobWaiting.BlockedByOlderRevision.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.BlockedByOlderRevision.baboonAdtType
    }
    
    object BlockedByOlderRevision {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ActivityJobWaiting]#BlockedByOlderRevision"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ActivityJobWaiting"
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.getClass
      def codecJson: BaboonJsonCodec[ActivityJobWaiting.BlockedByOlderRevision] = ActivityJobWaiting.BlockedByOlderRevision_JsonCodec.instance
    }
    
    object BlockedByOlderRevision_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ActivityJobWaiting.BlockedByOlderRevision, BaboonJsonCodec[ActivityJobWaiting.BlockedByOlderRevision]] {
      def encode(ctx: BaboonCodecContext, value: ActivityJobWaiting.BlockedByOlderRevision): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          "revision" -> Json.fromInt(value.revision)
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobWaiting.BlockedByOlderRevision] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(jsonObject) => for {
              revision <- getField(jsonObject, "revision").flatMap(v => BaboonJsonCodec.decodeInt(v.hcursor))
            } yield ActivityJobWaiting.BlockedByOlderRevision(revision)
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to BlockedByOlderRevision: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ActivityJobWaiting.BlockedByOlderRevision.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ActivityJobWaiting.BlockedByOlderRevision.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ActivityJobWaiting.BlockedByOlderRevision.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ActivityJobWaiting.BlockedByOlderRevision.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.BlockedByOlderRevision.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.BlockedByOlderRevision]] = Lazy(ActivityJobWaiting.BlockedByOlderRevision_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.BlockedByOlderRevision]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ActivityJobWaiting.BlockedByOlderRevision] = LazyInstance.value
    }
    
    
    final case class AwaitingLargeLane(
      
    ) extends ActivityJobWaiting with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ActivityJobWaiting.AwaitingLargeLane.baboonDomainVersion
      override def baboonDomainIdentifier: String = ActivityJobWaiting.AwaitingLargeLane.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ActivityJobWaiting.AwaitingLargeLane.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ActivityJobWaiting.AwaitingLargeLane.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ActivityJobWaiting.AwaitingLargeLane.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ActivityJobWaiting.AwaitingLargeLane.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ActivityJobWaiting.AwaitingLargeLane.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.AwaitingLargeLane.baboonAdtType
    }
    
    object AwaitingLargeLane {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ActivityJobWaiting]#AwaitingLargeLane"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ActivityJobWaiting"
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.getClass
      def codecJson: BaboonJsonCodec[ActivityJobWaiting.AwaitingLargeLane] = ActivityJobWaiting.AwaitingLargeLane_JsonCodec.instance
    }
    
    object AwaitingLargeLane_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ActivityJobWaiting.AwaitingLargeLane, BaboonJsonCodec[ActivityJobWaiting.AwaitingLargeLane]] {
      def encode(ctx: BaboonCodecContext, value: ActivityJobWaiting.AwaitingLargeLane): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobWaiting.AwaitingLargeLane] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ActivityJobWaiting.AwaitingLargeLane())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to AwaitingLargeLane: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ActivityJobWaiting.AwaitingLargeLane.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ActivityJobWaiting.AwaitingLargeLane.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ActivityJobWaiting.AwaitingLargeLane.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ActivityJobWaiting.AwaitingLargeLane.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.AwaitingLargeLane.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.AwaitingLargeLane]] = Lazy(ActivityJobWaiting.AwaitingLargeLane_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.AwaitingLargeLane]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ActivityJobWaiting.AwaitingLargeLane] = LazyInstance.value
    }
    
    
    final case class AwaitingLargePermit(
      
    ) extends ActivityJobWaiting with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ActivityJobWaiting.AwaitingLargePermit.baboonDomainVersion
      override def baboonDomainIdentifier: String = ActivityJobWaiting.AwaitingLargePermit.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ActivityJobWaiting.AwaitingLargePermit.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ActivityJobWaiting.AwaitingLargePermit.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ActivityJobWaiting.AwaitingLargePermit.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ActivityJobWaiting.AwaitingLargePermit.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ActivityJobWaiting.AwaitingLargePermit.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.AwaitingLargePermit.baboonAdtType
    }
    
    object AwaitingLargePermit {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ActivityJobWaiting]#AwaitingLargePermit"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ActivityJobWaiting"
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.getClass
      def codecJson: BaboonJsonCodec[ActivityJobWaiting.AwaitingLargePermit] = ActivityJobWaiting.AwaitingLargePermit_JsonCodec.instance
    }
    
    object AwaitingLargePermit_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ActivityJobWaiting.AwaitingLargePermit, BaboonJsonCodec[ActivityJobWaiting.AwaitingLargePermit]] {
      def encode(ctx: BaboonCodecContext, value: ActivityJobWaiting.AwaitingLargePermit): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobWaiting.AwaitingLargePermit] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ActivityJobWaiting.AwaitingLargePermit())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to AwaitingLargePermit: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ActivityJobWaiting.AwaitingLargePermit.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ActivityJobWaiting.AwaitingLargePermit.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ActivityJobWaiting.AwaitingLargePermit.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ActivityJobWaiting.AwaitingLargePermit.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.AwaitingLargePermit.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.AwaitingLargePermit]] = Lazy(ActivityJobWaiting.AwaitingLargePermit_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.AwaitingLargePermit]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ActivityJobWaiting.AwaitingLargePermit] = LazyInstance.value
    }
    
    
    final case class ProfileNotRun(
      
    ) extends ActivityJobWaiting with BaboonAdtMemberMeta with BaboonGeneratedLatest {
      override def baboonDomainVersion: String = ActivityJobWaiting.ProfileNotRun.baboonDomainVersion
      override def baboonDomainIdentifier: String = ActivityJobWaiting.ProfileNotRun.baboonDomainIdentifier
      override def baboonTypeIdentifier: String = ActivityJobWaiting.ProfileNotRun.baboonTypeIdentifier
      override def baboonSameInVersions: List[String] = ActivityJobWaiting.ProfileNotRun.baboonSameInVersions
      override def baboonForwardReadable: Map[String, String] = ActivityJobWaiting.ProfileNotRun.baboonForwardReadable
      override def baboonMinReaderVersions: Map[String, String] = ActivityJobWaiting.ProfileNotRun.baboonMinReaderVersions
      override def baboonAdtTypeIdentifier: String = ActivityJobWaiting.ProfileNotRun.baboonAdtTypeIdentifier
      override def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.ProfileNotRun.baboonAdtType
    }
    
    object ProfileNotRun {
      def baboonDomainVersion: String = "1.9.0"
      def baboonDomainIdentifier: String = "chronicle.api"
      def baboonTypeIdentifier: String = "chronicle.api/[chronicle.api/:#ActivityJobWaiting]#ProfileNotRun"
      private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
      def baboonSameInVersions: List[String] = _baboonSameInVersions
      private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
      def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
      private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
      def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
      def baboonAdtTypeIdentifier: String = "chronicle.api/:#ActivityJobWaiting"
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.getClass
      def codecJson: BaboonJsonCodec[ActivityJobWaiting.ProfileNotRun] = ActivityJobWaiting.ProfileNotRun_JsonCodec.instance
    }
    
    object ProfileNotRun_JsonCodec extends BaboonJsonCodec.BaseGeneratedAdt[ActivityJobWaiting.ProfileNotRun, BaboonJsonCodec[ActivityJobWaiting.ProfileNotRun]] {
      def encode(ctx: BaboonCodecContext, value: ActivityJobWaiting.ProfileNotRun): Json = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.encode(ctx, value)
        }
        
        Json.obj(
          
        )
      }
      
      def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobWaiting.ProfileNotRun] = {
        if (this ne LazyInstance.value) {
          return LazyInstance.value.decode(ctx, wire)
        }
        
        wire.asObject match {
          case Some(_) => Right(ActivityJobWaiting.ProfileNotRun())
          case _ => Left(new IllegalArgumentException("Cannot decode $wire to ProfileNotRun: object expected"))
        }
      }
    
      def baboonDomainVersion: String = ActivityJobWaiting.ProfileNotRun.baboonDomainVersion
      
      def baboonDomainIdentifier: String = ActivityJobWaiting.ProfileNotRun.baboonDomainIdentifier
      
      def baboonTypeIdentifier: String = ActivityJobWaiting.ProfileNotRun.baboonTypeIdentifier
      
      def baboonAdtTypeIdentifier: String = ActivityJobWaiting.ProfileNotRun.baboonAdtTypeIdentifier
      
      def baboonAdtType: _root_.java.lang.Class[?] = ActivityJobWaiting.ProfileNotRun.baboonAdtType
    
      private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.ProfileNotRun]] = Lazy(ActivityJobWaiting.ProfileNotRun_JsonCodec)
      override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting.ProfileNotRun]] = cachedLazyInstance
      override def instance: BaboonJsonCodec[ActivityJobWaiting.ProfileNotRun] = LazyInstance.value
    }
    def baboonDomainVersion: String = "1.9.0"
    def baboonDomainIdentifier: String = "chronicle.api"
    def baboonTypeIdentifier: String = "chronicle.api/:#ActivityJobWaiting"
    private lazy val _baboonSameInVersions: List[String] = List("1.9.0")
    def baboonSameInVersions: List[String] = _baboonSameInVersions
    private lazy val _baboonForwardReadable: Map[String, String] = Map("1.9.0" -> "identical")
    def baboonForwardReadable: Map[String, String] = _baboonForwardReadable
    private lazy val _baboonMinReaderVersions: Map[String, String] = Map("json-additive" -> "1.9.0", "prefix-compact" -> "1.9.0", "prefix-any-mode" -> "1.9.0", "identical" -> "1.9.0")
    def baboonMinReaderVersions: Map[String, String] = _baboonMinReaderVersions
    def codecJson: BaboonJsonCodec[ActivityJobWaiting] = ActivityJobWaiting_JsonCodec.instance
  }
  
  object ActivityJobWaiting_JsonCodec extends BaboonJsonCodec.BaseGenerated[ActivityJobWaiting, BaboonJsonCodec[ActivityJobWaiting]] {
    def encode(ctx: BaboonCodecContext, value: ActivityJobWaiting): Json = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.encode(ctx, value)
      }
      
      value match {
        case queued: ActivityJobWaiting.Queued => Json.obj("Queued" -> ActivityJobWaiting.Queued_JsonCodec.instance.encode(ctx, queued))
        
        case indexingoff: ActivityJobWaiting.IndexingOff => Json.obj("IndexingOff" -> ActivityJobWaiting.IndexingOff_JsonCodec.instance.encode(ctx, indexingoff))
        
        case awaitingreclaim: ActivityJobWaiting.AwaitingReclaim => Json.obj("AwaitingReclaim" -> ActivityJobWaiting.AwaitingReclaim_JsonCodec.instance.encode(ctx, awaitingreclaim))
        
        case leaseexpiredawaitingreclaim: ActivityJobWaiting.LeaseExpiredAwaitingReclaim => Json.obj("LeaseExpiredAwaitingReclaim" -> ActivityJobWaiting.LeaseExpiredAwaitingReclaim_JsonCodec.instance.encode(ctx, leaseexpiredawaitingreclaim))
        
        case leaseexhaustedpending: ActivityJobWaiting.LeaseExhaustedPending => Json.obj("LeaseExhaustedPending" -> ActivityJobWaiting.LeaseExhaustedPending_JsonCodec.instance.encode(ctx, leaseexhaustedpending))
        
        case runningwithoutlease: ActivityJobWaiting.RunningWithoutLease => Json.obj("RunningWithoutLease" -> ActivityJobWaiting.RunningWithoutLease_JsonCodec.instance.encode(ctx, runningwithoutlease))
        
        case held: ActivityJobWaiting.Held => Json.obj("Held" -> ActivityJobWaiting.Held_JsonCodec.instance.encode(ctx, held))
        
        case blockedbyolderrevision: ActivityJobWaiting.BlockedByOlderRevision => Json.obj("BlockedByOlderRevision" -> ActivityJobWaiting.BlockedByOlderRevision_JsonCodec.instance.encode(ctx, blockedbyolderrevision))
        
        case awaitinglargelane: ActivityJobWaiting.AwaitingLargeLane => Json.obj("AwaitingLargeLane" -> ActivityJobWaiting.AwaitingLargeLane_JsonCodec.instance.encode(ctx, awaitinglargelane))
        
        case awaitinglargepermit: ActivityJobWaiting.AwaitingLargePermit => Json.obj("AwaitingLargePermit" -> ActivityJobWaiting.AwaitingLargePermit_JsonCodec.instance.encode(ctx, awaitinglargepermit))
        
        case profilenotrun: ActivityJobWaiting.ProfileNotRun => Json.obj("ProfileNotRun" -> ActivityJobWaiting.ProfileNotRun_JsonCodec.instance.encode(ctx, profilenotrun))
      
        case _ => throw new IllegalArgumentException(s"Cannot encode $value: unexpected subclass")
      }
    }
    
    def decode(ctx: BaboonCodecContext, wire: Json): Either[Throwable, ActivityJobWaiting] = {
      if (this ne LazyInstance.value) {
        return LazyInstance.value.decode(ctx, wire)
      }
      
      wire.asObject match {
        case Some(jsonObject) =>
          jsonObject.toList.headOption match {
            case Some((key, json)) =>
              key match {
                case "Queued" =>
                  ActivityJobWaiting.Queued_JsonCodec.instance.decode(ctx, json)
                
                case "IndexingOff" =>
                  ActivityJobWaiting.IndexingOff_JsonCodec.instance.decode(ctx, json)
                
                case "AwaitingReclaim" =>
                  ActivityJobWaiting.AwaitingReclaim_JsonCodec.instance.decode(ctx, json)
                
                case "LeaseExpiredAwaitingReclaim" =>
                  ActivityJobWaiting.LeaseExpiredAwaitingReclaim_JsonCodec.instance.decode(ctx, json)
                
                case "LeaseExhaustedPending" =>
                  ActivityJobWaiting.LeaseExhaustedPending_JsonCodec.instance.decode(ctx, json)
                
                case "RunningWithoutLease" =>
                  ActivityJobWaiting.RunningWithoutLease_JsonCodec.instance.decode(ctx, json)
                
                case "Held" =>
                  ActivityJobWaiting.Held_JsonCodec.instance.decode(ctx, json)
                
                case "BlockedByOlderRevision" =>
                  ActivityJobWaiting.BlockedByOlderRevision_JsonCodec.instance.decode(ctx, json)
                
                case "AwaitingLargeLane" =>
                  ActivityJobWaiting.AwaitingLargeLane_JsonCodec.instance.decode(ctx, json)
                
                case "AwaitingLargePermit" =>
                  ActivityJobWaiting.AwaitingLargePermit_JsonCodec.instance.decode(ctx, json)
                
                case "ProfileNotRun" =>
                  ActivityJobWaiting.ProfileNotRun_JsonCodec.instance.decode(ctx, json)
      
                case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityJobWaiting: no matching value"))
              }
            case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityJobWaiting: empty json object"))
          }
        case _ => Left(new IllegalArgumentException(s"Cannot decode $wire to ActivityJobWaiting: object expected"))
      }
    }
  
    def baboonDomainVersion: String = ActivityJobWaiting.baboonDomainVersion
    
    def baboonDomainIdentifier: String = ActivityJobWaiting.baboonDomainIdentifier
    
    def baboonTypeIdentifier: String = ActivityJobWaiting.baboonTypeIdentifier
  
    private lazy val cachedLazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting]] = Lazy(ActivityJobWaiting_JsonCodec)
    override protected def LazyInstance: Lazy[BaboonJsonCodec[ActivityJobWaiting]] = cachedLazyInstance
    override def instance: BaboonJsonCodec[ActivityJobWaiting] = LazyInstance.value
  }
}