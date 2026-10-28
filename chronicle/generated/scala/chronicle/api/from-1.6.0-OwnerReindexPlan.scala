import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__OwnerReindexPlan__From__1_6_0
    extends AbstractConversion[v1_6_0.OwnerReindexPlan, OwnerReindexPlan] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_6_0.OwnerReindexPlan
      ): OwnerReindexPlan = {
        val currenttargetprofile: String = _from.currentTargetProfile
        val targetprofile: String = _from.targetProfile
        val selectionhash: String = _from.selectionHash
        val heads: Long = _from.heads
        val alreadycurrent: Long = _from.alreadyCurrent
        val replacements: Long = _from.replacements
        OwnerReindexPlan(
                currenttargetprofile,
                targetprofile,
                selectionhash,
                heads,
                alreadycurrent,
                replacements
             )
      }
      override def versionFrom: String = "1.6.0"
      override def versionTo: String = "1.7.0"
      override def typeId: String = "chronicle.api/:#OwnerReindexPlan"
  }
}