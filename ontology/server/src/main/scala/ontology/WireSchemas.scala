package ontology

import baboon.runtime.shared.BaboonJsonCodec
import io.circe.{Json, JsonObject}
import ontology.domain.{Fault, Require}
import java.nio.charset.StandardCharsets.UTF_8
import scala.util.Using

object WireSchemas {
  private enum Rule {
    case Reference(component: String)
    case Record(fields: Map[String, Rule])
    case Sequence(element: Rule)
    case Nullable(value: Rule)
    case Adt(members: Map[String, String])
    case Enumeration(values: Set[String])
    case Text, Bool, Uuid, I32, I64
  }
  private final case class Plan(domain: String, version: String, digest: String, types: Map[String, String], nodes: Map[String, Rule])
  private val MaxSchemaBytes = 4 * 1024 * 1024
  private val MaxDepth = 96
  private val IntegerText = "-?(0|[1-9][0-9]*)".r
  private val UuidText = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}".r
  private def configuration(condition: Boolean): Unit = Require(condition, "config", "invalid compiled wire schema")
  private def accepted(condition: Boolean): Unit = Require(condition, "bad-envelope", "invalid typed payload")
  private def obj(value: Json): JsonObject = value.asObject.getOrElse(throw Fault("config", "wire schema object required"))
  private def field(value: JsonObject, key: String): Json = value(key).getOrElse(throw Fault("config", "wire schema field missing"))
  private def string(value: Json): String = value.asString.getOrElse(throw Fault("config", "wire schema string required"))
  private def shape(value: JsonObject, keys: Set[String]): Unit = configuration(value.keys.toSet == keys)
  private def rule(value: Json): Rule = {
    val node = obj(value)
    string(field(node, "kind")) match {
      case "ref" => shape(node, Set("kind", "component")); Rule.Reference(string(field(node, "component")))
      case "object" => shape(node, Set("kind", "fields")); Rule.Record(obj(field(node, "fields")).toMap.view.mapValues(rule).toMap)
      case "array" => shape(node, Set("kind", "element")); Rule.Sequence(rule(field(node, "element")))
      case "nullable" => shape(node, Set("kind", "value")); Rule.Nullable(rule(field(node, "value")))
      case "adt" => shape(node, Set("kind", "members")); Rule.Adt(obj(field(node, "members")).toMap.view.mapValues(string).toMap)
      case "enum" =>
        shape(node, Set("kind", "values"))
        val values = field(node, "values").asArray.getOrElse(throw Fault("config", "wire schema enum required")).map(string)
        configuration(values.nonEmpty && values.distinct == values)
        Rule.Enumeration(values.toSet)
      case name =>
        shape(node, Set("kind"))
        name match {
          case "string" => Rule.Text
          case "boolean" => Rule.Bool
          case "uuid" => Rule.Uuid
          case "i32" => Rule.I32
          case "i64" => Rule.I64
          case _ => throw Fault("config", "unsupported wire schema rule")
        }
    }
  }
  private def resource(name: String): Array[Byte] = {
    val stream = Option(getClass.getResourceAsStream("/" + name)).getOrElse(throw Fault("config", "compiled wire schema missing"))
    val bytes = Using.resource(stream)(_.readNBytes(MaxSchemaBytes + 1))
    configuration(bytes.length <= MaxSchemaBytes)
    bytes
  }
  private lazy val plan: Plan = {
    val bytes = resource("ontology-wire-plan.json")
    val document = obj(io.circe.parser.parse(new String(bytes, UTF_8)).fold(_ => throw Fault("config", "invalid wire schema JSON"), identity))
    shape(document, Set("formatVersion", "domain", "version", "compilerDigest", "modelDigest", "rawDigest", "registry", "nodes"))
    configuration(field(document, "formatVersion").asNumber.flatMap(_.toInt).contains(1))
    val domain = string(field(document, "domain")); val version = string(field(document, "version"))
    List("compilerDigest", "modelDigest", "rawDigest").foreach(key => configuration(string(field(document, key)).matches("[0-9a-f]{64}")))
    val nodes = obj(field(document, "nodes")).toMap.view.mapValues(rule).toMap
    val entries = field(document, "registry").asArray.getOrElse(throw Fault("config", "wire schema registry required")).map { json =>
      val entry = obj(json)
      shape(entry, Set("typeId", "domain", "version", "component", "parent", "tag"))
      configuration(string(field(entry, "domain")) == domain && string(field(entry, "version")) == version)
      string(field(entry, "typeId")) -> string(field(entry, "component"))
    }
    configuration(entries.nonEmpty && entries.map(_._1).distinct.size == entries.size && entries.map(_._2).distinct.size == entries.size && entries.map(_._2).toSet == nodes.keySet)
    Plan(domain, version, Digests.bytes(bytes), entries.toMap, nodes)
  }

  private lazy val schemas: JsonObject = {
    val parsed = io.circe.parser.parse(new String(resource("ontology-wire-schemas.json"), UTF_8)).fold(_ => throw Fault("config", "invalid wire schemas"), identity)
    val document = obj(parsed)
    shape(document, Set("planDigest", "definitions"))
    configuration(string(field(document, "planDigest")) == plan.digest)
    val definitions = obj(field(document, "definitions"))
    configuration(definitions.keys.toSet == plan.nodes.keySet)
    definitions
  }
  private def referenced(value: Rule): Set[String] = value match {
    case Rule.Reference(component) => Set(component)
    case Rule.Record(fields) => fields.values.flatMap(referenced).toSet
    case Rule.Sequence(element) => referenced(element)
    case Rule.Nullable(child) => referenced(child)
    case Rule.Adt(members) => members.values.toSet
    case _ => Set.empty
  }
  def schema[A](codec: BaboonJsonCodec[A]): Json = {
    configuration(codec.baboonDomainIdentifier == plan.domain && codec.baboonDomainVersion == plan.version)
    val component = plan.types.getOrElse(codec.baboonTypeIdentifier, throw Fault("config", "unknown schema type"))
    var pending = List(component)
    var included = Set.empty[String]
    while (pending.nonEmpty) {
      val current = pending.head; pending = pending.tail
      if (!included.contains(current)) {
        included += current
        pending = referenced(plan.nodes.getOrElse(current, throw Fault("config", "unresolved schema reference"))).toList ++ pending
      }
    }
    val definitions = JsonObject.fromIterable(included.toList.sorted.map(name => name -> field(schemas, name)))
    val root = obj(field(schemas, component))
    Json.fromJsonObject(root.add("$schema", Json.fromString("https://json-schema.org/draft/2020-12/schema")).add("$defs", Json.fromJsonObject(definitions)))
  }
  def validate[A](codec: BaboonJsonCodec[A], value: Json): Unit = {
    configuration(codec.baboonDomainIdentifier == plan.domain && codec.baboonDomainVersion == plan.version)
    val component = plan.types.getOrElse(codec.baboonTypeIdentifier, throw Fault("config", "codec has no compiled wire schema"))
    visit(Rule.Reference(component), value, 0, Set.empty)
  }
  private def integer(value: Json, strings: Boolean): Option[BigInt] = value.asNumber.flatMap(_.toBigInt).orElse {
    if (!strings) None else value.asString.filter(text => text.length <= 20 && IntegerText.pattern.matcher(text).matches()).map(BigInt(_))
  }
  private def visit(rule: Rule, value: Json, depth: Int, references: Set[String]): Unit = rule match {
    case Rule.Reference(component) =>
      configuration(!references.contains(component))
      val target = plan.nodes.getOrElse(component, throw Fault("config", "unresolved wire schema reference"))
      visit(target, value, depth, references + component)
    case Rule.Nullable(child) => if (!value.isNull) visit(child, value, depth, references)
    case Rule.Record(fields) =>
      accepted(depth < MaxDepth)
      val input = value.asObject.getOrElse(throw Fault("bad-envelope", "object required"))
      accepted(input.keys.toSet == fields.keySet)
      fields.foreach { case (name, child) => visit(child, input(name).get, depth + 1, Set.empty) }
    case Rule.Sequence(element) =>
      accepted(depth < MaxDepth)
      val items = value.asArray.getOrElse(throw Fault("bad-envelope", "array required"))
      items.foreach(visit(element, _, depth + 1, Set.empty))
    case Rule.Adt(members) =>
      accepted(depth < MaxDepth)
      val input = value.asObject.getOrElse(throw Fault("bad-envelope", "ADT wrapper required"))
      accepted(input.size == 1)
      val (tag, body) = input.toVector.head
      val component = members.getOrElse(tag, throw Fault("bad-envelope", "unknown ADT tag"))
      visit(Rule.Reference(component), body, depth + 1, Set.empty)
    case Rule.Enumeration(values) => accepted(value.asString.exists(values.contains))
    case Rule.Text => accepted(value.isString)
    case Rule.Bool => accepted(value.isBoolean)
    case Rule.Uuid => accepted(value.asString.exists(text => UuidText.pattern.matcher(text).matches()))
    case Rule.I32 => accepted(integer(value, false).exists(number => number >= BigInt(Int.MinValue) && number <= BigInt(Int.MaxValue)))
    case Rule.I64 => accepted(integer(value, true).exists(number => number >= BigInt(Long.MinValue) && number <= BigInt(Long.MaxValue)))
  }
}
