package chronicle

import chronicle.api.PassageFormat
import java.sql.Connection
import java.util.UUID

/** The rows a generation holds (migration 028, ingest-limits spec §5.6.2). Rows are labeled with the generation that
  * wrote them (their origin). A lineage generation at version v holds, per kind, the rows of each segment's origin inside
  * its range, for every segment row valid at v (since <= v < until); a generation without a version holds its own rows:
  * one without a lineage (an earlier release's), and a root that a release before 028 published (it resumed the root's
  * staged publication and switched to it without activating its segments). Ordinals are dense within what a generation
  * holds, so pages are ordinal ranges. */
private[chronicle] object GenerationRows {
  /** The stored format of a lineage generation of version 1 or more (staged or published). Readers answer it as
    * ContextAwareProblems; a release before 028 re-creates its passage_format check at start, which rejects it, and so
    * refuses to start, and its readers refuse it as not in the current format. */
  val lineageFormat = "ContextAwareProblemsLineage"
  /** The stored formats of current publications. */
  val formats: List[String] = List(PassageFormat.ContextAwareProblems.toString,lineageFormat)
  val formatsSql: String = formats.map(value => s"'$value'").mkString("(",",",")")
  enum Kind(val sql: String) {
    case Piece extends Kind("piece")
    case Passage extends Kind("passage")
    /** Ranges by (passage ordinal, span ordinal): `*_major` is the passage ordinal. */
    case Span extends Kind("span")
    case Context extends Kind("context")
  }
  /** The open end of a range: a root's segments and a generation without a lineage hold all their rows. */
  val openMajor: Int = Int.MaxValue
  val openEnd: Long = Long.MaxValue
  /** The ranges of `kind` the generation `generation` (an SQL expression: by default one parameter) holds: rows
    * (origin, lo_major, lo, hi_major, hi); `(self, all)` for a generation without a version. */
  def members(kind: Kind,generation: String="?"): String =
    s"""SELECT coalesce(held_m.origin,held_g.id) AS origin,coalesce(held_m.lo_major,0) AS lo_major,coalesce(held_m.lo,0) AS lo,coalesce(held_m.hi_major,$openMajor) AS hi_major,coalesce(held_m.hi,$openEnd) AS hi
      FROM ch_generations held_g LEFT JOIN ch_lineage_segments held_m ON held_g.lineage_version IS NOT NULL AND held_m.lineage=held_g.lineage AND held_m.kind='${kind.sql}'
        AND held_m.since<=held_g.lineage_version AND (held_m.until IS NULL OR held_m.until>held_g.lineage_version)
      WHERE held_g.id=$generation AND (held_g.lineage_version IS NULL OR held_m.origin IS NOT NULL)"""
  /** Whether the search row `row` (an alias with generation and ordinal) is a piece of the generation whose id, lineage
    * and version are the SQL expressions given: its own row, or a row of an origin inside a piece segment valid at the
    * version. Evaluated per index tuple inside the ANN scan, as one index probe. A scalar subquery, not EXISTS: written as
    * EXISTS inside the OR, PostgreSQL 18 planned it as a hashed ANY probing by origin alone (spec §5.6.2, E7). */
  def piece(id: String,lineage: String,version: String,row: String): String =
    s"($id=$row.generation OR (SELECT true FROM ch_lineage_segments held_m WHERE held_m.lineage=$lineage AND held_m.origin=$row.generation AND held_m.since<=$version AND (held_m.until IS NULL OR held_m.until>$version) AND held_m.kind='piece' AND $row.ordinal>=held_m.lo AND $row.ordinal<held_m.hi LIMIT 1))"
  /** The published revision's ch_revision_info `metadata` for the search row `row` (an alias with generation, revision
    * and ordinal) of the source whose id and published generation are the SQL expressions given, if the row is a piece of
    * that generation, else no row. A row of the published generation itself is of its revision and reads neither the
    * generation's row nor the segments (one probe per index tuple, as before 028); a row of an earlier origin reads the
    * generation's revision, lineage and version and probes the segments as `piece`. */
  def publishedInfo(source: String,published: String,row: String): String =
    s"SELECT own.metadata FROM ch_revision_info own WHERE $published=$row.generation AND own.session_id=$source AND own.revision=$row.revision UNION ALL SELECT held.metadata FROM ch_generations p JOIN ch_revision_info held ON held.session_id=$source AND held.revision=p.revision WHERE p.id=$published AND $published<>$row.generation AND ${piece(published,"p.lineage","p.lineage_version",row)}"
  /** The generated tags (column `tag`) of the published generation whose id, lineage and version are the SQL expressions
    * given: its lineage's tag set, or the own tags of a generation without a version. */
  def tags(id: String,lineage: String,version: String): String =
    s"(SELECT held_t.tag FROM ch_lineage_tags held_t WHERE held_t.lineage=$lineage AND $version IS NOT NULL UNION ALL SELECT held_t.tag FROM ch_generation_tags held_t WHERE held_t.generation=$id AND $version IS NULL)"
  /** The generation's pieces: the count its publication recorded, or the own chunks of a generation without one. */
  def pieceCount(c: Connection,generation: UUID): Int =
    Sql.one(c,"SELECT pieces FROM ch_generation_lineage WHERE generation=?",generation)(_.getLong(1)).map(Math.toIntExact)
      .getOrElse(Sql.one(c,"SELECT count(*) FROM ch_chunks WHERE generation=?",generation)(_.getInt(1)).get)
  /** The page of the generation's chunks with ordinals in [offset, offset+limit), in ordinal order. */
  def chunks(generation: UUID,offset: Int,limit: Int): ReadSources.Query =
    ReadSources.Query(s"SELECT ch.value FROM (${members(Kind.Piece)}) m JOIN ch_chunks ch ON ch.generation=m.origin AND ch.ordinal>=greatest(m.lo,?) AND ch.ordinal<least(m.hi,?) ORDER BY ch.ordinal,ch.id LIMIT ?",
      List(generation,offset.toLong,offset.toLong+limit,limit))
  /** The chunk `id` if the generation holds it. */
  def chunk(generation: UUID,id: UUID): ReadSources.Query =
    ReadSources.Query(s"SELECT ch.value FROM (${members(Kind.Piece)}) m JOIN ch_chunks ch ON ch.generation=m.origin AND ch.ordinal>=m.lo AND ch.ordinal<m.hi WHERE ch.id=?",List(generation,id))
}
