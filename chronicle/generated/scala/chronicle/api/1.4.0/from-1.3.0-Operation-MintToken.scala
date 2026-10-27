import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_4_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__MintToken__From__1_3_0
    extends AbstractConversion[chronicle.api.v1_3_0.Operation.MintToken, Operation.MintToken] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_3_0.Operation.MintToken
      ): Operation.MintToken = {
        val name: String = _from.name
        val scopes: List[Scope] = _from.scopes.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_3_0.Scope, Scope](context, e1)).toList
        Operation.MintToken(
                name,
                scopes
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#MintToken"
  }
}