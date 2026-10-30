package chronicle.protocol

import chronicle.api as api
import chronicle.api.v1_7_0 as v17
import baboon.runtime.shared.{AbstractBaboonConversions,AbstractConversion}

final class Convert__ArchiveQuery__From__1_7_0 extends api.Convert__ArchiveQuery__From__1_7_0 {
  def doConvert[C](context: Option[C],conversions: AbstractBaboonConversions,from: v17.ArchiveQuery): api.ArchiveQuery =
    api.ArchiveQuery(from.expression,
      conversions.convertWithContext[C,v17.ArchiveSort,api.ArchiveSort](context,from.sort),
      conversions.convertWithContext[C,v17.SortDirection,api.SortDirection](context,from.direction),
      from.cursor,from.limit,false)
}
final class Convert__ArchiveResult__From__1_7_0 extends api.Convert__ArchiveResult__From__1_7_0 {
  def doConvert[C](context: Option[C],conversions: AbstractBaboonConversions,from: v17.ArchiveResult): api.ArchiveResult =
    api.ArchiveResult(from.rows.map(value => conversions.convertWithContext[C,v17.ArchiveRow,api.ArchiveRow](context,value)),
      from.total,from.nextCursor,
      conversions.convertWithContext[C,v17.ArchiveTextScope,api.ArchiveTextScope](context,from.textScope),
      from.annChunkLimitPerOperand,false)
}
final class ArchiveResultToV17 extends AbstractConversion[api.ArchiveResult,v17.ArchiveResult] {
  def versionFrom="1.8.0"; def versionTo="1.7.0"; def typeId="chronicle.api/:#ArchiveResult"
  def doConvert[C](context: Option[C],conversions: AbstractBaboonConversions,from: api.ArchiveResult): v17.ArchiveResult = {
    chronicle.Check(!from.relevanceOrdered,"version-mismatch","relevance-ordered archive results require API1.8")
    v17.ArchiveResult(from.rows.map(value => conversions.convertWithContext[C,api.ArchiveRow,v17.ArchiveRow](context,value)),
      from.total,from.nextCursor,
      conversions.convertWithContext[C,api.ArchiveTextScope,v17.ArchiveTextScope](context,from.textScope),
      from.annChunkLimitPerOperand)
  }
}
