package chronicle

import cats.effect.IO
import cats.syntax.all.*
import distage.*
import izumi.distage.model.Injector as EffectInjector
import izumi.distage.modules.DefaultModule
import izumi.functional.quasi.{QuasiApplicative,QuasiAsync,QuasiFunctor,QuasiIO,QuasiPrimitives}

object ChronicleInjector {
  private def libraryIO: QuasiIO[IO] = QuasiIO[IO]
  private def libraryModule: DefaultModule[IO] = summon[DefaultModule[IO]]

  def apply(): EffectInjector[IO] = {
    given io: QuasiIO[IO] = new Scala213CatsIO(libraryIO)
    val support=new ModuleDef {
      make[QuasiFunctor[IO]].fromValue(io)
      make[QuasiApplicative[IO]].fromValue(io)
      make[QuasiPrimitives[IO]].fromValue(io)
      make[QuasiIO[IO]].fromValue(io)
      make[QuasiAsync[IO]].fromValue(new Scala213CatsAsync)
    }
    given DefaultModule[IO] = new DefaultModule[IO](libraryModule.module.overriddenBy(support))
    Injector[IO]()
  }
}

// Izumi's Scala 3 List adapter has a different erased Cats ABI from the pinned Scala 2.13 contracts stack.
private final class Scala213CatsIO(delegate: QuasiIO[IO]) extends QuasiIO[IO] {
  export delegate.{pure,map,map2,flatMap,bracket,bracketCase,uninterruptibleExcept,maybeSuspend,maybeSuspendEither,definitelyRecoverUnsafeIgnoreTrace,definitelyRecoverWithTrace,redeem,fail,tapBothUntyped}
  override def traverse[A,B](values: Iterable[A])(f: A => IO[B]): IO[List[B]] = values.toList.traverse(f)
  override def traverse_[A](values: Iterable[A])(f: A => IO[Unit]): IO[Unit] = values.toList.traverse_(f)
}
private final class Scala213CatsAsync extends QuasiAsync[IO] {
  def async[A](effect: (Either[Throwable,A] => Unit) => Unit): IO[A] = IO.async_(effect)
  def parTraverse[A,B](values: IterableOnce[A])(f: A => IO[B]): IO[List[B]] = values.iterator.toList.parTraverse(f)
  def parTraverse_[A](values: IterableOnce[A])(f: A => IO[Unit]): IO[Unit] = values.iterator.toList.parTraverse_(f)
  def parTraverseN[A,B](n: Int)(values: IterableOnce[A])(f: A => IO[B]): IO[List[B]] = IO.parTraverseN(n)(values.iterator.toList)(f)
  def parTraverseN_[A](n: Int)(values: IterableOnce[A])(f: A => IO[Unit]): IO[Unit] = parTraverseN(n)(values)(f).void
}
