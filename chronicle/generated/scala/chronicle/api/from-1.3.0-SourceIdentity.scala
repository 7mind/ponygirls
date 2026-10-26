import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__SourceIdentity__From__1_3_0
    extends AbstractConversion[v1_3_0.SourceIdentity, SourceIdentity] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: v1_3_0.SourceIdentity
      ): SourceIdentity = {
        val collectornamespace: String = _from.collectorNamespace
        val discoveryrootid: String = _from.discoveryRootId
        val format: SourceFormat = conversions.convertWithContext[C, v1_3_0.SourceFormat, SourceFormat](context, _from.format)
        val producersessionid: String = _from.producerSessionId
        val subagentid: Option[String] = _from.subagentId.map(e1 => e1)
        SourceIdentity(
                collectornamespace,
                discoveryrootid,
                format,
                producersessionid,
                subagentid
             )
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#SourceIdentity"
  }
}