import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__CollectorProgressUpdate__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.CollectorProgressUpdate, CollectorProgressUpdate] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.CollectorProgressUpdate
      ): CollectorProgressUpdate = {
        val collectorid: String = _from.collectorId
        val sequence: Long = _from.sequence
        val runid: UUID = _from.runId
        val phase: CollectorPhase = conversions.convertWithContext[C, chronicle.api.v1_5_0.CollectorPhase, CollectorPhase](context, _from.phase)
        val startedat: String = _from.startedAt
        val counters: CollectorCounters = conversions.convertWithContext[C, chronicle.api.v1_5_0.CollectorCounters, CollectorCounters](context, _from.counters)
        val totaluploadbytes: Long = _from.totalUploadBytes
        val uploadedbytes: Long = _from.uploadedBytes
        val currentuploadtotalbytes: Option[Long] = _from.currentUploadTotalBytes.map(e1 => e1)
        val error: Option[String] = _from.error.map(e1 => e1)
        CollectorProgressUpdate(
                collectorid,
                sequence,
                runid,
                phase,
                startedat,
                counters,
                totaluploadbytes,
                uploadedbytes,
                currentuploadtotalbytes,
                error
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/:#CollectorProgressUpdate"
  }
}