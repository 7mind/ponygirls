import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_4_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Message__From__1_3_0
    extends AbstractConversion[chronicle.api.v1_3_0.Message, Message] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_3_0.Message
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
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#Message"
  }
}