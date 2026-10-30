package chronicle.protocol

import chronicle.api.v1_5_0 as api
import chronicle.api.{v1_4_0 as v14,v1_6_0 as v16,v1_7_0 as v17}
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

/** Unsupported optional provenance stays unknown; never relabel a context-aware generation as Legacy/P1. */
final class ArchiveRowToV16 extends AbstractConversion[v17.ArchiveRow,v16.ArchiveRow] {
  def versionFrom="1.7.0"; def versionTo="1.6.0"; def typeId="chronicle.api/:#ArchiveRow"
  def doConvert[C](context: Option[C],conversions: AbstractBaboonConversions,from: v17.ArchiveRow): v16.ArchiveRow =
    v16.ArchiveRow(conversions.convertWithContext[C,v17.SessionInfo,v16.SessionInfo](context,from.head),
      from.publishedView.map(value => conversions.convertWithContext[C,v17.ContentView,v16.ContentView](context,value)),
      from.matchedView.map(value => conversions.convertWithContext[C,v17.ContentView,v16.ContentView](context,value)),
      from.lastTimestamp,from.messageCount,from.tags,
      from.headJob.map(value => conversions.convertWithContext[C,v17.JobInfo,v16.JobInfo](context,value)),
      from.publishedFormat.flatMap {
        case v17.PassageFormat.ContextAwareProblems => None
        case value => Some(conversions.convertWithContext[C,v17.PassageFormat,v16.PassageFormat](context,value))
      })
}
