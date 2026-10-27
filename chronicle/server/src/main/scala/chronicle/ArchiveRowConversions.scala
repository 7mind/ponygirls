package chronicle.protocol

import chronicle.api
import chronicle.api.{v1_4_0 as v14}
import baboon.runtime.shared.{AbstractBaboonConversions,AbstractConversion}

final class ArchiveRowToV14 extends AbstractConversion[api.ArchiveRow,v14.ArchiveRow] {
  def versionFrom="1.5.0"; def versionTo="1.4.0"; def typeId="chronicle.api/:#ArchiveRow"
  def doConvert[C](context: Option[C],conversions: AbstractBaboonConversions,from: api.ArchiveRow): v14.ArchiveRow =
    v14.ArchiveRow(conversions.convertWithContext[C,api.SessionInfo,v14.SessionInfo](context,from.head),
      from.publishedView.map(value => conversions.convertWithContext[C,api.ContentView,v14.ContentView](context,value)),
      from.matchedView.map(value => conversions.convertWithContext[C,api.ContentView,v14.ContentView](context,value)),
      from.lastTimestamp,from.messageCount,from.tags,
      from.headJob.map(value => conversions.convertWithContext[C,api.JobInfo,v14.JobInfo](context,value)))
}
