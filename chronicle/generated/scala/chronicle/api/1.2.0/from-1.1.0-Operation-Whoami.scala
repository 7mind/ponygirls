import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_2_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__Whoami__From__1_1_0
    extends AbstractConversion[chronicle.api.v1_1_0.Operation.Whoami, Operation.Whoami] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_1_0.Operation.Whoami
      ): Operation.Whoami = {
        
        Operation.Whoami(
                
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/[chronicle.api/:#Operation]#Whoami"
  }
}