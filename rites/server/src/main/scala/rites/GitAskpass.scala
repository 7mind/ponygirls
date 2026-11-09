package rites

import java.nio.file.{Files, Path}

private[rites] object GitAskpass {
  // Preserve the entrypoint name: multicall executables dispatch using argv[0].
  private def executable(name: String, searchPath: String): Path = {
    searchPath.split(java.io.File.pathSeparator, -1).iterator.map(Path.of(_)).filter(_.isAbsolute)
      .map(_.resolve(name)).find(path => Files.isRegularFile(path) && Files.isExecutable(path))
      .getOrElse(throw DomainError("toolchain-unavailable", "required Git helper executable is unavailable")).normalize()
  }
  private def quote(path: Path): String = "'" + path.toString.replace("'", "'\\''") + "'"
  def render(credentialFile: Path, searchPath: String): String = {
    Check(credentialFile.isAbsolute, "invalid", "Git credential file must be absolute")
    val shell = executable("sh", searchPath)
    val cat = executable("cat", searchPath)
    s"#!$shell\ncase \"$$1\" in *Password*) exec ${quote(cat)} ${quote(credentialFile)};; *) exit 1;; esac\n"
  }
}
