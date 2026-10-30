import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_7_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__ListTokens__From__1_6_0
    extends AbstractConversion[chronicle.api.v1_6_0.Operation.ListTokens, Operation.ListTokens] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_6_0.Operation.ListTokens
      ): Operation.ListTokens = {
        
        Operation.ListTokens(
                
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#ListTokens"
  }
}