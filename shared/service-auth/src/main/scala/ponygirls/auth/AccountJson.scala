package ponygirls.auth

import io.circe.Json

/** Separately versioned account protocol; domain Baboon DTOs remain service-owned. */
object AccountJson {
  val maxBodyBytes = 16384
  private val limits = ponygirls.losslessjson.LosslessJson.Limits(maxBodyBytes, 8, 32, 6)
  private def json(value: ponygirls.losslessjson.LosslessJson.Value): Json =
    io.circe.parser.parse(ponygirls.losslessjson.LosslessJson.encode(value)).fold(_ => throw AccountFailure("invalid"), identity)
  def parse(raw: String): Json = json(ponygirls.losslessjson.LosslessJson.parse(raw, limits).fold(_ => throw AccountFailure("invalid"), identity))
  def parseUtf8(raw: Array[Byte]): Json = json(ponygirls.losslessjson.LosslessJson.parseUtf8(raw, limits).fold(_ => throw AccountFailure("invalid"), identity))
  private def text(value: String): Json = Json.fromString(value)
  private def strings(values: Vector[String]): Json = Json.arr(values.map(text)*)
  def user(value: AccountUser): Json = Json.obj("id" -> text(value.id), "login" -> text(value.login.getOrElse(value.id)), "displayName" -> text(value.displayName))
  def token(value: AccountToken): Json = Json.obj("id" -> text(value.id), "name" -> text(value.name), "source" -> text(value.source),
    "createdAt" -> value.createdAt.fold(Json.Null)(text), "revoked" -> Json.fromBoolean(value.revoked), "scopes" -> strings(value.scopes))
  def account(value: AccountUser, tokens: Vector[AccountToken], scopes: Vector[String]): Json =
    Json.obj("user" -> user(value), "tokens" -> Json.arr(tokens.map(token)*), "scopes" -> strings(scopes))
  def issued(value: AccountIssued): Json = Json.obj("token" -> token(value.token), "secret" -> text(value.secret))
  def failure(code: String): Json = {
    val safe = if (Set("invalid", "unauthorized", "forbidden", "not-found", "conflict", "rate-limited", "too-large", "unavailable").contains(code)) code else "unavailable"
    Json.obj("error" -> Json.obj("code" -> text(safe), "message" -> text(safe.replace('-', ' '))))
  }
  private def fields(value: Json, expected: Set[String]): Unit =
    if (!value.asObject.exists(_.keys.toSet == expected)) throw AccountFailure("invalid")
  private def string(value: Json, key: String, maximum: Int): String = {
    val result = value.hcursor.get[String](key).fold(_ => throw AccountFailure("invalid"), identity)
    if (result.isEmpty || result.length > maximum) throw AccountFailure("invalid")
    result
  }
  def decodeLogin(value: Json): (String, String) = {
    fields(value, Set("login", "password"))
    (string(value, "login", 128), string(value, "password", 1024))
  }
  def decodeIssue(value: Json): (String, Vector[String]) = {
    fields(value, Set("name", "scopes"))
    val name = string(value, "name", 128)
    if (name.exists(_.isControl)) throw AccountFailure("invalid")
    val scopes = value.hcursor.get[Vector[String]]("scopes").fold(_ => throw AccountFailure("invalid"), identity)
    if (scopes.isEmpty || scopes.size > 16 || scopes.distinct.size != scopes.size || scopes.exists(s => s.isEmpty || s.length > 32 || s.exists(_.isControl))) throw AccountFailure("invalid")
    (name, scopes)
  }
}
