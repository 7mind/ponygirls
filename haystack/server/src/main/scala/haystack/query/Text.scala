package haystack.query

import java.text.Normalizer
import java.util.Locale
import ponygirls.losslessjson.LosslessJson as J

object Text {
  // ROOT is required: the process's default locale is not part of the contract.
  def normalizeWordRun(text: String): String = Normalizer.normalize(text, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT)
  private val wordPattern = "[\\p{L}\\p{N}\\p{M}]+".r
  def extractWords(text: String): Vector[String] = wordPattern.findAllIn(normalizeWordRun(text)).toVector
  def words(text: String): Vector[String] = extractWords(text)
  def corpusSegments(doc: haystack.domain.ItemDocument): Vector[String] =
    corpusSegmentStrings(doc.title, doc.description, doc.fields, doc.tags)
  def corpusSegments(title: String, description: String, fields: J.Value, tags: Vector[String] = Vector.empty): Vector[Vector[String]] = {
    val out = Vector.newBuilder[Vector[String]]
    def push(s: String): Unit = { val w = extractWords(s); if (w.nonEmpty) out += w }
    def walk(v: J.Value): Unit = v match {
      case s: J.Str => push(s.value)
      case a: J.Arr => a.values.foreach(walk)
      case o: J.Obj => o.fields.foreach(x => walk(x._2))
      case _ => ()
    }
    push(title); push(description); tags.foreach(push); walk(fields)
    out.result()
  }
  def corpusWords(title: String, description: String, fields: J.Value, tags: Vector[String] = Vector.empty): Vector[String] =
    corpusSegments(title, description, fields, tags).flatten
  def corpusSegmentStrings(title: String, description: String, fields: J.Value, tags: Vector[String] = Vector.empty): Vector[String] =
    corpusSegments(title, description, fields, tags).map(_.mkString(" "))
}
object Pointer {
  def splitPointer(pointer: String): Vector[String] = {
    require(pointer.isEmpty || pointer.startsWith("/"), "pointer must be empty or start with /")
    if (pointer.isEmpty) Vector.empty else pointer.substring(1).split("/", -1).toVector.map(_.replace("~1", "/").replace("~0", "~"))
  }
  /** None is missing; Some(Null) is a present JSON null. */
  def resolvePointer(fields: J.Value, pointer: String): Option[J.Value] =
    splitPointer(pointer).foldLeft(Option(fields)) { (node, segment) => node.flatMap {
      case o: J.Obj => o.fields.find(_._1 == segment).map(_._2)
      case a: J.Arr if segment.matches("0|[1-9][0-9]*") =>
        // Length gate avoids overflow and exponent/integer-sized allocations.
        if (segment.length > 10) None else segment.toLongOption.filter(_ < a.values.length).map(i => a.values(i.toInt))
      case _ => None
    }}
}
