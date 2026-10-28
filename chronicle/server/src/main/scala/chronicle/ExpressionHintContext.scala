package chronicle

import java.nio.charset.StandardCharsets.UTF_8
import java.util.Locale
import scala.collection.mutable

private[chronicle] object ExpressionHintBounds {
  val expressionBytes=4096
  val literalBytes=512
  val tokens=128
  val nodes=64
  val nesting=16
  val textOperands=16
  val maximumHints=20
  val responseBytes=48*1024
}

private[chronicle] enum HintField(val name: String) {
  case Agent extends HintField("agent")
  case YoloProfile extends HintField("yolo-profile")
  case User extends HintField("user")
  case Tag extends HintField("tag")
  case Tags extends HintField("tags")
  case Project extends HintField("project")
  case Branch extends HintField("branch")
  case Producer extends HintField("producer")
  case Format extends HintField("format")
  case Model extends HintField("model")
  case Status extends HintField("status")
  case After extends HintField("after")
  case Before extends HintField("before")
  case Mode extends HintField("mode")
  case Collector extends HintField("collector")
  case Profile extends HintField("profile")
  case Classification extends HintField("classification")
  case Reason extends HintField("reason")
  case Lease extends HintField("lease")
  case Phase extends HintField("phase")
  case Freshness extends HintField("freshness")
}
private[chronicle] enum HintFocus {
  case Field(prefix: String,binary: Boolean,modeAllowed: Boolean)
  case Value(field: Option[HintField],prefix: Option[String],modeAllowed: Boolean)
  case Unavailable
}
private[chronicle] final case class ExpressionHintContext(start: Int,end: Int,focus: HintFocus)

