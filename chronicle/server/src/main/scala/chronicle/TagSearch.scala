package chronicle

import chronicle.api.SearchFilter
import java.nio.charset.StandardCharsets.UTF_8

final case class TagSearchQuery(query: String,filter: SearchFilter,afterTag: Option[String],limit: Int)

private[chronicle] object TagSearchPolicy {
  val maximumQueryUnits=2048
  val maximumValues=100
  private def structured(value: String): Unit =
    Check(!value.contains('\u0000') && UTF_8.newEncoder().canEncode(value),"invalid","invalid tag search text")

  def validate(q: TagSearchQuery): Unit = {
    Check(q.limit>=1 && q.limit<=maximumValues,"invalid","invalid tag search limit")
    Check(q.query.length<=maximumQueryUnits,"invalid","tag query too long")
    structured(q.query)
    q.afterTag.foreach(structured)
    (q.filter.project.toList++q.filter.gitBranch++q.filter.after++q.filter.before++q.filter.tags).foreach(structured)
  }

  def count(value: Long): Int = {
    Check(value>=0 && value<=Int.MaxValue,"projection","invalid tag count")
    value.toInt
  }
}
