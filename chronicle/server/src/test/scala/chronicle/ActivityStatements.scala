package chronicle

import io.circe.Json
import java.lang.reflect.{InvocationHandler,InvocationTargetException,Method,Proxy}
import java.sql.{Connection,DriverManager,PreparedStatement}
import scala.collection.mutable.ListBuffer
import scala.util.Using

/** The statements of the Activity reads (`ActivityMetadataCorpus.base`, `WITH observed AS …`) as production issues them:
  * a pool of their own records each one's text and bound parameters when it executes, so that a test runs exactly what
  * the read ran — explained, or beside another text with the same parameters. */
private[chronicle] object ActivityStatements extends munit.Assertions {
  final case class Statement(sql: String,bound: List[(Method,Array[AnyRef])])
  private def forward(target: AnyRef,method: Method,args: Array[AnyRef]): AnyRef =
    try method.invoke(target,(if(args==null) Array.empty[AnyRef] else args)*) catch { case e: InvocationTargetException => throw e.getCause }
  final class Capture {
    val statements=ListBuffer.empty[Statement]
    def take(): List[Statement] = { val taken=statements.toList; statements.clear(); taken }
    val factory: ponygirls.runtime.JdbcConnectionFactory = new ponygirls.runtime.JdbcConnectionFactory {
      def open(url: String,properties: java.util.Properties): Connection = {
        val connection=DriverManager.getConnection(url,properties)
        Proxy.newProxyInstance(getClass.getClassLoader,Array(classOf[Connection]),new InvocationHandler {
          def invoke(proxy: AnyRef,method: Method,args: Array[AnyRef]): AnyRef =
            if(method.getName=="prepareStatement" && args!=null && args.length==1 && args(0).asInstanceOf[String].startsWith("WITH observed AS")) recorded(connection.prepareStatement(args(0).asInstanceOf[String]),args(0).asInstanceOf[String])
            else forward(connection,method,args)
        }).asInstanceOf[Connection]
      }
    }
    private def recorded(inner: PreparedStatement,sql: String): PreparedStatement = {
      val bound=scala.collection.mutable.SortedMap.empty[Int,(Method,Array[AnyRef])]
      Proxy.newProxyInstance(getClass.getClassLoader,Array(classOf[PreparedStatement]),new InvocationHandler {
        def invoke(proxy: AnyRef,method: Method,args: Array[AnyRef]): AnyRef = {
          if(method.getName.startsWith("set") && args!=null && args.length==2 && args(0).isInstanceOf[Integer]) bound(args(0).asInstanceOf[Integer].intValue)=(method,args)
          if(method.getName=="executeQuery" && (args==null || args.isEmpty)) statements.synchronized { statements+=Statement(sql,bound.values.toList) }
          forward(inner,method,args)
        }
      }).asInstanceOf[PreparedStatement]
    }
  }
  /** 15040203's text, verbatim, of the parts of the Activity statements the per-row CTE scans were removed from:
    * `head_counts` of the collector snapshot's totals and rows statements (`PostgresActivity.summary`) and
    * `ActivityQueueSql.largeLane` of the claim-order summary. */
  val previousTotalsHeadCounts: String = ", head_counts AS (\n        SELECT count(*) AS archive_heads,\n          count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM jobs j WHERE j.session_id=heads.id AND j.is_current)) AS without_target FROM heads\n      )"
  val previousRowsHeadCounts: String = ", head_counts AS (\n        SELECT collector_id,count(*) AS archive_heads,\n          count(*) FILTER (WHERE NOT EXISTS(SELECT 1 FROM jobs j WHERE j.session_id=heads.id AND j.is_current)) AS without_target FROM heads GROUP BY collector_id\n      )"
  val previousLargeLane: String = "SELECT (SELECT count(*) FROM queue WHERE waiting IN('AwaitingLargeLane','AwaitingLargePermit')) AS awaiting,\n      (SELECT count(*) FROM queue WHERE current_running AND waiting IS NULL) AS active_running,\n      (SELECT min(r.rank) FROM queue q JOIN ranked r ON r.id=q.id WHERE q.candidate AND q.waiting IN('AwaitingLargeLane','AwaitingLargePermit')) AS large_ahead"
  private def once(sql: String,part: String): Int = {
    val at=sql.indexOf(part)
    assert(at>=0 && sql.indexOf(part,at+1)<0,s"exactly one $part")
    at
  }
  /** The statement as 15040203 issued it: `sql`, a statement of the current code, with the rewritten part replaced by its
    * previous text (every other part of these statements is unchanged); None for a statement without one. */
  def previous(sql: String): Option[String] =
    if(sql.contains(", head_counts AS (")) {
      val from=once(sql,", head_counts AS ("); val to=once(sql,", job_counts AS (")
      val old=if(sql.contains("collector_rows AS (")) previousRowsHeadCounts else previousTotalsHeadCounts
      Some(sql.substring(0,from)+old+sql.substring(to))
    } else if(sql.contains(") AS large_ahead")) {
      val from=once(sql,"SELECT (SELECT count(*) FROM queue WHERE waiting IN("); val end=") AS large_ahead"; val to=once(sql,end)+end.length
      Some(sql.substring(0,from)+previousLargeLane+sql.substring(to))
    } else None
  /** Every row of `sql` run with `bound`, each as its column labels and text values, in the statement's order. */
  def rows(c: Connection,sql: String,bound: List[(Method,Array[AnyRef])]): List[List[(String,String)]] = Using.resource(c.prepareStatement(sql)) { p =>
    bound.foreach((method,args) => forward(p,method,args))
    Using.resource(p.executeQuery()) { r =>
      val columns=(1 to r.getMetaData.getColumnCount).map(i => r.getMetaData.getColumnLabel(i)).toList
      val out=List.newBuilder[List[(String,String)]]
      while(r.next()) out+=columns.zipWithIndex.map((label,i) => label -> r.getString(i+1))
      out.result()
    }
  }
  def explain(c: Connection,options: String,statement: Statement): Json = Using.resource(c.prepareStatement(s"EXPLAIN ($options, FORMAT JSON) "+statement.sql)) { p =>
    statement.bound.foreach((method,args) => forward(p,method,args))
    Using.resource(p.executeQuery())(r => { r.next(); Wire.parse(r.getString(1)) })
  }
  /** The plan PostgreSQL caches for the statement once it is prepared on a connection (pgJDBC's server-side statements):
    * the generic plan, its parameters unknown to the planner, executed with the bound values. */
  def explainGeneric(c: Connection,options: String,statement: Statement): Json = {
    var index=0
    val numbered="\\?".r.replaceAllIn(statement.sql,_ => { index+=1; "\\$"+index })
    assertEquals(index,statement.bound.size,"one bound value per parameter")
    Using.resource(c.createStatement()) { s => s.execute(s"PREPARE activity_generic AS $numbered"); s.execute("SET LOCAL plan_cache_mode=force_generic_plan") }
    try {
      val literals=statement.bound.map((_,args) => "'"+String.valueOf(args(1)).replace("'","''")+"'")
      Using.resource(c.createStatement())(s => Using.resource(s.executeQuery(s"EXPLAIN ($options, FORMAT JSON) EXECUTE activity_generic(${literals.mkString(",")})"))(r => { r.next(); Wire.parse(r.getString(1)) }))
    } finally Using.resource(c.createStatement()) { s => s.execute("DEALLOCATE activity_generic"); s.execute("SET LOCAL plan_cache_mode TO DEFAULT") }
  }
  def root(explained: Json): Json = explained.asArray.get.head.hcursor.downField("Plan").focus.get
  def children(node: Json): List[Json] = node.hcursor.downField("Plans").focus.flatMap(_.asArray).toList.flatten
  def nodes(node: Json): List[Json] = node :: children(node).flatMap(nodes)
  def text(node: Json,field: String): Option[String] = node.hcursor.downField(field).focus.flatMap(_.asString)
  def number(node: Json,field: String): Double = node.hcursor.downField(field).focus.flatMap(_.asNumber).fold(0.0)(_.toDouble)
}
