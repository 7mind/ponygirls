package ponygirls.auth

import java.time.{Clock, Instant}
import java.time.temporal.ChronoUnit
import java.util.UUID

/** Accounts created at runtime: signup with approval, enrollment and reset, login with optional TOTP,
  * recovery, self-service and administration. No SQL and no HTTP: the caller owns the transaction, the
  * boundary checks and the per-address limits, and resolves the presented cookie to an `AccountCredential`.
  *
  * Every operation other than `directory` answers with a value. The caller commits whatever is returned
  * (design D27): a rejection may have counted a failure or consumed a TOTP step. Only faults that leave
  * nothing to persist are thrown (`AccountFailure("config")`, or a port aborting the transaction).
  *
  * With the master switch off (`settings` empty) the imperative accounts are suspended, never revoked:
  * `directory` omits them, `login` declines, and imperative-account operations answer `not-found`. The
  * independent indexing endpoints still serve declarative actors and can manage suspended indexing owners.
  */
final class ImperativeAccounts private[auth] (repository: ImperativeUserRepository, settings: Option[ImperativeSettings],
  declared: DeclaredDirectory, sessions: AccountSessions, history: IdentityHistory, hasher: PasswordHasher, clock: Clock) {
  import AccountOutcome.{Completed, Rejected}
  import AccountRejection.*
  import ImperativePolicy.*

  private final case class Actor(user: AccountUser, row: Option[StoredImperativeUser], admin: Boolean)
  private type Checked[A] = Either[Rejected, A]

  private def now: Instant = clock.instant().truncatedTo(ChronoUnit.MICROS)
  private def refuse(reason: AccountRejection): Rejected = Rejected(reason, None)
  private def outcome[A](checked: Checked[A]): AccountOutcome[A] = checked.fold(identity, Completed(_))
  private def whenOn[A](body: ImperativeSettings => AccountOutcome[A]): AccountOutcome[A] =
    settings.fold[AccountOutcome[A]](refuse(NotFound))(body)
  private def accountUser(row: StoredImperativeUser): AccountUser =
    AccountUser(row.id, "human", row.id, Some(row.id), Some(row.passwordHash), row.status == AccountStatus.Active, AccountOrigin.Imperative)
  private def store(row: StoredImperativeUser, at: Instant): StoredImperativeUser = {
    val saved = row.copy(updatedAt = at)
    repository.updateUser(saved)
    saved
  }

  /** The declared users and, while the master switch is on, the active imperative users. An active or
    * disabled imperative id equal to a declared id or login (ASCII case-insensitively) is a configuration
    * fault with the switch on or off; a pending application never is.
    */
  def directory: Vector[AccountUser] = {
    val rows = repository.users
    if (rows.exists(row => row.status != AccountStatus.Pending && declared.claims(row.id))) throw AccountFailure("config")
    if (settings.isEmpty) declared.users else declared.users ++ rows.filter(_.status == AccountStatus.Active).map(accountUser)
  }

  // ---- locks, proofs ----

  /** The lock acquisition of an operation (design D22): the directory lock, then the complete owner
    * set — actor, owner of the session being replaced, targets — through one `lockOwners` call.
    */
  private def acquire(directory: Boolean, actor: Option[String], previous: Option[String], targets: Vector[String]): Unit = {
    if (directory) repository.lockDirectory()
    acquireOwners(actor, previous, targets)
  }
  /** For the one operation that learns its target from a read under the directory lock it already holds. */
  private def acquireOwners(actor: Option[String], previous: Option[String], targets: Vector[String]): Unit = {
    val prior = previous.flatMap(sessions.sessionOwner).filter(id => declared.contains(id) || repository.user(id).nonEmpty)
    val (declarative, imperative) = (actor.toVector ++ prior ++ targets).distinct.partition(declared.contains)
    sessions.lockOwners(declarative, imperative)
  }
  private def establish(row: StoredImperativeUser, previous: Option[String]): SignedIn = {
    val user = accountUser(row)
    SignedIn(user, sessions.establish(user, previous))
  }
  private def verifyPassword(password: String, encoded: String): Boolean = {
    val chars = password.toCharArray
    try hasher.verify(chars, encoded) finally java.util.Arrays.fill(chars, '\u0000')
  }
  private def hashPassword(password: String): String = {
    val chars = password.toCharArray
    try hasher.hash(chars) finally java.util.Arrays.fill(chars, '\u0000')
  }
  private def verifyCode(secret: Array[Byte], code: String, at: Instant, lastStep: Long): Option[Long] =
    try Totp.verify(secret, code, at, lastStep) match {
      case Totp.Verdict.Accepted(step) => Some(step)
      case Totp.Verdict.Rejected => None
    } finally java.util.Arrays.fill(secret, 0.toByte)
  private def opened(active: ImperativeSettings, row: StoredImperativeUser): Option[Array[Byte]] =
    try Some(active.vault.open(row.id, row.totp)) catch { case AccountFailure("unavailable") => None }
  private def lockStarted(row: StoredImperativeUser, path: FailurePath, at: Instant): Option[FailurePath] =
    Some(path).filter(_ => LockSchedule.of(path).lockedUntil(row.counter(path), at).nonEmpty)

  /** Checks a password against the row under its owner's lock and persists the password counter: a
    * failure is counted and returned as a value; a success clears the counter.
    */
  private def passwordProof(row: StoredImperativeUser, password: String, wrong: AccountRejection, at: Instant): Checked[StoredImperativeUser] =
    LockSchedule.Password.retryAfter(row.passwordFailures, at) match {
      case Some(wait) => Left(refuse(RateLimited(wait)))
      case None if verifyPassword(password, row.passwordHash) =>
        Right(if (row.passwordFailures == FailureCounter.Clear) row else store(row.copy(passwordFailures = FailureCounter.Clear), at))
      case None =>
        val counted = store(row.copy(passwordFailures = LockSchedule.Password.failed(row.passwordFailures, at)), at)
        Left(Rejected(wrong, lockStarted(counted, FailurePath.Password, at)))
    }
  /** Checks a code against the stored secret and yields the accepted step, which the caller must store.
    * A failure is counted on `path` and returned as a value; a success deliberately clears nothing.
    */
  private def codeProof(active: ImperativeSettings, row: StoredImperativeUser, code: String, path: FailurePath,
    wrong: AccountRejection, at: Instant): Checked[Long] = {
    val schedule = LockSchedule.of(path)
    schedule.retryAfter(row.counter(path), at) match {
      case Some(wait) => Left(refuse(RateLimited(wait)))
      case None => opened(active, row) match {
        case None => Left(refuse(Unavailable))
        case Some(secret) => verifyCode(secret, code, at, row.totpLastStep).toRight {
          val counted = store(row.withCounter(path, schedule.failed(row.counter(path), at)), at)
          Rejected(wrong, lockStarted(counted, path, at))
        }
      }
    }
  }
  /** Pure: the submitter holds the secret it wants stored. */
  private def secretProof(totpSecret: String, totpCode: String, at: Instant): Checked[(Array[Byte], Long)] =
    Totp.decodeSecret(totpSecret).filter(_ => validTotpCode(totpCode)) match {
      case None => Left(refuse(Invalid))
      case Some(secret) => Totp.verify(secret, totpCode, at, ImperativeAccounts.NoStep) match {
        case Totp.Verdict.Accepted(step) => Right((secret, step))
        case Totp.Verdict.Rejected => Left(refuse(TotpMismatch))
      }
    }
  /** Pure: shapes, then password policy, then the TOTP proof. */
  private def newCredentials(credentials: NewCredentials, username: String, email: Option[String], at: Instant): Checked[(Array[Byte], Long)] =
    if (Totp.decodeSecret(credentials.totpSecret).isEmpty || !validTotpCode(credentials.totpCode)) Left(refuse(Invalid))
    else if (!validPassword(credentials.password, username, email)) Left(refuse(WeakPassword))
    else secretProof(credentials.totpSecret, credentials.totpCode, at)

  // ---- namespace ----

  /** Design §4.1.3 rules 2 and 3: a currently declared id or login, or a retained historical identity. */
  private def claimed(name: String): Boolean = declared.claims(name) || history.retained(name)
  private def reserved(active: ImperativeSettings, name: String): Boolean = ReservedUsernames(name) || active.reservedUsernames(name)
  private def created(active: ImperativeSettings, id: String, email: String, hash: String, secret: Array[Byte], step: Long,
    requireTotp: Boolean, status: AccountStatus, via: CreatedVia, by: Option[String], at: Instant): StoredImperativeUser =
    StoredImperativeUser(id, status, email, hash, active.vault.seal(id, secret), step, requireTotp, false,
      FailureCounter.Clear, FailureCounter.Clear, FailureCounter.Clear, at, via, by, None, None, at, at)

  // ---- unauthenticated operations ----

  /** One transaction: the row and, without approval, the projection and the session commit together. */
  def signup(username: String, email: String, credentials: NewCredentials, previous: Option[String]): AccountOutcome[SignupResult] = whenOn { active =>
    if (!active.signup) refuse(NotFound)
    else if (!validUsername(username) || !validEmail(email)) refuse(Invalid)
    else newCredentials(credentials, username, Some(email), now) match {
      case Left(rejected) => rejected
      case Right((secret, step)) =>
        val hash = hashPassword(credentials.password)
        acquire(directory = true, None, previous.filterNot(_ => active.requireApproval), Vector(username))
        val at = now
        repository.deleteExpiredEnrollments(at)
        if (reserved(active, username) || claimed(username) || repository.user(username).nonEmpty ||
            repository.enrollments.exists(row => row.username == username && row.kind == EnrollmentKind.Invite)) refuse(UsernameUnavailable)
        else if (repository.users.size >= math.min(active.maxUsers, HardUserCeiling)) refuse(Forbidden)
        else {
          val status = if (active.requireApproval) AccountStatus.Pending else AccountStatus.Active
          val row = created(active, username, email, hash, secret, step, credentials.requireTotp, status, CreatedVia.Signup, None, at)
          repository.insertUser(row)
          if (active.requireApproval) Completed(SignupResult.Pending)
          else {
            sessions.activated(accountUser(row))
            Completed(SignupResult.Active(establish(row, previous)))
          }
        }
    }
  }

  /** Imperative login. A declared login, or the master switch being off, is `NotImperative`. */
  def login(loginName: String, password: String, totp: Option[String], previous: Option[String]): LoginDecision = settings match {
    case Some(active) if !declared.hasLogin(loginName) => LoginDecision.Imperative(imperativeLogin(active, loginName, password, totp, previous))
    case _ => LoginDecision.NotImperative
  }
  private def imperativeLogin(active: ImperativeSettings, loginName: String, password: String, totp: Option[String],
    previous: Option[String]): AccountOutcome[SignedIn] = {
    val name = fold(loginName)
    def unknown: Rejected = {
      verifyPassword(password, Password.dummyHash)
      refuse(Unauthorized)
    }
    if (loginName.isEmpty || loginName.length > LoginMaximumLength || password.isEmpty || password.length > PasswordMaximumLength) refuse(Invalid)
    else if (!validUsername(name)) unknown
    else {
      acquire(directory = false, None, previous, Vector(name))
      val at = now
      repository.user(name).filter(_.status != AccountStatus.Disabled) match {
        case None => unknown
        case Some(row) => passwordProof(row, password, Unauthorized, at) match {
          case Left(rejected) => rejected
          case Right(proven) if proven.status == AccountStatus.Pending => refuse(PendingApproval)
          case Right(proven) if !proven.totpRequired => Completed(establish(proven, previous))
          case Right(proven) => totp match {
            case None => refuse(TotpRequired)
            case Some(code) => codeProof(active, proven, code, FailurePath.Totp, Unauthorized, at) match {
              case Left(rejected) => rejected
              case Right(step) => Completed(establish(store(proven.copy(totpLastStep = step), at), previous))
            }
          }
        }
      }
    }
  }

  /** Username, current TOTP code and a new password. Its failures count on the recovery counter only. */
  def recover(username: String, totp: String, password: String, previous: Option[String]): AccountOutcome[SignedIn] = whenOn { active =>
    val name = fold(username)
    def unknown: Rejected = {
      verifyCode(new Array[Byte](Totp.SecretBytes), totp, now, ImperativeAccounts.NoStep)
      refuse(Unauthorized)
    }
    if (!validPassword(password, name, None)) refuse(WeakPassword)
    else if (!validUsername(name)) unknown
    else {
      acquire(directory = false, None, previous, Vector(name))
      val at = now
      repository.user(name).filter(_.status == AccountStatus.Active) match {
        case None => unknown
        case Some(row) => codeProof(active, row, totp, FailurePath.Recovery, Unauthorized, at) match {
          case Left(rejected) => rejected
          case Right(_) if password.equalsIgnoreCase(row.email) => refuse(WeakPassword)
          case Right(step) =>
            val recovered = store(row.copy(passwordHash = hashPassword(password), totpLastStep = step, passwordFailures = FailureCounter.Clear,
              totpFailures = FailureCounter.Clear, recoveryFailures = FailureCounter.Clear, credentialsAt = at), at)
            sessions.revokeSessions(row.id, None)
            sessions.updated(accountUser(recovered))
            Completed(establish(recovered, previous))
        }
      }
    }
  }

  // ---- enrollment: invitations follow `enrollment`, resets follow the master switch ----

  private def offered(active: ImperativeSettings, row: StoredEnrollment): Boolean = row.kind == EnrollmentKind.Reset || active.enrollment
  private def enrollment(active: ImperativeSettings, code: String, at: Instant): Option[StoredEnrollment] =
    Some(code).filter(Secrets.canonical).flatMap(value => repository.enrollmentByDigest(Secrets.digest(value)))
      .filter(row => offered(active, row) && row.expiresAt.isAfter(at))
  private def listed(row: StoredEnrollment): ListedEnrollment =
    ListedEnrollment(row.id, row.username, row.kind, row.createdBy, row.createdAt, row.expiresAt)
  /** Create-or-replace under the directory lock: the previous code for the username stops working. */
  private def issue(active: ImperativeSettings, username: String, kind: EnrollmentKind, by: String, at: Instant): IssuedEnrollment = {
    val code = Secrets.generate()
    val row = StoredEnrollment("enrollment-" + UUID.randomUUID().toString, Secrets.digest(code), username, kind, by, at, at.plus(active.enrollmentTtl))
    repository.putEnrollment(row)
    IssuedEnrollment(listed(row), code)
  }

  private def emailFits(kind: EnrollmentKind, email: Option[String]): Boolean = kind match {
    case EnrollmentKind.Invite => email.exists(validEmail)
    case EnrollmentKind.Reset => email.isEmpty
  }

  def inspectEnrollment(code: String): AccountOutcome[EnrollmentInfo] = whenOn { active =>
    acquire(directory = true, None, None, Vector.empty)
    val at = now
    repository.deleteExpiredEnrollments(at)
    enrollment(active, code, at).fold[AccountOutcome[EnrollmentInfo]](refuse(NotFound))(row => Completed(EnrollmentInfo(row.username, row.kind, row.expiresAt)))
  }

  /** `email` is required for an invitation and forbidden for a reset. The account is active at once. */
  def redeemEnrollment(code: String, email: Option[String], credentials: NewCredentials, previous: Option[String]): AccountOutcome[SignedIn] = whenOn { active =>
    repository.lockDirectory()
    val at = now
    repository.deleteExpiredEnrollments(at)
    enrollment(active, code, at) match {
      case None => refuse(NotFound)
      case Some(row) if !emailFits(row.kind, email) => refuse(Invalid)
      case Some(row) => newCredentials(credentials, row.username, email, at) match {
        case Left(rejected) => rejected
        case Right((secret, step)) =>
          // The password is hashed under the directory lock: only the holder of a live code gets here.
          val hash = hashPassword(credentials.password)
          acquireOwners(None, previous, Vector(row.username))
          email match {
            case Some(address) => redeemInvitation(active, row, address, hash, secret, step, credentials.requireTotp, previous, at)
            case None => redeemReset(active, row, credentials, hash, secret, step, previous, at)
          }
      }
    }
  }
  private def redeemInvitation(active: ImperativeSettings, invitation: StoredEnrollment, email: String, hash: String, secret: Array[Byte],
    step: Long, requireTotp: Boolean, previous: Option[String], at: Instant): AccountOutcome[SignedIn] =
    if (claimed(invitation.username) || repository.user(invitation.username).nonEmpty) refuse(UsernameUnavailable)
    else if (repository.users.size >= HardUserCeiling) refuse(Forbidden)
    else {
      val row = created(active, invitation.username, email, hash, secret, step, requireTotp, AccountStatus.Active,
        CreatedVia.Enrollment, Some(invitation.createdBy), at)
      repository.insertUser(row)
      repository.deleteEnrollment(invitation.id)
      sessions.activated(accountUser(row))
      Completed(establish(row, previous))
    }
  /** Replaces password and TOTP secret; keeps e-mail, admin flag and issued tokens. */
  private def redeemReset(active: ImperativeSettings, reset: StoredEnrollment, credentials: NewCredentials, hash: String, secret: Array[Byte],
    step: Long, previous: Option[String], at: Instant): AccountOutcome[SignedIn] =
    repository.user(reset.username).filter(_.status == AccountStatus.Active) match {
      case None => refuse(NotFound)
      case Some(row) if credentials.password.equalsIgnoreCase(row.email) => refuse(WeakPassword)
      case Some(row) =>
        val replaced = store(row.copy(passwordHash = hash, totp = active.vault.seal(row.id, secret), totpLastStep = math.max(row.totpLastStep, step),
          totpRequired = credentials.requireTotp, passwordFailures = FailureCounter.Clear, totpFailures = FailureCounter.Clear,
          recoveryFailures = FailureCounter.Clear, credentialsAt = at), at)
        repository.deleteEnrollment(reset.id)
        sessions.revokeSessions(row.id, None)
        sessions.updated(accountUser(replaced))
        Completed(establish(replaced, previous))
    }

  // ---- authenticated operations: a live browser session, revalidated under its owner's lock ----

  private def withLiveActor[A](session: AccountCredential, directory: Boolean, targets: Vector[String])(
    body: (Actor, Instant) => AccountOutcome[A]): AccountOutcome[A] = {
    if (!session.browser) refuse(Forbidden)
    else {
      acquire(directory, Some(session.userId), None, targets)
      val actor = if (!sessions.live(session)) None else enabledActor(session.userId)
      actor.fold[AccountOutcome[A]](refuse(Unauthorized))(found => body(found, now))
    }
  }
  /** An enabled declared user, or an active imperative user while the master switch is on, with its effective admin flag. */
  private def enabledActor(userId: String): Option[Actor] = declared.user(userId) match {
    case Some(user) => Option.when(user.enabled)(Actor(user, None, declared.admins(user.id)))
    case None => settings.flatMap(_ => repository.user(userId)).filter(_.status == AccountStatus.Active)
      .map(row => Actor(accountUser(row), Some(row), row.admin))
  }
  /** The effective admin flag of an account, by the rule of the authenticated operations: the declared flag of an
    * enabled declared user, or the flag of an active imperative user while the master switch is on; false for anyone
    * else. A read in the caller's transaction, without locks; whether a session of the account is live is the caller's. */
  def administrator(userId: String): Boolean = enabledActor(userId).exists(_.admin)
  private def authenticated[A](session: AccountCredential, directory: Boolean, targets: Vector[String])(
    body: (ImperativeSettings, Actor, Instant) => AccountOutcome[A]): AccountOutcome[A] = whenOn { active =>
    withLiveActor(session, directory, targets)((actor, at) => body(active, actor, at))
  }
  /** Self-service applies to active imperative users only; a declarative session is `forbidden`. */
  private def selfService[A](session: AccountCredential)(body: (ImperativeSettings, StoredImperativeUser, Instant) => AccountOutcome[A]): AccountOutcome[A] =
    authenticated(session, directory = false, Vector.empty)((active, actor, at) => actor.row.fold[AccountOutcome[A]](refuse(Forbidden))(row => body(active, row, at)))
  /** Effective admin = declarative flag or the flag of an active imperative row, read inside this transaction. */
  private def administered[A](session: AccountCredential, directory: Boolean, targets: Vector[String])(
    body: (ImperativeSettings, Actor, Instant) => AccountOutcome[A]): AccountOutcome[A] =
    authenticated(session, directory, targets) { (active, actor, at) =>
      if (!actor.admin) refuse(Forbidden)
      else {
        if (directory) repository.deleteExpiredEnrollments(at)
        body(active, actor, at)
      }
    }
  private def totpState(active: ImperativeSettings, row: StoredImperativeUser): TotpState = opened(active, row) match {
    case Some(secret) => java.util.Arrays.fill(secret, 0.toByte); TotpState.Ok
    case None => TotpState.Unavailable
  }

  def profile(session: AccountCredential): AccountOutcome[AccountProfile] = authenticated(session, directory = false, Vector.empty) { (active, actor, _) =>
    Completed(AccountProfile(actor.user, actor.admin, actor.row.map(row => ProfileDetails(row.email, row.totpRequired, totpState(active, row)))))
  }

  def changeEmail(session: AccountCredential, email: String): AccountOutcome[Unit] = selfService(session) { (_, row, at) =>
    if (!validEmail(email)) refuse(Invalid)
    else {
      store(row.copy(email = email), at)
      Completed(())
    }
  }

  /** Deletes every session of the account and answers with a fresh one for the caller. */
  def changePassword(session: AccountCredential, currentPassword: String, newPassword: String): AccountOutcome[SignedIn] = selfService(session) { (_, row, at) =>
    if (!validPassword(newPassword, row.id, Some(row.email))) refuse(WeakPassword)
    else passwordProof(row, currentPassword, ProofRejected, at) match {
      case Left(rejected) => rejected
      case Right(proven) =>
        val changed = store(proven.copy(passwordHash = hashPassword(newPassword), credentialsAt = at), at)
        sessions.revokeSessions(row.id, None)
        sessions.updated(accountUser(changed))
        Completed(establish(changed, None))
    }
  }

  /** `currentTotp` is given exactly when mandatory TOTP is on (design D23): then the secret can be replaced
    * only with a code from the current authenticator.
    */
  def replaceTotp(session: AccountCredential, currentPassword: String, totpSecret: String, totpCode: String,
    currentTotp: Option[String]): AccountOutcome[Unit] = selfService(session) { (active, row, at) =>
    if (row.totpRequired != currentTotp.nonEmpty) refuse(Invalid)
    else outcome(for {
      replacement <- secretProof(totpSecret, totpCode, at)
      proven <- passwordProof(row, currentPassword, ProofRejected, at)
      consumed <- currentTotp.fold[Checked[Long]](Right(proven.totpLastStep))(code => codeProof(active, proven, code, FailurePath.Totp, ProofRejected, at))
    } yield {
      // Every step accepted here is spent, whichever secret it was for: the new secret may equal the old one.
      store(proven.copy(totp = active.vault.seal(row.id, replacement._1), totpLastStep = Vector(proven.totpLastStep, replacement._2, consumed).max,
        totpFailures = FailureCounter.Clear, recoveryFailures = FailureCounter.Clear, credentialsAt = at), at)
      ()
    })
  }

  /** Both directions need a current code. Turning it on deletes every other session of the account. */
  def setTotpRequired(session: AccountCredential, required: Boolean, totp: String): AccountOutcome[Unit] = selfService(session) { (active, row, at) =>
    codeProof(active, row, totp, FailurePath.Totp, ProofRejected, at) match {
      case Left(rejected) => rejected
      case Right(step) =>
        store(row.copy(totpLastStep = step, totpRequired = required), at)
        if (required) sessions.revokeSessions(row.id, Some(session))
        Completed(())
    }
  }

  // ---- indexing preferences, independent of the imperative-accounts lifecycle controls ----

  private[auth] def indexingProfile(session: AccountCredential, preferences: IndexingPreferences): AccountOutcome[IndexingAccountProfile] =
    withLiveActor(session, directory = false, Vector.empty) { (actor, _) =>
      Completed(IndexingAccountProfile(actor.user.id, actor.admin, preferences.get(actor.user.id)))
    }

  private[auth] def setIndexingChoice(session: AccountCredential, choice: IndexingChoice, policy: IndexingPolicy,
    preferences: IndexingPreferences): AccountOutcome[(IndexingAccountProfile, Boolean)] =
    withLiveActor(session, directory = false, Vector.empty) { (actor, _) =>
      val owner = actor.user.id
      preferences.lock(owner)
      val current = preferences.get(owner)
      // Inherit clears the user's exception to the operator default, not an explicit opt-in or opt-out.
      val allowed = choice.setting.fold(current.overrideChoice == IndexingChoice.Inherit)(policy.permitsOpt(_, current.overrideChoice))
      if (!allowed) refuse(Forbidden)
      else {
        val changed = current.choice != choice
        val saved = if (changed) preferences.setChoice(owner, choice) else current
        Completed((IndexingAccountProfile(owner, actor.admin, saved), changed))
      }
    }

  /** Configured humans and agents and all imperative owners that have ever been active. Neither opting out
    * nor suspending/disabling an imperative account removes it from indexing administration. */
  private[auth] def indexingUsers(session: AccountCredential, preferences: IndexingPreferences): AccountOutcome[Vector[IndexingAccountUser]] =
    withLiveActor(session, directory = true, Vector.empty) { (actor, _) =>
      if (!actor.admin) refuse(Forbidden)
      else {
        val stored = repository.users.filter(_.status != AccountStatus.Pending).sortBy(_.id).map(accountUser)
        Completed((declared.users ++ stored).map(user => IndexingAccountUser(user.id, user.displayName, preferences.get(user.id))))
      }
    }

  private[auth] def setIndexingOverride(session: AccountCredential, id: String, choice: IndexingChoice, currentPassword: String,
    preferences: IndexingPreferences): AccountOutcome[Boolean] = {
    // The exact public ID may be wider than a username (or a PostgreSQL text key for Manure). Only a
    // configured ID or an imperative username may be passed to an account lock or storage lookup.
    val targets = Vector(id).filter(target => declared.contains(target) || validUsername(target))
    withLiveActor(session, directory = true, targets) { (actor, at) =>
      if (!actor.admin) refuse(Forbidden)
      else {
        val targetExists = declared.contains(id) || (validUsername(id) && repository.user(id).exists(_.status != AccountStatus.Pending))
        if (!targetExists) refuse(NotFound)
        else outcome(freshProof(actor, currentPassword, at).map { _ =>
          preferences.lock(id)
          val changed = preferences.get(id).overrideChoice != choice
          if (changed) preferences.setOverride(id, choice)
          changed
        })
      }
    }
  }

  // ---- administration ----

  /** Design §4.6.3: the acting admin's current password, against the configured hash or the admin's own row. */
  private def freshProof(actor: Actor, currentPassword: String, at: Instant): Checked[Unit] = actor.row match {
    case Some(row) => passwordProof(row, currentPassword, ProofRejected, at).map(_ => ())
    case None => Either.cond(actor.user.passwordHash.exists(verifyPassword(currentPassword, _)), (), refuse(ProofRejected))
  }
  /** Declarative accounts are immutable through the API. */
  private def target(id: String): Checked[StoredImperativeUser] =
    if (declared.contains(id)) Left(refuse(Forbidden)) else repository.user(id).toRight(refuse(NotFound))
  private def applicant(id: String): Checked[StoredImperativeUser] = target(id).filterOrElse(_.status == AccountStatus.Pending, refuse(NotFound))
  /** Flag and enabled changes: an imperative account that has been active, other than the actor. */
  private def managed(actor: Actor, id: String): Checked[StoredImperativeUser] =
    target(id).filterOrElse(row => row.id != actor.user.id && row.status != AccountStatus.Pending, refuse(Forbidden))

  def listUsers(session: AccountCredential): AccountOutcome[Vector[ListedAccount]] = administered(session, directory = true, Vector.empty) { (active, _, at) =>
    val pending = repository.enrollments.map(row => row.username -> row.kind).toMap
    val configured = declared.users.map(user => ListedAccount(user.id, user.login, user.displayName, user.userType, user.origin,
      if (user.enabled) AccountStatus.Active else AccountStatus.Disabled, declared.admins(user.id), None))
    val stored = repository.users.sortBy(_.id).map { row =>
      val locked = FailurePath.values.exists(path => LockSchedule.of(path).lockedUntil(row.counter(path), at).nonEmpty)
      ListedAccount(row.id, Some(row.id), row.id, "human", AccountOrigin.Imperative, row.status, row.admin, Some(ListedDetails(row.email,
        row.createdAt, row.createdVia, row.createdBy, row.approvedBy, row.totpRequired, totpState(active, row), locked, pending.get(row.id))))
    }
    Completed(configured ++ stored)
  }

  /** Re-checks the namespace: configuration or data may have claimed the name since the signup. */
  def approve(session: AccountCredential, id: String): AccountOutcome[Unit] = administered(session, directory = true, Vector(id)) { (_, actor, at) =>
    applicant(id) match {
      case Left(rejected) => rejected
      case Right(row) if claimed(row.id) => refuse(UsernameUnavailable)
      case Right(row) =>
        sessions.activated(accountUser(store(row.copy(status = AccountStatus.Active, approvedBy = Some(actor.user.id), approvedAt = Some(at)), at)))
        Completed(())
    }
  }

  /** Deletes the application: it never held authority, so its name is free again. */
  def reject(session: AccountCredential, id: String): AccountOutcome[Unit] = administered(session, directory = true, Vector(id)) { (_, _, _) =>
    outcome(applicant(id).map(row => repository.deleteUser(row.id)))
  }

  /** Disabling deletes the sessions, revokes the tokens and deletes the pending reset; name and data stay. */
  def setEnabled(session: AccountCredential, id: String, enabled: Boolean): AccountOutcome[Unit] = administered(session, directory = true, Vector(id)) { (_, actor, at) =>
    managed(actor, id) match {
      case Left(rejected) => rejected
      case Right(row) if (row.status == AccountStatus.Active) == enabled => Completed(())
      case Right(row) if enabled =>
        sessions.updated(accountUser(store(row.copy(status = AccountStatus.Active), at)))
        Completed(())
      case Right(row) =>
        val disabled = store(row.copy(status = AccountStatus.Disabled), at)
        sessions.revokeSessions(row.id, None)
        sessions.revokeTokens(row.id)
        repository.enrollments.filter(_.username == row.id).foreach(pending => repository.deleteEnrollment(pending.id))
        sessions.updated(accountUser(disabled))
        Completed(())
    }
  }

  def setAdmin(session: AccountCredential, id: String, admin: Boolean, currentPassword: String): AccountOutcome[Unit] =
    administered(session, directory = false, Vector(id)) { (_, actor, at) =>
      outcome(for {
        _ <- freshProof(actor, currentPassword, at)
        row <- managed(actor, id)
      } yield {
        store(row.copy(admin = admin), at)
        ()
      })
    }

  /** The target's credentials stay valid until the code is redeemed. A self-reset is refused: it would
    * bypass the current-authenticator requirement of `replaceTotp`.
    */
  def issueReset(session: AccountCredential, id: String, currentPassword: String): AccountOutcome[IssuedEnrollment] =
    administered(session, directory = true, Vector(id)) { (active, actor, at) =>
      outcome(for {
        _ <- freshProof(actor, currentPassword, at)
        row <- managed(actor, id).filterOrElse(_.status == AccountStatus.Active, refuse(Forbidden))
      } yield issue(active, row.id, EnrollmentKind.Reset, actor.user.id, at))
    }

  def issueInvitation(session: AccountCredential, username: String): AccountOutcome[IssuedEnrollment] = whenOn { enrolling =>
    if (!enrolling.enrollment) refuse(NotFound)
    else if (!validUsername(username)) refuse(Invalid)
    else administered(session, directory = true, Vector.empty) { (active, actor, at) =>
      if (reserved(active, username) || claimed(username) || repository.user(username).nonEmpty) refuse(UsernameUnavailable)
      else Completed(issue(active, username, EnrollmentKind.Invite, actor.user.id, at))
    }
  }

  def listEnrollments(session: AccountCredential): AccountOutcome[Vector[ListedEnrollment]] = administered(session, directory = true, Vector.empty) { (active, _, _) =>
    Completed(repository.enrollments.filter(offered(active, _)).sortBy(row => (row.createdAt, row.id)).map(listed))
  }

  def revokeEnrollment(session: AccountCredential, id: String): AccountOutcome[Unit] = administered(session, directory = true, Vector.empty) { (active, _, _) =>
    repository.enrollments.find(row => row.id == id && offered(active, row)).fold[AccountOutcome[Unit]](refuse(NotFound)) { row =>
      repository.deleteEnrollment(row.id)
      Completed(())
    }
  }
}
private[auth] object ImperativeAccounts {
  /** `totp_last_step` of a secret that has accepted no step yet. */
  val NoStep: Long = -1L
}
