import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_1_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__MessagesResult__From__1_0_0
    extends AbstractConversion[chronicle.api.v1_0_0.MessagesResult, MessagesResult] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_0_0.MessagesResult
      ): MessagesResult = {
        val messages: List[Message] = _from.messages.map(e1 => conversions.convertWithContext[C, chronicle.api.v1_0_0.Message, Message](context, e1)).toList
        val total: Int = _from.total
        val offset: Int = _from.offset
        val view: ContentView = conversions.convertWithContext[C, chronicle.api.v1_0_0.ContentView, ContentView](context, _from.view)
        MessagesResult(
                messages,
                total,
                offset,
                view
             )
      }
      override def versionFrom: String = "1.0.0"
      override def versionTo: String = "1.1.0"
      override def typeId: String = "chronicle.api/:#MessagesResult"
  }
}