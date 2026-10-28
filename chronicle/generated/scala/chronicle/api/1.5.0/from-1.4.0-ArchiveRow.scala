import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ArchiveRow__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.ArchiveRow, ArchiveRow] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.ArchiveRow
      ): ArchiveRow = {
        val head: SessionInfo = conversions.convertWithContext[C, chronicle.api.v1_4_0.SessionInfo, SessionInfo](context, _from.head)
        val publishedview: Option[ContentView] = _from.publishedView.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_4_0.ContentView, ContentView](context, e1))
        val matchedview: Option[ContentView] = _from.matchedView.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_4_0.ContentView, ContentView](context, e1))
        val lasttimestamp: Option[String] = _from.lastTimestamp.map(e1 => e1)
        val messagecount: Int = _from.messageCount
        val tags: List[String] = _from.tags.map(e1 => e1).toList
        val headjob: Option[JobInfo] = _from.headJob.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_4_0.JobInfo, JobInfo](context, e1))
        val publishedformat: Option[PassageFormat] = Option.empty[PassageFormat]
        ArchiveRow(
                head,
                publishedview,
                matchedview,
                lasttimestamp,
                messagecount,
                tags,
                headjob,
                publishedformat
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#ArchiveRow"
  }
}