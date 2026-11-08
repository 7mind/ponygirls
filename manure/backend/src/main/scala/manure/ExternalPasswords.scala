package manure

import ponygirls.runtime.Migration
import scala.util.Using

/** Never part of Artifact or its search/sidecar projections. Explicitly reveal
  * only at the storage boundary, hash integrity check and dedicated response.
  */
final class ExternalPasswordSecret private (val reveal: String):
  override def toString: String = "ExternalPasswordSecret([REDACTED])"
object ExternalPasswordSecret:
  def apply(value: String): ExternalPasswordSecret = new ExternalPasswordSecret(value)

object ExternalPasswords:
  lazy val migration: Migration =
    val input = getClass.getResourceAsStream("/004_external_passwords.sql")
    Require(input != null, "unavailable")
    val sql = Using.resource(scala.io.Source.fromInputStream(input,"UTF-8"))(_.mkString)
    Migration(4,"recoverable-external-passwords",sql)
