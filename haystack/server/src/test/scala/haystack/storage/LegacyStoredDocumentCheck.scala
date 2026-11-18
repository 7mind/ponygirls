package haystack.storage

import haystack.domain.{DocumentCodec, Fault, QualifiedId}
import ponygirls.losslessjson.LosslessJson
import java.nio.ByteBuffer
import java.nio.charset.{CodingErrorAction, StandardCharsets}
import java.nio.file.{Files, Path}
import java.util.HexFormat
import scala.util.Try

/** One-off (deleted with the legacy code): decides with the REAL codec whether any stored Haystack document still
  * needs the wide stored-read tolerance. SQL cannot decide this: link targets go through `QualifiedId.decodeKey`
  * (canonical percent-encoding, UTF-8 validity, NUL, component limits) and the envelope through `LosslessJson`.
  *
  * Input: the file written by `run.sh haystack export-stored-documents` (hex of every `document_text`, the column the
  * repository decodes). Output: counts only. Run through `scripts/one-off/legacy-retirement/check-stored-documents.sh`.
  */
object LegacyStoredDocumentCheck {
  enum Verdict { case StrictOk, NeedsWideEnvelope, NeedsRelaxedLinks, Unreadable }
  final case class Report(items: Long, revisions: Long, declaredItems: Option[Long], declaredRevisions: Option[Long], verdicts: Map[Verdict, Long]) {
    def of(verdict: Verdict): Long = verdicts.getOrElse(verdict, 0L)
    def complete: Boolean = declaredItems.contains(items) && declaredRevisions.contains(revisions)
    /** Every stored text decodes on the path the product keeps once the tolerance is removed. */
    def strict: Boolean = complete && of(Verdict.StrictOk) == items + revisions
  }

  /** `DocumentCodec.decodeStored` today is `LosslessJson.parse(text, StoredLimits)` + shape validation without the
    * link-key check. Without the tolerance it is `LosslessJson.parse(text, Limits)` + the same shape validation with
    * `QualifiedId.decodeKey` on every link target (`DocumentCodec.scala:39-43,71-87`). The two parses yield the same
    * value when both accept, so the future path accepts exactly when all three conditions below hold. No new-write
    * admission (`DocumentCodec.validate`, `PostgresAdmission`) is applied: stored reads never apply it.
    */
  def classify(text: String): Verdict =
    Try(DocumentCodec.decodeStored(text)).toOption match {
      case None => Verdict.Unreadable // the current service cannot read it either: a fault, not a tolerance
      case Some(document) =>
        if (LosslessJson.parse(text, DocumentCodec.Limits).isLeft) Verdict.NeedsWideEnvelope
        else if (document.links.exists { case (_, target) => Try(QualifiedId.decodeKey(target)).isFailure }) Verdict.NeedsRelaxedLinks
        else Verdict.StrictOk
    }

  private def utf8(hex: String): String =
    StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
      .decode(ByteBuffer.wrap(HexFormat.of().parseHex(hex))).toString

  def check(exported: Path): Report = {
    var items = 0L; var revisions = 0L; var declared = Option.empty[(Long, Long)]
    val verdicts = scala.collection.mutable.Map.empty[Verdict, Long]
    val reader = Files.newBufferedReader(exported, StandardCharsets.US_ASCII)
    try {
      var line = reader.readLine()
      while (line != null) {
        line.split('|') match {
          case Array("D", table, _, hex) =>
            table match {
              case "items" => items += 1
              case "item_revisions" => revisions += 1
              case _ => throw new IllegalStateException("unexpected table in the export")
            }
            val verdict = classify(utf8(hex))
            verdicts.update(verdict, verdicts.getOrElse(verdict, 0L) + 1)
          case Array("LR.export.complete", i, r) => declared = Some((i.toLong, r.toLong))
          case Array(key, _*) if key.startsWith("LR.") => ()
          case _ if line.isEmpty => ()
          case _ => throw new IllegalStateException("unexpected line in the export")
        }
        line = reader.readLine()
      }
    } finally reader.close()
    Report(items, revisions, declared.map(_._1), declared.map(_._2), verdicts.toMap)
  }

  def lines(report: Report): Vector[String] = Vector(
    s"LR.stored.items|${report.items}", s"LR.stored.item_revisions|${report.revisions}",
    s"LR.stored.export_complete|${report.complete}",
    s"LR.stored.strict_ok|${report.of(Verdict.StrictOk)}",
    s"LR.stored.needs_wide_envelope|${report.of(Verdict.NeedsWideEnvelope)}",
    s"LR.stored.needs_relaxed_links|${report.of(Verdict.NeedsRelaxedLinks)}",
    s"LR.stored.unreadable_today|${report.of(Verdict.Unreadable)}",
    if (report.strict) "LR.result|stored-documents-strict-ok" else "LR.result|stored-documents-need-tolerance")

  def main(arguments: Array[String]): Unit = {
    if (arguments.length != 1) throw new IllegalArgumentException("usage: LegacyStoredDocumentCheck EXPORT_FILE")
    val report = check(Path.of(arguments(0)))
    lines(report).foreach(println)
    if (!report.strict) throw new IllegalStateException("stored documents still need the wide stored-read tolerance, or the export is incomplete")
  }
}
