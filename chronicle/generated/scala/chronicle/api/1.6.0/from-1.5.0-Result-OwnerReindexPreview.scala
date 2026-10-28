import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_6_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__OwnerReindexPreview__From__1_5_0
    extends AbstractConversion[chronicle.api.v1_5_0.Result.OwnerReindexPreview, Result.OwnerReindexPreview] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_5_0.Result.OwnerReindexPreview
      ): Result.OwnerReindexPreview = {
        val result: OwnerReindexPlan = conversions.convertWithContext[C, chronicle.api.v1_5_0.OwnerReindexPlan, OwnerReindexPlan](context, _from.result)
        Result.OwnerReindexPreview(
                result
             )
      }
      override def versionFrom: String = "1.5.0"
      override def versionTo: String = "1.6.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#OwnerReindexPreview"
  }
}