package ontology

import cats.effect.{IO, Resource}
import java.time.Clock
import java.util.UUID
import logstage.IzLogger
import ontology.curation.{CompiledCurationSchemas, CuratorModel}
import ontology.domain.Require
import ponygirls.runtime.{BoundedSecretFile, JdbcDatabase}

final class RuntimeIds(generate: () => UUID) {
  def fresh(): UUID = generate()
  def next: IO[UUID] = IO(generate())
}
final case class RuntimeEnvironment(clock: Clock, ids: RuntimeIds, credentialDigests: CredentialDigests,
  sessionSecrets: SessionSecrets, logger: IzLogger)
final case class RuntimeInputs(config: Config, database: JdbcDatabase, model: CuratorModel, auth: Auth,
  cursors: CursorSigner, environment: RuntimeEnvironment) {
  override def toString: String = "RuntimeInputs(<redacted>)"
}
object RuntimeInputs {
  private val CursorKeyBytes = 32
  private val HexCharactersPerByte = 2
  private val MaximumKeyFileBytes = CursorKeyBytes * HexCharactersPerByte + 1
  private def cursor(config: Config): CursorSigner = {
    val encoded = BoundedSecretFile.read(config.cursorKeyFile, MaximumKeyFileBytes).stripSuffix("\n")
    Require(encoded.matches("[0-9a-f]{64}"), "config", "cursor key must contain 32 lowercase hex-encoded bytes")
    val bytes = encoded.grouped(HexCharactersPerByte).map(Integer.parseInt(_, 16).toByte).toArray
    try new CursorSigner(bytes) finally java.util.Arrays.fill(bytes, 0.toByte)
  }
  def resource(config: Config, environment: RuntimeEnvironment): Resource[IO, RuntimeInputs] = for {
    auth <- Resource.eval(IO.blocking(new Auth(config.auth, environment.credentialDigests, environment.sessionSecrets, environment.clock)))
    cursors <- Resource.eval(IO.blocking(cursor(config)))
    database <- JdbcDatabase.resource(config.database)
    model <- CuratorModel.resource(config.curator, new CompiledCurationSchemas)
  } yield RuntimeInputs(config, database, model, auth, cursors, environment)
}
