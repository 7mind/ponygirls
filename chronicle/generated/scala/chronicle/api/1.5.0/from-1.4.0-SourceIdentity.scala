import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api.v1_5_0 {
  @scala.annotation.nowarn("cat=deprecation") object Convert__SourceIdentity__From__1_4_0
    extends AbstractConversion[chronicle.api.v1_4_0.SourceIdentity, SourceIdentity] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        _from: chronicle.api.v1_4_0.SourceIdentity
      ): SourceIdentity = {
        val collectornamespace: String = _from.collectorNamespace
        val discoveryrootid: String = _from.discoveryRootId
        val format: SourceFormat = conversions.convertWithContext[C, chronicle.api.v1_4_0.SourceFormat, SourceFormat](context, _from.format)
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
      override def versionFrom: String = "1.4.0"
      override def versionTo: String = "1.5.0"
      override def typeId: String = "chronicle.api/:#SourceIdentity"
  }
}