package chronicle

import cats.effect.IO
import izumi.distage.model.definition.Lifecycle

/** The application graph owns synchronous admission lifetime; no hidden IO runtime. */
final class DatabaseResource(config: Config, profiles: IndexProfileCatalog) extends Lifecycle.FromPair[IO, Database] {
  def acquire: IO[(Database, IO[Unit])] = IO.blocking {
    val database = new Database(config,profiles)
    (database,IO.blocking(database.close()))
  }
}
