import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Activity__From__1_6_0
    extends AbstractConversion[v1_6_0.Operation.Activity, Operation.Activity] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.Operation.Activity
      ): Operation.Activity = {
        val query: ActivityQuery = conversions.convertWithContext[C, v1_6_0.ActivityQuery, ActivityQuery](context, _from.query)
        Operation.Activity(
                query
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Activity"
  }
}