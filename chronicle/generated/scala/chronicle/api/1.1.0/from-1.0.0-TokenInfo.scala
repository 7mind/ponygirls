import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}
import java.util.UUID

package chronicle.api.v1_1_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__TokenInfo__From__1_0_0
    extends AbstractConversion[chronicle.api.v1_0_0.TokenInfo, TokenInfo] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_0_0.TokenInfo
      ): TokenInfo = {
        val id: UUID = _from.id
        val name: String = _from.name
        val scopes: List[Scope] = _from.scopes.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_0_0.Scope, Scope](context, e1)).toList
        val createdat: String = _from.createdAt
        val revoked: Boolean = _from.revoked
        TokenInfo(
                id,
                name,
                scopes,
                createdat,
                revoked
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/:#TokenInfo"
  }
}