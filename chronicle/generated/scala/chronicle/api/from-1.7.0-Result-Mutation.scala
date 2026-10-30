import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Result__Mutation__From__1_7_0
    extends AbstractConversion[v1_7_0.Result.Mutation, Result.Mutation] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_7_0.Result.Mutation
      ): Result.Mutation = {
        val receipt: MutationReceipt = conversions.convertWithContext[C, v1_7_0.MutationReceipt, MutationReceipt](context, _from.receipt)
        Result.Mutation(
                receipt
             )
      }
      override def versionFrom: String = "1.7.0"
      override def versionTo: String = "1.8.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Result]#Mutation"
  }
}