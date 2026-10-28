import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__OwnerReindexPreview__From__1_6_0
    extends AbstractConversion[v1_6_0.Result.OwnerReindexPreview, Result.OwnerReindexPreview] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.Result.OwnerReindexPreview
      ): Result.OwnerReindexPreview = {
        val result: OwnerReindexPlan = conversions.convertWithContext[C, v1_6_0.OwnerReindexPlan, OwnerReindexPlan](context, _from.result)
        Result.OwnerReindexPreview(
                result
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview"
  }
}