import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ArchiveResult__From__1_4_0
    extends AbstractConversion[v1_4_0.ArchiveResult, ArchiveResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.ArchiveResult
      ): ArchiveResult = {
        val rows: List[ArchiveRow] = _from.rows.map(e1 => conversions.convertWithContext[C, v1_4_0.ArchiveRow, ArchiveRow](context, e1)).toList
        val total: Long = _from.total
        val nextcursor: Option[String] = _from.nextCursor.map(e1 => e1)
        val textscope: ArchiveTextScope = conversions.convertWithContext[C, v1_4_0.ArchiveTextScope, ArchiveTextScope](context, _from.textScope)
        val annchunklimitperoperand: Option[Int] = _from.annChunkLimitPerOperand.map(e1 => e1)
        ArchiveResult(
                rows,
                total,
                nextcursor,
                textscope,
                annchunklimitperoperand
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#ArchiveResult"
  }
}