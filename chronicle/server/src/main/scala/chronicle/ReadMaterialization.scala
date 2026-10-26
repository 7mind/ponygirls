package chronicle

import java.sql.Connection
import io.circe.Json

sealed trait ReadMaterialization {
  def begin(c: Connection): Unit
  def admit(measure: => Long): Unit
  def selected[A](c: Connection,selection: ReadSources.Selection)(decode: Json => A): List[A]
}
object ReadMaterialization {
  private val maximumSelectedRows = 300
  val unrestricted: ReadMaterialization = new ReadMaterialization {
    def begin(c: Connection): Unit = ()
    def admit(measure: => Long): Unit = ()
    def selected[A](c: Connection,selection: ReadSources.Selection)(decode: Json => A): List[A] =
      Sql.rows(c,"SELECT to_jsonb(selected_source) AS source_value FROM ("+selection.query.sql+") selected_source ORDER BY "+selection.orderBy,selection.query.args*)(row => decode(Sql.json(row,"source_value")))
  }
  def admitted(admission: ReadAdmission): ReadMaterialization = new ReadMaterialization {
    def begin(c: Connection): Unit = { Sql.exec(c,"SET LOCAL statement_timeout = '5s'"); () }
    def admit(measure: => Long): Unit = admission.consume(measure)
    def selected[A](c: Connection,selection: ReadSources.Selection)(decode: Json => A): List[A] = {
      Check(selection.maximumRows>=0 && selection.maximumRows<=maximumSelectedRows,"read-budget","invalid source selection bound")
      val cursor="WITH selected_source AS MATERIALIZED("+selection.query.sql+"),framed AS("+
        "SELECT 0::bigint AS source_ordinal,COALESCE(sum(octet_length(convert_to(to_jsonb(s)::text,'UTF8'))::numeric),0) AS source_bytes,count(*) AS source_count,NULL::jsonb AS source_value FROM selected_source s UNION ALL "+
        "SELECT row_number() OVER(ORDER BY "+selection.orderBy+"),NULL::numeric,NULL::bigint,to_jsonb(selected_source) FROM selected_source) SELECT source_bytes,source_count,source_value FROM framed ORDER BY source_ordinal"
      Sql.exec(c,"DECLARE ch_mcp_selected_sources NO SCROLL CURSOR FOR "+cursor,selection.query.args*)
      val header=Sql.one(c,"FETCH FORWARD 1 FROM ch_mcp_selected_sources")(row => (ReadSources.checked(row.getBigDecimal("source_bytes")),row.getLong("source_count"))).get
      Check(header._2>=0 && header._2<=selection.maximumRows,"read-budget","source selection exceeds row bound")
      admission.consume(header._1)
      val rows=Sql.rows(c,s"FETCH FORWARD ${selection.maximumRows} FROM ch_mcp_selected_sources")(row => decode(Sql.json(row,"source_value")))
      Sql.exec(c,"CLOSE ch_mcp_selected_sources")
      rows
    }
  }
}
