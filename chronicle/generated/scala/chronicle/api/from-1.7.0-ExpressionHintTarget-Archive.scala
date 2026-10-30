import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__ExpressionHintTarget__Archive__From__1_7_0
    extends AbstractConversion[v1_7_0.ExpressionHintTarget.Archive, ExpressionHintTarget.Archive] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.ExpressionHintTarget.Archive
      ): ExpressionHintTarget.Archive = {
        
        ExpressionHintTarget.Archive(
                
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#ExpressionHintTarget]#Archive"
  }
}