import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__CollectorCounters__From__1_7_0
    extends AbstractConversion[v1_7_0.CollectorCounters, CollectorCounters] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.CollectorCounters
      ): CollectorCounters = {
        val discovered: Int = _from.discovered
        val scanned: Int = _from.scanned
        val waiting: Int = _from.waiting
        val excluded: Int = _from.excluded
        val unchanged: Int = _from.unchanged
        val enqueued: Int = _from.enqueued
        val uploaded: Int = _from.uploaded
        val uploadfailures: Int = _from.uploadFailures
        val quarantined: Int = _from.quarantined
        val pending: Int = _from.pending
        val stopped: Int = _from.stopped
        val conflicts: Int = _from.conflicts
        val scannedbytes: Long = _from.scannedBytes
        CollectorCounters(
                discovered,
                scanned,
                waiting,
                excluded,
                unchanged,
                enqueued,
                uploaded,
                uploadfailures,
                quarantined,
                pending,
                stopped,
                conflicts,
                scannedbytes
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/:#CollectorCounters"
  }
}