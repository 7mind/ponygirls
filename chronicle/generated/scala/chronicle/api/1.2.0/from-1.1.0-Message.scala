import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_2_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Message__From__1_1_0
    extends AbstractConversion[chronicle.api.v1_1_0.Message, Message] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_1_0.Message
      ): Message = {
        val id: String = _from.id
        val parentid: Option[String] = _from.parentId.map(e1 => e1)
        val role: String = _from.role
        val text: String = _from.text
        val timestamp: Option[String] = _from.timestamp.map(e1 => e1)
        val recordindex: Int = _from.recordIndex
        Message(
                id,
                parentid,
                role,
                text,
                timestamp,
                recordindex
             )
      }
      override def versionFrom: String = "1.1.0"
      override def versionTo: String = "1.2.0"
      override def typeId: String = "chronicle.api/:#Message"
  }
}