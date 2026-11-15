{ lib }:
let
  runtimePath = path:
    lib.hasPrefix "/" path
    && path != builtins.storeDir
    && !(lib.hasPrefix "${builtins.storeDir}/" path);
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
  };
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
        assertion = lib.all (u: u.passwordHashFile == null || runtimePath u.passwordHashFile) values;
        message = "${context}: passwordHashFile must be an absolute runtime path outside the Nix store.";
      }
    ];
  sanitizeId = value: lib.concatMapStrings
    (c: if builtins.match "[A-Za-z0-9_.-]" c != null then c else "_")
    (lib.stringToCharacters value);
}
