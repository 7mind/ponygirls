import _root_.baboon.runtime.shared.{BaboonCodecsFacade, BaboonDomainVersion}

package rites.worker {
  object DomainRitesWorkerFacade extends BaboonCodecsFacade {
    locally { register(BaboonDomainVersion("rites.worker", "0.1.0"), _root_.rites.worker.BaboonCodecsJson, _root_.rites.worker.BaboonCodecsUeba); () }
  }
}