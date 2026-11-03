package haystack.storage

import haystack.domain.{Fault,ItemKey,QualifiedId}
import haystack.query.*
import ponygirls.losslessjson.LosslessJson as J
import java.sql.{Connection,ResultSet}

/** Closed templates only. User grammar, pointer segments, link labels, query
  * literals and cursor values are bound data. SQL orders the entire eligible
  * relation before LIMIT and returns summaries, never a corpus of documents.
  */
private[storage] object PostgresSearch {
  private final class Context {
    val values=Vector.newBuilder[Any]
    def bind(value:Any):String={values+=value;"?"}
  }
  private def comparison(op:String):String=op match{
    case "="|"!="|"<"|"<="|">"|">="=>op
    case _=>throw Fault("bad-envelope","invalid comparison")
  }
  private def path(pointer:String):Sql.TextArray=Sql.TextArray(if(pointer.isEmpty)Vector.empty else pointer.drop(1).split("/",-1).toVector.map(_.replace("~1","/").replace("~0","~")))
  private def node(ast:AstNode,c:Context):String=ast match{
    case AstNode.And(xs)=>xs.map(node(_,c)).mkString("("," AND ",")")
    case AstNode.Or(xs)=>xs.map(node(_,c)).mkString("("," OR ",")")
    case AstNode.Not(x)=>s"(NOT ${node(x,c)})"
    case AstNode.Text(words,_)=>s"(COALESCE(s.words,'{}'::text[]) @> ${c.bind(Sql.TextArray(words))}::text[])"
    case AstNode.Phrase(words,_)=>s"EXISTS(SELECT 1 FROM unnest(s.segments) segment WHERE (' '||segment||' ') LIKE ('% '||${c.bind(words.mkString(" "))}||' %'))"
    case AstNode.Pred(p)=>p match{
      case Predicate.Project(value,_)=>s"i.project_id=${c.bind(value)}"
      case Predicate.Id(value,_)=>val k=QualifiedId.decodeKey(value);s"(i.project_id=${c.bind(k.project)} AND i.item_id=${c.bind(k.item)})"
      case Predicate.Meta(field,value,_)=>
        val column=field match{
          case "created-by"=>"i.created_by"
          case "modified-by"=>"i.modified_by"
          case "type"|"status"|"importance"|"human-attention"=>s"(i.document->>'$field')"
          case _=>throw Fault("bad-envelope","invalid metadata predicate")
        }
        s"$column=${c.bind(value)}"
      case Predicate.Time(field,op,value,_)=>s"${if(field=="created-at")"i.created_at" else "i.modified_at"} ${comparison(op)} ${c.bind(value)}::timestamptz"
      case Predicate.Archived(mode,_)=>mode match{
        case "all"=>"TRUE"
        case "only"=>"(i.document->>'status')='archived'"
        case _=>"(i.document->>'status')<>'archived'"
      }
      case Predicate.Exists(pointer,_)=>s"haystack_exists(i.document->'fields',${c.bind(path(pointer))}::text[])"
      case Predicate.Field(pointer,op,literal,_)=>
        val operator=comparison(op)
        literal match{
          case _:J.Number=>s"COALESCE(haystack_compare_number(haystack_resolve(i.document->'fields',${c.bind(path(pointer))}::text[]),${c.bind(J.encode(literal))}) $operator 0,FALSE)"
          case _ if op=="=" || op=="!="=>
            val p=c.bind(path(pointer));val value=c.bind(J.encode(literal))
            s"(SELECT COALESCE(haystack_exists(i.document->'fields',args.path) AND haystack_resolve(i.document->'fields',args.path) $operator args.literal::jsonb,FALSE) FROM (SELECT $p::text[] AS path,$value::text AS literal) args)"
          case _=>"FALSE"
        }
      case Predicate.Link(kind,target,_)=>
        val k=QualifiedId.decodeKey(target)
        s"EXISTS(SELECT 1 FROM item_links l WHERE l.source_project_id=i.project_id AND l.source_item_id=i.item_id AND l.link_type=${c.bind(kind)} AND l.target_project_id=${c.bind(k.project)} AND l.target_item_id=${c.bind(k.item)})"
      case Predicate.LinkedTo(target,_)=>
        val k=QualifiedId.decodeKey(target)
        s"EXISTS(SELECT 1 FROM item_links l WHERE l.source_project_id=i.project_id AND l.source_item_id=i.item_id AND l.target_project_id=${c.bind(k.project)} AND l.target_item_id=${c.bind(k.item)})"
      case Predicate.LinkedFrom(source,_)=>
        val k=QualifiedId.decodeKey(source)
        s"EXISTS(SELECT 1 FROM item_links l WHERE l.target_project_id=i.project_id AND l.target_item_id=i.item_id AND l.source_project_id=${c.bind(k.project)} AND l.source_item_id=${c.bind(k.item)})"
      case Predicate.Tag(value,_)=>s"jsonb_exists(COALESCE(i.document->'tags','[]'::jsonb),${c.bind(value)})"
    }
  }
  private def primary(sort:SearchSort):(String,String)=sort.field match{
    case "key"|"project"=>("i.project_id COLLATE \"C\"","::text COLLATE \"C\"")
    case "title"|"type"|"status"|"importance"|"human-attention"=>(s"(i.document->>'${sort.field}') COLLATE \"C\"","::text COLLATE \"C\"")
    case "modified-at"=>("i.modified_at","::timestamptz")
    case "revision"=>("i.revision","::bigint")
  }
  final case class Plan(sql:String,params:Vector[Any],fingerprint:String)
  def compile(input:SearchInput):Plan={
    Search.validateSort(input.sort)
    if(input.limit<1||input.limit>100)throw new InvalidQuery(Vector(QueryDiagnostic("limit must be 1–100",Span(0,0))))
    val ast=Query.applyArchiveDefault(Parser.parseQuery(input.query));val fp=Search.fingerprint(input)
    val after=input.cursor.map(Search.decodeCursor(_,fp,input.sort));val ctx=new Context
    val filters=Vector.newBuilder[String];filters+=node(ast,ctx)
    input.project.foreach(project=>filters+=s"i.project_id=${ctx.bind(project)}")
    val direction=if(input.sort.direction=="asc")"ASC" else "DESC"
    val cmp=if(direction=="ASC")">" else "<"
    val key="(i.project_id COLLATE \"C\",i.item_id COLLATE \"C\")"
    val (expression,cast)=primary(input.sort)
    after.foreach { position=>
      if(input.sort.field=="key")filters+=s"$key $cmp (${ctx.bind(position.project)}::text COLLATE \"C\",${ctx.bind(position.item)}::text COLLATE \"C\")"
      else{
        val first=ctx.bind(position.value)+cast;val equal=ctx.bind(position.value)+cast
        val project=ctx.bind(position.project);val item=ctx.bind(position.item)
        filters+=s"(($expression $cmp $first) OR ($expression=$equal AND $key > ($project::text COLLATE \"C\",$item::text COLLATE \"C\")))"
      }
    }
    val keyDirection=if(input.sort.field=="key")direction else "ASC"
    val order=if(input.sort.field=="key")s"i.project_id COLLATE \"C\" $keyDirection,i.item_id COLLATE \"C\" $keyDirection" else s"$expression $direction,i.project_id COLLATE \"C\" ASC,i.item_id COLLATE \"C\" ASC"
    val limit=ctx.bind(input.limit+1)
    val sql=s"""SELECT i.project_id,i.item_id,i.revision,i.document->>'title' AS title,i.document->>'type' AS doc_type,i.document->>'status' AS status,i.document->>'importance' AS importance,i.document->>'human-attention' AS attention,COALESCE(i.document->'tags','[]'::jsonb)::text AS tags,i.modified_at,i.modified_by
      FROM items i LEFT JOIN item_search s USING(project_id,item_id) WHERE ${filters.result().map(s=>s"($s)").mkString(" AND ")} ORDER BY $order LIMIT $limit"""
    Plan(sql,ctx.values.result(),fp)
  }
  def search(connection:Connection,input:SearchInput):SearchResult={
    val plan=compile(input)
    val rows=Sql.rows(connection,plan.sql,plan.params) { r=>
      val tags=io.circe.parser.parse(r.getString("tags")).flatMap(_.as[Vector[String]]).fold(_=>throw Fault("unavailable","invalid stored tags"),identity)
      SearchSummary(r.getString("project_id"),r.getString("item_id"),r.getLong("revision"),r.getString("title"),r.getString("doc_type"),r.getString("status"),r.getString("importance"),r.getString("attention"),tags,r.getTimestamp("modified_at").toInstant,r.getString("modified_by"))
    }
    val page=rows.take(input.limit)
    SearchResult(page,if(rows.size>input.limit)Some(Search.encodeCursor(plan.fingerprint,Search.searchPosition(page.last,input.sort)))else None)
  }
}
