import _root_.baboon.runtime.shared.{BaboonCodecsFacade, BaboonDomainVersion}

package rites.api {
  object DomainRitesApiFacade extends BaboonCodecsFacade {
    locally { register(BaboonDomainVersion("rites.api", "0.2.0"), _root_.rites.api.BaboonCodecsJson, _root_.rites.api.BaboonCodecsUeba); () }
  }
}