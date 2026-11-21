package chronicle

import chronicle.api.*
import java.util.UUID
import scala.concurrent.duration.*

/** An archive search's literal witnesses read the head epoch's messages the page query names as the literal's first
  * trigram candidates, and answer what a scan of the head's messages answers (ingest-c L3). */
class ArchiveLiteralWitnessTest extends munit.FunSuite {
  override val munitTimeout=2.minutes
  private val messages=2000
  private val rare="quokka zephyr"
  private val triple="umbra vortex"
  /** One more folded scalar than fragments overlap: its occurrences are not bounded by one fragment. */
  private val long="longword "+"y"*(ArchiveProjection.overlapScalars+1-"longword ".length)
  private final case class Shared(config: Config,db: Database,archive: PostgresArchive,index: PostgresArchiveIndex,epoch: UUID,legacy: UUID)
  private var opened=Option.empty[Database]
  private lazy val shared: Shared = {
    val config=Fixtures.config(); val db=Fixtures.database(config,IndexProfileCatalog.current(config)); opened=Some(db); db.initialize()
    db.transaction { c =>
      Sql.exec(c,"TRUNCATE ch_epochs,ch_sources,ch_revisions,ch_ingest_receipts,ch_jobs,ch_generations,ch_chunks CASCADE")
      Sql.exec(c,"UPDATE ch_owner_targets SET profile=?,epoch=0",config.profile)
    }
    val archive=new PostgresArchive(db,config)
    val texts=List.tabulate(messages) { position =>
      val needles=(if(position==messages-1) List(rare) else Nil)++(if(Set(10,20,messages-1)(position)) List(triple) else Nil)++(if(position==30) List(long) else Nil)
      (s"message $position of a long session"::needles).mkString(" ")
    }
    val epoch=archive.ingest("a",snapshot(texts)).sessionId
    val legacy=new PostgresArchive(db,config,RevisionLayoutPolicy.Legacy).ingest("a",snapshot(List(s"legacy $triple note",s"second $triple"))).sessionId
    db.transaction { c =>
      assert(RevisionContent.resolve(c,epoch,1).exists(_.isInstanceOf[RevisionContent.Epoch]))
      assert(RevisionContent.resolve(c,legacy,1).exists(_.isInstanceOf[RevisionContent.Legacy]))
    }
    Shared(config,db,archive,new PostgresArchiveIndex(db,archive,config),epoch,legacy)
  }
  override def afterAll(): Unit = opened.foreach(_.close())
  private def database(run: Shared => Unit): Unit = {
    if(!sys.env.contains("CHRONICLE_TEST_JDBC")) { Check(!sys.env.contains("CHRONICLE_REQUIRE_POSTGRES"),"test","PostgreSQL required"); assume(false,"PostgreSQL explicitly skipped: use scripts/test-postgres.sh") }
    run(shared)
  }
  private def snapshot(texts: List[String]): IngestRequest = {
    val messages=texts.zipWithIndex.map((text,index) => Message(s"m$index",None,"user",text,Some("2026-01-01T00:00:00Z"),index))
    val raw=messages.map(message => s"{\"id\":\"${message.id}\"}\n").mkString
    Fixtures.snapshot().copy(messages=messages,files=List(RawFile("session.jsonl",Wire.hash(raw),raw)),digest=Wire.hash(raw))
  }
  private def query(parsed: ParsedArchiveExpression): ArchiveQuery = ArchiveQuery(parsed.textOperands.mkString(" "),ArchiveSort.LastTimestamp,SortDirection.Desc,None,ArchiveSearchPolicy.maximumPageSize,false)
  private def lexical(operands: String*): ParsedArchiveExpression = ArchiveExpression.parse("mode:lexical "+operands.map(operand => s"\"$operand\"").mkString("("," OR ",")"))

  test("a rare literal's witness reads only its candidate messages") { database { s =>
    val parsed=lexical(rare)
    val plan=s.db.transaction { c =>
      val row=s.index.execute(c,"a",query(parsed),parsed,Nil,Some(ReadMaterialization.unrestricted))._2 match {
        case List(row) => row
        case rows => fail(s"expected the epoch session alone, got $rows")
      }
      val content=RevisionContent.resolve(c,row.value.head.id,row.value.head.revision).get
      val selection=ArchiveSearchWitnesses.literalSelection(content,List(rare),ArchiveSearchPolicy.maximumMatches,row.literalPositions)
      Sql.rows(c,"EXPLAIN (ANALYZE,BUFFERS) "+selection.query.sql,selection.query.args*)(_.getString(1))
    }
    // A plan node and its detail lines, up to the next node.
    val nodes=plan.foldLeft(List.empty[List[String]]) { (nodes,line) =>
      if(nodes.isEmpty || line.trim.startsWith("->")) List(line)::nodes else (nodes.head:+line)::nodes.tail
    }.reverse
    val read=nodes.filter(_.head.contains(" on ch_epoch_messages"))
    val text=plan.mkString("\n")
    println("ARCHIVE LITERAL WITNESS PLAN\n"+text)
    assert(read.nonEmpty,text)
    read.foreach { node =>
      val rows=raw"actual time=\S+ rows=([0-9.]+) loops=([0-9]+)".r.findFirstMatchIn(node.head).map(m => m.group(1).toDouble*m.group(2).toInt).getOrElse(fail(text))
      val removed=node.tail.flatMap(raw"Rows Removed by Filter: ([0-9.]+)".r.findFirstMatchIn(_)).map(_.group(1).toDouble).sum
      assert(rows<=ArchiveSearchPolicy.maximumMatches && removed==0,text)
    }
  }}
  test("archive search evidence equals the scan's for a late rare literal, three hits, two operands, an operand longer than the overlap and a legacy head") { database { s =>
    val cases=List(
      lexical(rare) -> Map(s.epoch -> List("m1999")),
      lexical(triple) -> Map(s.epoch -> List("m10","m20"),s.legacy -> List("m0","m1")),
      lexical(rare,triple) -> Map(s.epoch -> List("m1999","m10"),s.legacy -> List("m0","m1")),
      // The parser bounds a literal to 512 bytes, and so to 512 folded scalars.
      ParsedArchiveExpression(ArchiveExpression.Text(long),SearchMode.Lexical,List(long),ArchiveExpression.True) -> Map(s.epoch -> List("m30")))
    cases.foreach { (parsed,expected) =>
      val result=s.index.sourceSearch("a",query(parsed),parsed,Nil,ReadMaterialization.unrestricted)
      assertEquals(result.evidence.map(evidence => evidence.sessionId -> evidence.matches.map(_.span.messageId)).toMap,expected,parsed.textOperands)
      val scanned=s.db.transaction(c => result.page.rows.map(row => ArchiveSearchEvidence(row.head.id,ArchiveSearchWitnesses.read(c,s.archive,"a",row,parsed,Nil,Map.empty,ReadMaterialization.unrestricted))))
      assertEquals(result.evidence,scanned,parsed.textOperands)
    }
  }}
}
