import _root_.baboon.runtime.shared.{BaboonCodecsFacade, BaboonDomainVersion}

package haystack.api {
  object DomainHaystackApiFacade extends BaboonCodecsFacade {
    locally { register(BaboonDomainVersion("haystack.api", "1.0.0"), _root_.haystack.api.BaboonCodecsJson, _root_.haystack.api.BaboonCodecsUeba); () }
  }
}