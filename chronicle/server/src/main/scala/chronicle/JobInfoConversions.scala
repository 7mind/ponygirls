package chronicle.protocol

import chronicle.api.v1_7_0 as api
import chronicle.api.v1_6_0 as v16
import baboon.runtime.shared.{AbstractBaboonConversions,AbstractConversion}

final class JobInfoToV16 extends AbstractConversion[api.JobInfo,v16.JobInfo] {
  def versionFrom="1.7.0"; def versionTo="1.6.0"; def typeId="chronicle.api/:#JobInfo"
  def doConvert[C](context: Option[C],conversions: AbstractBaboonConversions,from: api.JobInfo): v16.JobInfo =
    v16.JobInfo(from.id,from.sessionId,from.revision,conversions.convertWithContext[C,api.JobState,v16.JobState](context,from.state),from.attempts,from.error,from.completedWindows,from.totalWindows)
}
