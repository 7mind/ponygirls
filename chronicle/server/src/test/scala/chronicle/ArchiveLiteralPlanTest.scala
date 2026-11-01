package chronicle

import chronicle.api.*

class ArchiveLiteralPlanTest extends munit.FunSuite {
  test("Whitebox Atomic regression: multiple distinct literal trigrams materialize global candidates while single-key patterns retain source probes") {
    val config=Fixtures.config(); val db=new Database(config,IndexProfileCatalog.legacyOnly(config))
    val index=new PostgresArchiveIndex(db,new PostgresArchive(db,config),config)
    List("abcd"->true,"ABab"->true,"abcabc"->true,"aaaa"->false,"AAAA"->false,"the"->false,"a"->false,"a_bcd"->false,"ab%c"->false,"KKK"->false).foreach { case (operand,global) =>
      val query=ArchiveQuery("mode:lexical \""+operand+"\"",ArchiveSort.LastTimestamp,SortDirection.Desc,None,10,true)
      val parsed=ArchiveExpression.parse(query.expression)
      val sql=index.statement("a",query,parsed,Nil,None)
      assertEquals(sql.text.contains("g0 AS MATERIALIZED"),global,s"operand=$operand")
      assert(sql.text.contains("head_candidate"),s"candidate mask must retain current-HEAD completeness: operand=$operand")
      assertEquals(sql.args.count(_ == "%"+operand.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%"),1)
    }
  }
}
