{ lib }:
let
  runtimePath = path:
    lib.hasPrefix "/" path
    && path != builtins.storeDir
    && !(lib.hasPrefix "${builtins.storeDir}/" path);
  usernamePattern = "[a-z][a-z0-9_-]{2,31}";
  issuerPattern = "[^:[:cntrl:]]{1,64}";
  defaultMaxUsers = 100;
  defaultEnrollmentTtlSeconds = 24 * 60 * 60;
in
{
  browserOptions = {
    enabled = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether this declarative account may authenticate. Disabling invalidates its browser sessions and issued access tokens.";
    };
    login = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Human browser login, paired with passwordHashFile. Preserved exactly, without trimming or case normalization; unique across all accounts, including disabled accounts.";
    };
    passwordHashFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Absolute runtime file containing a Chronicle-compatible pbkdf2-sha256 password hash (600000–2000000 rounds, 16-byte salt, 32-byte derived key, standard Base64). Paired with login and human-only. Use a secret-manager string path, never a Nix path value, plaintext password, hash value or Nix-store file.";
    };
    admin = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Account administrator for imperative accounts (approval, enable/disable, admin flags, credential resets). Requires a human account with a browser login. Inert while accounts.enable is false.";
    };
  };
  # Imperative accounts (self-signup, admin enrollment). The master switch is
  # explicit and never derived from the creation flags.
  accountsOptions = { serviceName, host }: {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Master switch for imperative accounts: their login, recovery, profile and admin management, and acceptance of their sessions and tokens. Turning it off suspends (never revokes) every imperative account. Never derived from signup.enable or enrollment.enable.";
    };
    keyFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Absolute runtime file holding the base64url encoding of 32 random bytes that encrypts TOTP secrets at rest. Required when enable is true; a secret-manager string path, never a Nix path value or Nix-store file.";
    };
    signup = {
      enable = lib.mkOption { type = lib.types.bool; default = false; description = "Self-registration (requires enable)."; };
      requireApproval = lib.mkOption { type = lib.types.bool; default = true; description = "New self-registered accounts stay pending until an admin approves them."; };
      maxUsers = lib.mkOption { type = lib.types.ints.between 1 1000; default = defaultMaxUsers; description = "Upper bound on imperative account rows, including pending applications."; };
    };
    enrollment = {
      enable = lib.mkOption { type = lib.types.bool; default = false; description = "Admin-issued invitation links (requires enable). Credential resets are available whenever enable is true."; };
      ttlSeconds = lib.mkOption { type = lib.types.ints.between 300 604800; default = defaultEnrollmentTtlSeconds; description = "Lifetime of an enrollment code."; };
    };
    issuer = lib.mkOption {
      type = lib.types.strMatching issuerPattern;
      default = if host == null then serviceName else "${serviceName} (${host})";
      defaultText = lib.literalExpression ''"${serviceName} (<public host>)"'';
      description = "TOTP issuer shown by authenticator apps: 1–64 printable characters without a colon.";
    };
    reservedUsernames = lib.mkOption {
      type = lib.types.listOf (lib.types.strMatching usernamePattern);
      default = [ ];
      description = "Usernames that self-signup and enrollment refuse, in addition to every declared id and login.";
    };
  };
  accountsAssertions = { context, settings, users, keyFile, origin }: [
    {
      assertion = settings.enable || !(settings.signup.enable || settings.enrollment.enable);
      message = "${context}: accounts.signup.enable and accounts.enrollment.enable require accounts.enable. The master switch is never derived from them: set it explicitly, and keep it set when turning signup or enrollment off, otherwise existing imperative accounts are suspended.";
    }
    {
      assertion = !settings.enable || (keyFile != null && runtimePath keyFile);
      message = "${context}: accounts.enable requires accounts.keyFile to be an absolute runtime path outside the Nix store.";
    }
    {
      assertion = !settings.enable || lib.any (u: u.enabled && u.admin) (builtins.attrValues users);
      message = "${context}: accounts.enable requires at least one enabled declarative admin (users.<id>.admin) to approve applications and reset credentials.";
    }
    {
      assertion = !settings.enable || origin != null;
      message = "${context}: accounts.enable requires the public origin (enrollment links and the default issuer).";
    }
  ];
  # Server JSON key names (design §6.1): Haystack and Chronicle use camelCase,
  # Manure snake_case top-level keys.
  accountsJsonKeys = {
    camel = { keyFile = "keyFile"; requireApproval = "requireApproval"; maxUsers = "maxUsers"; ttlSeconds = "ttlSeconds"; reservedUsernames = "reservedUsernames"; };
    snake = { keyFile = "key_file"; requireApproval = "require_approval"; maxUsers = "max_users"; ttlSeconds = "ttl_s"; reservedUsernames = "reserved_usernames"; };
  };
  # Empty while the master switch is off, so the generated configuration
  # stays identical to the one before imperative accounts existed.
  renderAccounts = keys: settings: keyFile: lib.optionalAttrs settings.enable {
    accounts = {
      enabled = true;
      ${keys.keyFile} = keyFile;
      signup = {
        enabled = settings.signup.enable;
        ${keys.requireApproval} = settings.signup.requireApproval;
        ${keys.maxUsers} = settings.signup.maxUsers;
      };
      enrollment = {
        enabled = settings.enrollment.enable;
        ${keys.ttlSeconds} = settings.enrollment.ttlSeconds;
      };
      inherit (settings) issuer;
      ${keys.reservedUsernames} = settings.reservedUsernames;
    };
  };
  renderAdmin = settings: user: lib.optionalAttrs settings.enable { inherit (user) admin; };
  assertions = context: users:
    let
      values = builtins.attrValues users;
      logins = lib.filter (login: login != null) (map (u: u.login) values);
    in [
      {
        assertion = lib.all (u: (u.login == null) == (u.passwordHashFile == null)) values;
        message = "${context}: login and passwordHashFile must be configured together.";
      }
      {
        assertion = lib.all (u: u.login == null || (u.type == "human" && u.login != "")) values;
        message = "${context}: browser login/password credentials require a human account and a nonempty login.";
      }
      {
        assertion = lib.unique logins == logins;
        message = "${context}: browser logins must be unique, including disabled accounts.";
      }
      {
        assertion = lib.all (u: u.tokens != { } || (u.type == "human" && u.login != null && u.passwordHashFile != null)) values;
        message = "${context}: every account needs a configured token or a paired human browser login/passwordHashFile.";
      }
      {
        assertion = lib.all (u: !u.admin || (u.type == "human" && u.login != null && u.passwordHashFile != null)) values;
        message = "${context}: admin = true requires a human account with a browser login and passwordHashFile.";
      }
      {
        assertion = lib.all (u: u.passwordHashFile == null || runtimePath u.passwordHashFile) values;
        message = "${context}: passwordHashFile must be an absolute runtime path outside the Nix store.";
      }
    ];
  sanitizeId = value: lib.concatMapStrings
    (c: if builtins.match "[A-Za-z0-9_.-]" c != null then c else "_")
    (lib.stringToCharacters value);
}
