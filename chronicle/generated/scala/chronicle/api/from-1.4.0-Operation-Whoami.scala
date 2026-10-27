import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Whoami__From__1_4_0
    extends AbstractConversion[v1_4_0.Operation.Whoami, Operation.Whoami] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_4_0.Operation.Whoami
      ): Operation.Whoami = {
        
        Operation.Whoami(
                
             )
      }
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Whoami"
  }
}