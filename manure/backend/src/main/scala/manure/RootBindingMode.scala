package manure

import io.circe.Json

enum RootBindingMode(val label: String):
  case Strict extends RootBindingMode("strict")
  case InodeAnchored extends RootBindingMode("inode-anchored")
  case UnsafeOff extends RootBindingMode("unsafe-off")

object RootBindingMode:
  def parse(value: Json): RootBindingMode =
    Require(value.asObject.exists(_.keys.toSet == Set("mode")),"bad-envelope")
    val mode=value.hcursor.get[String]("mode").getOrElse(throw DomainError("bad-envelope"))
    RootBindingMode.values.find(_.label == mode).getOrElse(throw DomainError("bad-envelope"))
