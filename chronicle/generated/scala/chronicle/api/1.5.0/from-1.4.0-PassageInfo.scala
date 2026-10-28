import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__PassageInfo__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.PassageInfo, PassageInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.PassageInfo
      ): PassageInfo = {
        val id: UUID = _from.id
        val ordinal: Int = _from.ordinal
        val summary: String = _from.summary
        val tags: List[String] = _from.tags.map(e1 => e1).toList
        val start: PassagePoint = conversions.convertWithContext[C, chronicle.api.v1_4_0.PassagePoint, PassagePoint](context, _from.start)
        val `end`: PassagePoint = conversions.convertWithContext[C, chronicle.api.v1_4_0.PassagePoint, PassagePoint](context, _from.`end`)
        val sourcebytes: Long = _from.sourceBytes
        val spancount: Long = _from.spanCount
        val piececount: Long = _from.pieceCount
        PassageInfo(
                id,
                ordinal,
                summary,
                tags,
                start,
                `end`,
                sourcebytes,
                spancount,
                piececount
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#PassageInfo"
  }
}