private[chronicle] object ExpressionHintContext {
  private enum Kind { case Word,Colon,Open,Close,Operator }
  private final case class Token(kind: Kind,start: Int,end: Int,quoted: Boolean,escaped: Boolean,closed: Boolean)
  private final case class Atom(first: Token,last: Token,field: Option[String],colon: Option[Token],value: Option[Token],decoded: Option[String])
  private final case class Located(atom: Atom,depth: Int,negated: Boolean,afterDepth: Int,afterNegated: Boolean)
  private def whitespace(char: Char): Boolean = Character.isWhitespace(char) || Character.isSpaceChar(char)
  private def separator(char: Char): Boolean = whitespace(char) || ":(){}\"".contains(char)
  private def scalar(value: String): Boolean = !value.contains('\u0000') && UTF_8.newEncoder().canEncode(value)
  private def invalid(detail: String): Nothing = throw DomainError("invalid",detail)

  private def boundary(input: String,caret: Int): Unit = {
    Check(caret>=0 && caret<=input.length,"invalid","invalid hint caret")
    Check(caret==0 || caret==input.length || !Character.isHighSurrogate(input.charAt(caret-1)) || !Character.isLowSurrogate(input.charAt(caret)),"invalid","hint caret splits a scalar")
    var position=0
    var bytes=0
    while(position<input.length) {
      val char=input.charAt(position)
      if(char=='\u0000' || Character.isLowSurrogate(char) || (Character.isHighSurrogate(char) && (position+1==input.length || !Character.isLowSurrogate(input.charAt(position+1))))) invalid("invalid hint Unicode")
      val point=input.codePointAt(position)
      if(Character.isISOControl(point) && point!='\t' && point!='\r' && point!='\n') invalid("raw control character in hint expression")
      bytes+=(if(point<=0x7f) 1 else if(point<=0x7ff) 2 else if(point<=0xffff) 3 else 4)
      if(bytes>ExpressionHintBounds.expressionBytes) invalid("expression byte limit exceeded")
      position+=Character.charCount(point)
    }
  }
  private def decoded(raw: String,quoted: Boolean): Option[String] = {
    if(quoted) io.circe.parser.parse("\""+raw+"\"").toOption.flatMap(_.asString).filter(scalar)
    else {
      val result=new java.lang.StringBuilder
      var position=0
      while(position<raw.length) {
        if(raw.charAt(position)=='\\') {
          position+=1
          if(position==raw.length) return None
        }
        val point=raw.codePointAt(position)
        result.appendCodePoint(point)
        position+=Character.charCount(point)
      }
      Some(result.toString)
    }
  }
  private def content(input: String,token: Token,end: Int): String = {
    val start=token.start+(if(token.quoted) 1 else 0)
    val finish=if(token.quoted && token.closed) token.end-1 else token.end
    input.substring(start,math.max(start,math.min(end,finish)))
  }
  private def tokenize(input: String): Vector[Token] = {
    val result=Vector.newBuilder[Token]
    var count=0
    var position=0
    while(position<input.length) {
      if(whitespace(input.charAt(position))) position+=1
      else {
        val start=position
        var quoted=false
        var escaped=false
        var closed=true
        val kind=input.charAt(position) match {
          case ':' => position+=1; Kind.Colon
          case '(' | '{' => position+=1; Kind.Open
          case ')' | '}' => position+=1; Kind.Close
          case '"' =>
            quoted=true; closed=false; position+=1
            while(position<input.length && !closed) {
              val char=input.charAt(position)
              if(Character.isISOControl(char)) invalid("raw control character in quoted hint literal")
              if(char=='\\') {
                escaped=true; position+=1
                if(position<input.length) position+=Character.charCount(input.codePointAt(position))
              } else if(char=='"') { position+=1; closed=true }
              else position+=Character.charCount(input.codePointAt(position))
            }
            Kind.Word
          case _ =>
            while(position<input.length && !separator(input.charAt(position))) {
              if(input.charAt(position)=='\\') {
                escaped=true; position+=1
                if(position<input.length) {
                  if(Character.isISOControl(input.charAt(position))) invalid("raw control character in hint escape")
                  position+=Character.charCount(input.codePointAt(position))
                }
              } else position+=Character.charCount(input.codePointAt(position))
            }
            val word=input.substring(start,position).toUpperCase(Locale.ROOT)
            if(!escaped && Set("AND","OR","NOT").contains(word)) Kind.Operator else Kind.Word
        }
        count+=1
        if(count>ExpressionHintBounds.tokens) invalid("token limit exceeded")
        result+=Token(kind,start,position,quoted,escaped,closed)
      }
    }
    result.result()
  }
  private def atoms(input: String,tokens: Vector[Token],caret: Int): Vector[Atom] = {
    val result=Vector.newBuilder[Atom]
    var position=0
    while(position<tokens.size) {
      val first=tokens(position)
      if(first.kind==Kind.Word && !first.quoted && !first.escaped && position+1<tokens.size && tokens(position+1).kind==Kind.Colon) {
        val colon=tokens(position+1)
        position+=2
        val value=if(position<tokens.size && (tokens(position).kind==Kind.Word || (tokens(position).kind==Kind.Operator && tokens(position).start<caret && caret<=tokens(position).end))) Some(tokens(position)) else None
        var last=value.getOrElse(colon)
        value.foreach { token =>
          position+=1
          if(!token.quoted) while(position+1<tokens.size && tokens(position).kind==Kind.Colon && tokens(position).start==last.end && tokens(position+1).start==tokens(position).end && !tokens(position+1).quoted && (tokens(position+1).kind==Kind.Word || tokens(position+1).kind==Kind.Operator)) {
            last=tokens(position+1); position+=2
          }
          if(!token.quoted && position<tokens.size && tokens(position).kind==Kind.Colon && tokens(position).start==last.end) {
            last=tokens(position); position+=1
          }
        }
        val text=value.flatMap(token => decoded(if(token.quoted) content(input,token,token.end) else input.substring(token.start,last.end),token.quoted))
        result+=Atom(first,last,Some(input.substring(first.start,first.end).toLowerCase(Locale.ROOT)),Some(colon),value,text)
      } else {
        val text=if(first.kind==Kind.Word) decoded(content(input,first,first.end),first.quoted) else None
        result+=Atom(first,first,None,None,None,text)
        position+=1
      }
    }
    result.result()
  }
  def read(input: String,caret: Int): ExpressionHintContext = {
    boundary(input,caret)
    val lexical=tokenize(input)
    val parsed=atoms(input,lexical,caret)
    val located=Vector.newBuilder[Located]
    var stack=List.empty[Int]
    var negation=0
    var outerOr=false
    var grouping=0
    lexical.foreach { token => token.kind match {
      case Kind.Open => grouping+=1
      case Kind.Close => grouping=math.max(0,grouping-1)
      case Kind.Operator if grouping==0 && input.substring(token.start,token.end).equalsIgnoreCase("OR") => outerOr=true
      case _ => ()
    }}
    var operands=0
    var nots=0
    val texts=mutable.HashSet.empty[String]
    parsed.foreach { atom =>
      val depth=stack.headOption.getOrElse(0)
      val negated=negation>0
      atom.decoded.foreach(value => if(value.getBytes(UTF_8).length>ExpressionHintBounds.literalBytes) invalid("literal byte limit exceeded"))
      if(atom.field.nonEmpty || atom.first.kind==Kind.Word) {
        if(!atom.field.contains("mode")) operands+=1
        if(atom.field.isEmpty) atom.decoded.foreach(value => if(value.nonEmpty) texts+=value)
        negation=0
      } else atom.first.kind match {
        case Kind.Open =>
          val next=depth+negation+1
          if(next>ExpressionHintBounds.nesting) invalid("nesting limit exceeded")
          stack=next::stack; negation=0
        case Kind.Close => stack=stack.drop(1); negation=0
        case Kind.Operator => input.substring(atom.first.start,atom.first.end).toUpperCase(Locale.ROOT) match {
          case "NOT" => negation+=1; nots+=1; if(depth+negation>ExpressionHintBounds.nesting) invalid("nesting limit exceeded")
          case "OR" => negation=0
          case _ => negation=0
        }
        case _ => ()
      }
      located+=Located(atom,depth,negated,stack.headOption.getOrElse(0),negation>0)
    }
    if(math.max(0,operands*2-1)+nots>ExpressionHintBounds.nodes) invalid("AST node limit exceeded")
    if(texts.size>ExpressionHintBounds.textOperands) invalid("distinct text operand limit exceeded")
    val values=located.result()
    def mode(at: Option[Located],depth: Int,negated: Boolean): Boolean = !outerOr && depth==0 && !negated && !values.exists(value => !at.contains(value) && value.atom.field.contains("mode"))
    values.find { value =>
      val atom=value.atom
      atom.field.nonEmpty && caret>=atom.first.start && (caret<=atom.last.end || (atom.value.isEmpty && caret>=atom.last.end && input.substring(atom.last.end,caret).forall(whitespace)))
    } match {
      case Some(value) =>
        val atom=value.atom
        val colon=atom.colon.get
        if(caret<=colon.start) ExpressionHintContext(atom.first.start,colon.end,HintFocus.Field(input.substring(atom.first.start,math.min(caret,atom.first.end)),false,mode(Some(value),value.depth,value.negated)))
        else {
          val start=atom.value.filter(_.start<=caret).map(_.start).getOrElse(caret)
          val end=atom.value.map(_ => atom.last.end).getOrElse(caret)
          val prefix=atom.value.filter(_.start<=caret).fold(Option(""))(token => decoded(if(token.quoted) content(input,token,caret) else input.substring(token.start,caret),token.quoted))
          ExpressionHintContext(start,end,HintFocus.Value(HintField.values.find(_.name==atom.field.get),prefix,mode(Some(value),value.depth,value.negated)))
        }
      case None =>
        val active=values.find(value => value.atom.first.start<=caret && caret<=value.atom.last.end && (value.atom.first.kind==Kind.Word || value.atom.first.kind==Kind.Operator))
        val start=active.map(_.atom.first.start).getOrElse(caret)
        val end=active.map(_.atom.last.end).getOrElse(caret)
        val preceding=values.filter(_.atom.last.end<=start).lastOption
        val binary=preceding.exists(value => value.atom.field.nonEmpty || value.atom.first.kind==Kind.Word || value.atom.first.kind==Kind.Close)
        val before=values.filter(_.atom.last.end<=caret).lastOption
        val depth=active.map(_.depth).getOrElse(before.fold(0)(_.afterDepth))
        val negated=active.map(_.negated).getOrElse(before.exists(_.afterNegated))
        if(active.exists(value => value.atom.first.quoted || value.atom.first.escaped) || preceding.exists(_.atom.first.kind==Kind.Colon)) ExpressionHintContext(start,end,HintFocus.Unavailable)
        else ExpressionHintContext(start,end,HintFocus.Field(input.substring(start,caret),binary,mode(active,depth,negated)))
    }
  }
}
