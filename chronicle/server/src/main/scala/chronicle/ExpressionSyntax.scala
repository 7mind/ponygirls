package chronicle

import chronicle.api.SearchMode
import java.nio.charset.StandardCharsets.UTF_8
import java.time.{Instant, LocalDate, ZoneOffset}
import java.util.Locale
import scala.collection.mutable

private[chronicle] object ExpressionSyntax {
  import BooleanExpression.*

  enum Directives {
    case ArchiveMode, Forbidden
  }

  final case class Location(input: String, offset: Int) {
    def invalid(detail: String): Nothing =
      throw DomainError("invalid",s"$detail at character ${input.codePointCount(0,offset)}")
  }

  final case class Field(name: String, value: String, location: Location, valueLocation: Location) {
    def instant: Instant = {
      try {
        if(value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) LocalDate.parse(value).atStartOfDay(ZoneOffset.UTC).toInstant
        else Instant.parse(value)
      } catch { case _: java.time.DateTimeException => valueLocation.invalid("invalid date or Instant") }
    }
  }

  final case class Parsed[P](expression: BooleanExpression[P], mode: Option[SearchMode], textOperands: List[String])

  private val maximumExpressionBytes=4096
  private val maximumTokens=128
  private val maximumNodes=64
  private val maximumNesting=16
  private val maximumTextOperands=16
  private val maximumLiteralBytes=512

  def parse[P](input: String, directives: Directives, resolve: Field => P): Parsed[P] = new Parser(input,directives,resolve).parse()

  private enum Kind {
    case Literal(value: String, quoted: Boolean, escaped: Boolean)
    case Colon, OpenParen, CloseParen, OpenBrace, CloseBrace, And, Or, Not
  }
  private final case class Token(kind: Kind, start: Int, end: Int)

  private final class Parser[P](input: String, directives: Directives, resolve: Field => P) {
    private val tokens=mutable.ArrayBuffer.empty[Token]
    private val texts=mutable.LinkedHashSet.empty[String]
    private var position=0
    private var current=0
    private var nodes=0
    private var directive: Option[(SearchMode,Int)]=None

    private def invalid(offset: Int, detail: String): Nothing =
      Location(input,offset).invalid(detail)

    private def boundary(): Unit = {
      var offset=0
      var bytes=0
      while(offset<input.length) {
        val char=input.charAt(offset)
        if(char=='\u0000') invalid(offset,"NUL is not permitted")
        if(Character.isLowSurrogate(char) || (Character.isHighSurrogate(char) && (offset+1==input.length || !Character.isLowSurrogate(input.charAt(offset+1)))))
          invalid(offset,"non-scalar Unicode")
        val scalar=input.codePointAt(offset)
        bytes+=(if(scalar<=0x7f) 1 else if(scalar<=0x7ff) 2 else if(scalar<=0xffff) 3 else 4)
        if(bytes>maximumExpressionBytes) invalid(offset,"expression byte limit exceeded")
        offset+=Character.charCount(scalar)
      }
    }

    private def add(kind: Kind, start: Int): Unit = {
      if(tokens.size==maximumTokens) invalid(start,"token limit exceeded")
      tokens+=Token(kind,start,position)
    }

    private def whitespace(char: Char): Boolean = Character.isWhitespace(char) || Character.isSpaceChar(char)
    private def separator(char: Char): Boolean = whitespace(char) || ":(){}\"".contains(char)
    private def literal(value: String, offset: Int): String = {
      if(value.isEmpty) invalid(offset,"empty operand")
      if(value.getBytes(UTF_8).length>maximumLiteralBytes) invalid(offset,"literal byte limit exceeded")
      value
    }

    private def unicodeEscape(offset: Int): Char = {
      if(position+4>input.length) invalid(offset,"incomplete Unicode escape")
      var value=0
      var digit=0
      while(digit<4) {
        val char=input.charAt(position)
        val hex=if(char>='0' && char<='9') char-'0' else if(char>='a' && char<='f') char-'a'+10 else if(char>='A' && char<='F') char-'A'+10 else -1
        if(hex<0) invalid(position,"invalid Unicode escape")
        value=value*16+hex
        position+=1
        digit+=1
      }
      value.toChar
    }

    private def quoted(): String = {
      val start=position
      val value=new java.lang.StringBuilder
      position+=1
      while(position<input.length && input.charAt(position)!='"') {
        val char=input.charAt(position)
        if(char=='\\') {
          val escape=position
          position+=1
          if(position==input.length) invalid(escape,"incomplete escape")
          val escaped=input.charAt(position)
          position+=1
          escaped match {
            case '"' => value.append('"')
            case '\\' => value.append('\\')
            case '/' => value.append('/')
            case 'b' => value.append('\b')
            case 'f' => value.append('\f')
            case 'n' => value.append('\n')
            case 'r' => value.append('\r')
            case 't' => value.append('\t')
            case 'u' =>
              val decoded=unicodeEscape(escape)
              if(decoded=='\u0000') invalid(escape,"NUL is not permitted")
              if(Character.isLowSurrogate(decoded)) invalid(escape,"non-scalar Unicode escape")
              value.append(decoded)
              if(Character.isHighSurrogate(decoded)) {
                if(position+2>input.length || input.charAt(position)!='\\' || input.charAt(position+1)!='u') invalid(escape,"non-scalar Unicode escape")
                position+=2
                val low=unicodeEscape(escape)
                if(!Character.isLowSurrogate(low)) invalid(escape,"non-scalar Unicode escape")
                value.append(low)
              }
            case _ => invalid(escape,"invalid JSON escape")
          }
        } else {
          if(Character.isISOControl(char)) invalid(position,"raw control character in literal")
          value.append(char)
          position+=1
        }
      }
      if(position==input.length) invalid(start,"unterminated quote")
      position+=1
      if(position<input.length && !separator(input.charAt(position))) invalid(position,"missing separator after quote")
      literal(value.toString,start)
    }

    private def word(): Kind = {
      val start=position
      val value=new java.lang.StringBuilder
      var escaped=false
      while(position<input.length && !separator(input.charAt(position))) {
        val char=input.charAt(position)
        if(char=='\\') {
          escaped=true
          val escape=position
          position+=1
          if(position==input.length) invalid(escape,"incomplete escape")
          if(Character.isISOControl(input.charAt(position))) invalid(position,"raw control character in escape")
          val scalar=input.codePointAt(position)
          value.appendCodePoint(scalar)
          position+=Character.charCount(scalar)
        } else {
          if(Character.isISOControl(char)) invalid(position,"raw control character in literal")
          value.append(char)
          position+=1
        }
      }
      if(position<input.length && input.charAt(position)=='"') invalid(position,"missing separator before quote")
      val decoded=literal(value.toString,start)
      if(escaped) Kind.Literal(decoded,false,true)
      else decoded.toUpperCase(Locale.ROOT) match {
        case "AND" => Kind.And
        case "OR" => Kind.Or
        case "NOT" => Kind.Not
        case _ => Kind.Literal(decoded,false,false)
      }
    }

    private def tokenize(): Unit = {
      while(position<input.length) {
        val start=position
        val char=input.charAt(position)
        if(Character.isISOControl(char) && char!='\t' && char!='\r' && char!='\n') invalid(position,"raw control character")
        if(whitespace(char)) position+=1
        else char match {
          case ':' => position+=1; add(Kind.Colon,start)
          case '(' => position+=1; add(Kind.OpenParen,start)
          case ')' => position+=1; add(Kind.CloseParen,start)
          case '{' => position+=1; add(Kind.OpenBrace,start)
          case '}' => position+=1; add(Kind.CloseBrace,start)
          case '"' => val value=quoted(); add(Kind.Literal(value,true,false),start)
          case _ => val kind=word(); add(kind,start)
        }
      }
    }

    private def offset: Int = if(current<tokens.size) tokens(current).start else input.length
    private def at(kind: Kind): Boolean = current<tokens.size && tokens(current).kind==kind
    private def take(): Token = { val token=tokens(current); current+=1; token }
    private def node(expression: BooleanExpression[P], location: Int): BooleanExpression[P] = {
      nodes+=1
      if(nodes>maximumNodes) invalid(location,"AST node limit exceeded")
      expression
    }
    private def conjunction(left: BooleanExpression[P], right: BooleanExpression[P], location: Int): BooleanExpression[P] = (left,right) match {
      case (True,_) => right
      case (_,True) => left
      case _ => node(And(left,right),location)
    }
    private def nested(depth: Int, location: Int): Int = {
      if(depth==maximumNesting) invalid(location,"nesting limit exceeded")
      depth+1
    }

    private def or(depth: Int): BooleanExpression[P] = {
      var expression=and(depth)
      var disjunction=false
      while(at(Kind.Or)) {
        disjunction=true
        val operator=take()
        expression=node(Or(expression,and(depth)),operator.start)
      }
      if(disjunction && depth==0) directive.foreach { case (_,location) => invalid(location,"mode directive is not permitted under OR") }
      expression
    }

    private def startsUnary: Boolean = current<tokens.size && (tokens(current).kind match {
      case Kind.Literal(_,_,_) | Kind.Not | Kind.OpenParen | Kind.OpenBrace => true
      case _ => false
    })

    private def and(depth: Int): BooleanExpression[P] = {
      var expression=unary(depth)
      while(at(Kind.And) || startsUnary) {
        val location=offset
        if(at(Kind.And)) take()
        expression=conjunction(expression,unary(depth),location)
      }
      expression
    }

    private def unary(depth: Int): BooleanExpression[P] = {
      if(at(Kind.Not)) {
        val operator=take()
        node(Not(unary(nested(depth,operator.start))),operator.start)
      } else primary(depth)
    }

    private def primary(depth: Int): BooleanExpression[P] = {
      if(current==tokens.size) invalid(offset,"missing operand")
      tokens(current).kind match {
        case Kind.OpenParen | Kind.OpenBrace =>
          val open=take()
          val expression=or(nested(depth,open.start))
          val close=if(open.kind==Kind.OpenParen) Kind.CloseParen else Kind.CloseBrace
          if(!at(close)) invalid(offset,"missing or mismatched closing delimiter")
          take()
          expression
        case Kind.Literal(value,quoted,escaped) =>
          val token=take()
          if(at(Kind.Colon)) {
            if(quoted || escaped) invalid(offset,"field name must be unquoted and unescaped")
            take()
            field(value,token.start,depth)
          } else {
            texts+=value
            if(texts.size>maximumTextOperands) invalid(token.start,"distinct text operand limit exceeded")
            node(Text(value),token.start)
          }
        case _ => invalid(offset,"expected operand")
      }
    }

    private def fieldValue(): (String,Int) = {
      if(current==tokens.size) invalid(offset,"missing field value")
      val token=take()
      token.kind match {
        case Kind.Literal(value,quoted,_) =>
          val decoded=new java.lang.StringBuilder(value)
          var end=token.end
          // Colons inside an unquoted field value retain ISO Instant and other literal syntax.
          while(!quoted && at(Kind.Colon) && offset==end) {
            val colon=take()
            if(current==tokens.size || offset!=colon.end) invalid(colon.start,"missing literal after colon")
            val part=take()
            part.kind match {
              case Kind.Literal(value,false,_) => decoded.append(':').append(value); end=part.end
              case _ => invalid(part.start,"expected unquoted literal after colon")
            }
          }
          (literal(decoded.toString,token.start),token.start)
        case _ => invalid(token.start,"missing field value")
      }
    }

    private def field(name: String, location: Int, depth: Int): BooleanExpression[P] = {
      val (value,valueLocation)=fieldValue()
      val atom=Field(name.toLowerCase(Locale.ROOT),value,Location(input,location),Location(input,valueLocation))
      if(atom.name=="mode") {
        if(directives==Directives.Forbidden) invalid(location,"mode directive is not permitted")
        if(directive.nonEmpty) invalid(location,"duplicate mode directive")
        if(depth!=0) invalid(location,"mode directive must be outside grouping and NOT")
        val mode=value.toLowerCase(Locale.ROOT) match {
          case "lexical" => SearchMode.Lexical
          case "semantic" => SearchMode.Semantic
          case "hybrid" => SearchMode.Hybrid
          case _ => invalid(valueLocation,"invalid mode")
        }
        directive=Some((mode,location))
        True
      } else node(BooleanExpression.Field(resolve(atom)),location)
    }

    def parse(): Parsed[P] = {
      boundary()
      tokenize()
      val expression=if(tokens.isEmpty) True else or(0)
      if(current!=tokens.size) invalid(offset,"unexpected token")
      Parsed(expression,directive.map(_._1),texts.toList)
    }
  }
}
