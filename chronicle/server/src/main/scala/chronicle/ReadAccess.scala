package chronicle

import cats.effect.IO
import cats.syntax.all.*
import chronicle.api.Scope

final case class ReadAccess(fresh: IO[Identity],materialization: ReadMaterialization) {
  def identity: IO[Identity] = fresh.flatTap(i => IO(i.requireScope(Scope.Read)))
  def blocking[A](read: Identity => A): IO[A] = identity.flatMap(i => IO.blocking(read(i))).flatTap(_ => identity.void)
}
object ReadAccess {
  def current(identity: Identity): ReadAccess = ReadAccess(IO.pure(identity),ReadMaterialization.unrestricted)
}
