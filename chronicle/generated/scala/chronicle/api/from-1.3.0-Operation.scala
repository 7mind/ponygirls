import _root_.baboon.runtime.shared.{AbstractBaboonConversions, AbstractConversion}

package chronicle.api {
  @scala.annotation.nowarn("cat=deprecation") object Convert__Operation__From__1_3_0
    extends AbstractConversion[v1_3_0.Operation, Operation] {
      override def doConvert[C](
        context: Option[C],
        conversions: AbstractBaboonConversions,
        from: v1_3_0.Operation
      ): Operation = from match {
        case x: v1_3_0.Operation.Hello => conversions.convertWithContext[C, v1_3_0.Operation.Hello, Operation.Hello](context, x)
        case x: v1_3_0.Operation.Ping => conversions.convertWithContext[C, v1_3_0.Operation.Ping, Operation.Ping](context, x)
        case x: v1_3_0.Operation.Pong => conversions.convertWithContext[C, v1_3_0.Operation.Pong, Operation.Pong](context, x)
        case x: v1_3_0.Operation.Whoami => conversions.convertWithContext[C, v1_3_0.Operation.Whoami, Operation.Whoami](context, x)
        case x: v1_3_0.Operation.Search => conversions.convertWithContext[C, v1_3_0.Operation.Search, Operation.Search](context, x)
        case x: v1_3_0.Operation.GetSession => conversions.convertWithContext[C, v1_3_0.Operation.GetSession, Operation.GetSession](context, x)
        case x: v1_3_0.Operation.GetChunks => conversions.convertWithContext[C, v1_3_0.Operation.GetChunks, Operation.GetChunks](context, x)
        case x: v1_3_0.Operation.GetMessages => conversions.convertWithContext[C, v1_3_0.Operation.GetMessages, Operation.GetMessages](context, x)
        case x: v1_3_0.Operation.GetRaw => conversions.convertWithContext[C, v1_3_0.Operation.GetRaw, Operation.GetRaw](context, x)
        case x: v1_3_0.Operation.Related => conversions.convertWithContext[C, v1_3_0.Operation.Related, Operation.Related](context, x)
        case x: v1_3_0.Operation.Facets => conversions.convertWithContext[C, v1_3_0.Operation.Facets, Operation.Facets](context, x)
        case x: v1_3_0.Operation.CollectionStatus => conversions.convertWithContext[C, v1_3_0.Operation.CollectionStatus, Operation.CollectionStatus](context, x)
        case x: v1_3_0.Operation.IngestStatus => conversions.convertWithContext[C, v1_3_0.Operation.IngestStatus, Operation.IngestStatus](context, x)
        case x: v1_3_0.Operation.RetryJob => conversions.convertWithContext[C, v1_3_0.Operation.RetryJob, Operation.RetryJob](context, x)
        case x: v1_3_0.Operation.ListTokens => conversions.convertWithContext[C, v1_3_0.Operation.ListTokens, Operation.ListTokens](context, x)
        case x: v1_3_0.Operation.MintToken => conversions.convertWithContext[C, v1_3_0.Operation.MintToken, Operation.MintToken](context, x)
        case x: v1_3_0.Operation.RevokeToken => conversions.convertWithContext[C, v1_3_0.Operation.RevokeToken, Operation.RevokeToken](context, x)
        case x: v1_3_0.Operation.ListGroups => conversions.convertWithContext[C, v1_3_0.Operation.ListGroups, Operation.ListGroups](context, x)
        case x: v1_3_0.Operation.CreateGroup => conversions.convertWithContext[C, v1_3_0.Operation.CreateGroup, Operation.CreateGroup](context, x)
        case x: v1_3_0.Operation.Invite => conversions.convertWithContext[C, v1_3_0.Operation.Invite, Operation.Invite](context, x)
        case x: v1_3_0.Operation.AcceptInvite => conversions.convertWithContext[C, v1_3_0.Operation.AcceptInvite, Operation.AcceptInvite](context, x)
        case x: v1_3_0.Operation.RemoveMember => conversions.convertWithContext[C, v1_3_0.Operation.RemoveMember, Operation.RemoveMember](context, x)
        case x: v1_3_0.Operation.LeaveGroup => conversions.convertWithContext[C, v1_3_0.Operation.LeaveGroup, Operation.LeaveGroup](context, x)
        case x: v1_3_0.Operation.DeleteGroup => conversions.convertWithContext[C, v1_3_0.Operation.DeleteGroup, Operation.DeleteGroup](context, x)
        case x: v1_3_0.Operation.Receipt => conversions.convertWithContext[C, v1_3_0.Operation.Receipt, Operation.Receipt](context, x)
        case x: v1_3_0.Operation.Purge => conversions.convertWithContext[C, v1_3_0.Operation.Purge, Operation.Purge](context, x)
        case x: v1_3_0.Operation.Logout => conversions.convertWithContext[C, v1_3_0.Operation.Logout, Operation.Logout](context, x)
        case x: v1_3_0.Operation.Archive => conversions.convertWithContext[C, v1_3_0.Operation.Archive, Operation.Archive](context, x)
        case x: v1_3_0.Operation.Activity => conversions.convertWithContext[C, v1_3_0.Operation.Activity, Operation.Activity](context, x)
        case x: v1_3_0.Operation.ActivityJobs => conversions.convertWithContext[C, v1_3_0.Operation.ActivityJobs, Operation.ActivityJobs](context, x)
        case x: v1_3_0.Operation.LocateMessage => conversions.convertWithContext[C, v1_3_0.Operation.LocateMessage, Operation.LocateMessage](context, x)
        case x: v1_3_0.Operation.PreviewRetryFailed => conversions.convertWithContext[C, v1_3_0.Operation.PreviewRetryFailed, Operation.PreviewRetryFailed](context, x)
        case x: v1_3_0.Operation.ApplyRetryFailed => conversions.convertWithContext[C, v1_3_0.Operation.ApplyRetryFailed, Operation.ApplyRetryFailed](context, x)
        case other => throw new IllegalArgumentException(s"Bad input: $other")
      }
      override def versionFrom: String = "1.3.0"
      override def versionTo: String = "1.4.0"
      override def typeId: String = "chronicle.api/:#Operation"
  }
}