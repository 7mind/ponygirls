package ponygirls.auth

import cats.effect.IO
import io.circe.Json

/** These four routes are independent of the imperative-accounts master switch. */
enum IndexingAccountEndpoint(val method: String, val path: String) {
  case Profile extends IndexingAccountEndpoint(AccountEndpoint.Get, "/indexing")
  case SetChoice extends IndexingAccountEndpoint(AccountEndpoint.Post, "/indexing")
  case Users extends IndexingAccountEndpoint(AccountEndpoint.Get, "/admin/indexing")
  case SetOverride extends IndexingAccountEndpoint(AccountEndpoint.Post, "/admin/indexing")
}
object IndexingAccountEndpoint {
  def route(method: String, rawPath: String): Option[IndexingAccountEndpoint] =
    values.find(endpoint => endpoint.method == method && endpoint.path == rawPath)
}

/** Same transaction for the live account authority and the indexing preferences. It commits every returned
  * outcome, including wrong-password rejections that count toward lockout. */
trait IndexingAccountTransactions {
  def run[A](work: (ImperativeAccounts, IndexingPreferences) => A): IO[A]
}

private[auth] final case class IndexingAccountProfile(userId: String, admin: Boolean, preference: IndexingPreference)
private[auth] final case class IndexingAccountUser(userId: String, displayName: String, preference: IndexingPreference)

private[auth] object IndexingAccountJson {
  import IndexingChoice.*

  def choice(value: String): IndexingChoice = value match {
    case "inherit" => Inherit
    case "enabled" => Enable
    case "disabled" => Disable
    case _ => throw AccountFailure("invalid")
  }
  def text(choice: IndexingChoice): String = choice match {
    case Inherit => "inherit"
    case Enable => "enabled"
    case Disable => "disabled"
  }

  private def state(policy: IndexingPolicy, preference: IndexingPreference): Vector[(String, Json)] = Vector(
    "defaultEnabled" -> Json.fromBoolean(policy.defaultEnabled),
    "enabled" -> Json.fromBoolean(preference.enabled(policy)),
    "choice" -> Json.fromString(text(preference.choice)),
    "override" -> Json.fromString(text(preference.overrideChoice)))

  def profile(policy: IndexingPolicy, value: IndexingAccountProfile): Json = Json.fromFields(Vector(
    "userId" -> Json.fromString(value.userId),
    "admin" -> Json.fromBoolean(value.admin),
    "allowOptIn" -> Json.fromBoolean(policy.allowOptIn),
    "allowOptOut" -> Json.fromBoolean(policy.allowOptOut)) ++ state(policy, value.preference))

  def users(policy: IndexingPolicy, values: Vector[IndexingAccountUser]): Json = Json.obj("users" -> Json.fromValues(values.map { user =>
    Json.fromFields(Vector("userId" -> Json.fromString(user.userId), "displayName" -> Json.fromString(user.displayName)) ++ state(policy, user.preference))
  }))
}
