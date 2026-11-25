package ponygirls.auth

import io.circe.{DecodingFailure, HCursor}

/** Inherit means the next lower priority applies: the user's choice for an admin, or the server default for a user. */
enum IndexingChoice(val setting: Option[Boolean]) {
  case Inherit extends IndexingChoice(None)
  case Enable extends IndexingChoice(Some(true))
  case Disable extends IndexingChoice(Some(false))
}

final case class IndexingPolicy(defaultEnabled: Boolean, allowOptIn: Boolean, allowOptOut: Boolean) {
  def enabled(userChoice: IndexingChoice, adminOverride: IndexingChoice): Boolean =
    adminOverride.setting.orElse(userChoice.setting).getOrElse(defaultEnabled)

  /** Whether a user can explicitly opt in or opt out. An admin override is not editable by its subject. */
  def permitsOpt(enabled: Boolean, adminOverride: IndexingChoice): Boolean =
    adminOverride == IndexingChoice.Inherit && (if (enabled) allowOptIn else allowOptOut)
}
object IndexingPolicy {
  val defaults: IndexingPolicy = IndexingPolicy(defaultEnabled = true, allowOptIn = false, allowOptOut = false)

  /** Read the optional `indexing` object at the config root. Chronicle's other indexing options share it. */
  def decode(root: HCursor): Either[DecodingFailure, IndexingPolicy] = root.downField("indexing").success match {
    case None => Right(defaults)
    case Some(section) if !section.value.isObject => Left(DecodingFailure("indexing must be an object", section.history))
    case Some(section) =>
      def flag(key: String, default: Boolean): Either[DecodingFailure, Boolean] =
        if (section.downField(key).succeeded) section.get[Boolean](key) else Right(default)
      for {
        enabled <- flag("defaultEnabled", defaults.defaultEnabled)
        optIn <- flag("allowOptIn", defaults.allowOptIn)
        optOut <- flag("allowOptOut", defaults.allowOptOut)
      } yield IndexingPolicy(enabled, optIn, optOut)
  }
}
