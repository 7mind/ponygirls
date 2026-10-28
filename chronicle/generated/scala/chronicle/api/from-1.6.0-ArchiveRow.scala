import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ArchiveRow__From__1_6_0
    extends AbstractConversion[v1_6_0.ArchiveRow, ArchiveRow] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.ArchiveRow
      ): ArchiveRow = {
        val head: SessionInfo = conversions.convertWithContext[C, v1_6_0.SessionInfo, SessionInfo](context, _from.head)
        val publishedview: Option[ContentView] = _from.publishedView.map(e1 => conversions.convertWithContext[C, v1_6_0.ContentView, ContentView](context, e1))
        val matchedview: Option[ContentView] = _from.matchedView.map(e1 => conversions.convertWithContext[C, v1_6_0.ContentView, ContentView](context, e1))
        val lasttimestamp: Option[String] = _from.lastTimestamp.map(e1 => e1)
        val messagecount: Int = _from.messageCount
        val tags: List[String] = _from.tags.map(e1 => e1).toList
        val headjob: Option[JobInfo] = _from.headJob.map(e1 => conversions.convertWithContext[C, v1_6_0.JobInfo, JobInfo](context, e1))
        val publishedformat: Option[PassageFormat] = _from.publishedFormat.map(e1 => conversions.convertWithContext[C, v1_6_0.PassageFormat, PassageFormat](context, e1))
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
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#ArchiveRow"
  }
}