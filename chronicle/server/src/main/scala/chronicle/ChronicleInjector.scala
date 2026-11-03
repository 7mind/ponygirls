package chronicle

import cats.effect.IO
import izumi.distage.model.Injector as EffectInjector

/** Source-compatible application entrypoint; pinned Cats ABI support is shared. */
object ChronicleInjector {
  def apply(): EffectInjector[IO] = ponygirls.runtime.CatsIOInjector()
}
