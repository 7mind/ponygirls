ThisBuild / scalaVersion := "3.9.0"
ThisBuild / organization := "dev.chronicle"
ThisBuild / version := "0.1.0"
lazy val verifyBaboonRuntime = taskKey[Unit]("Verify domain runtime sources against the one canonical runtime")
lazy val baboonRuntime = project.in(file("shared/baboon-runtime")).settings(
  scalaVersion := "2.13.18",
  scalacOptions += "-Xsource:3",
  libraryDependencies ++= Seq("io.circe" %% "circe-core" % "0.14.17", "io.circe" %% "circe-parser" % "0.14.17")
)
def contractSettings = Seq(
  scalaVersion := "2.13.18",
  scalacOptions += "-Xsource:3",
  Compile / unmanagedSourceDirectories := Seq(baseDirectory.value.getParentFile / "scala"),
  Compile / unmanagedSources ~= (_.filterNot(f => f.getName.startsWith("Baboon") && f.getParentFile.getName == "scala")),
  verifyBaboonRuntime := {
    val canonical = (file("shared/baboon-runtime/src/main/scala") * "Baboon*.scala").get.sortBy(_.getName)
    val generated = (baseDirectory.value.getParentFile / "scala" * "Baboon*.scala").get.sortBy(_.getName)
    require(canonical.nonEmpty, "missing canonical Baboon runtime")
    // --runtime without is supported by pinned 0.0.198. With-runtime domains must
    // prove complete byte identity, not silently select duplicate class definitions.
    if (generated.nonEmpty) {
      require(canonical.map(_.getName) == generated.map(_.getName), "Baboon runtime file set differs")
      canonical.zip(generated).foreach { case (a,b) =>
        require(java.util.Arrays.equals(IO.readBytes(a), IO.readBytes(b)), "Baboon runtime differs: " + b)
      }
    }
    require(((baseDirectory.value.getParentFile / "scala") ** "*.scala").get.exists(f => !f.getName.startsWith("Baboon")), "missing generated domain sources")
  },
  Compile / compile := (Compile / compile).dependsOn(verifyBaboonRuntime).value
)
lazy val contracts = project.in(file("chronicle/generated/.build")).dependsOn(baboonRuntime).settings(contractSettings)
lazy val haystackContracts = project.in(file("haystack/generated/.build")).dependsOn(baboonRuntime).settings(contractSettings)
lazy val manureContracts = project.in(file("manure/generated/.build")).dependsOn(baboonRuntime).settings(contractSettings)
lazy val validationInventory = taskKey[File]("Write the discovered, unfiltered release test inventory")
// Libraries use only artifacts already present in the common dependency lock.
lazy val scala3LibrarySettings = Seq(
  Test / fork := true,
  Test / validationInventory := {
    val names = (Test / definedTests).value.map(_.name).sorted
    require(names.nonEmpty && names.distinct.size == names.size, "empty or duplicate foundation test inventory")
    val output = baseDirectory.value / "target" / "validation-inventory.txt"
    IO.writeLines(output, names)
    output
  },
  libraryDependencies += "org.scalameta" %% "munit" % "1.3.6" % Test
)
lazy val losslessJson = project.in(file("shared/lossless-json")).settings(scala3LibrarySettings).settings(
  name := "lossless-json"
)
lazy val manureStorage = project.in(file("manure/server")).settings(scala3LibrarySettings).settings(
  name := "manure-storage"
)
lazy val serviceDependencies = Seq(
  "io.7mind.izumi" %% "distage-core" % "1.2.25",
  "io.7mind.izumi" %% "distage-extension-plugins" % "1.2.25",
  "io.7mind.izumi" %% "distage-framework-api" % "1.2.25",
  "io.7mind.izumi" %% "logstage-core" % "1.2.25",
  "org.typelevel" %% "cats-effect" % "3.7.1" cross CrossVersion.for3Use2_13,
  "org.typelevel" % "scalac-compat-annotation_2.13" % "0.1.4",
  "org.http4s" %% "http4s-ember-server" % "0.23.38" cross CrossVersion.for3Use2_13,
  "org.http4s" %% "http4s-ember-client" % "0.23.38" cross CrossVersion.for3Use2_13,
  "org.http4s" %% "http4s-dsl" % "0.23.38" cross CrossVersion.for3Use2_13,
  "io.circe" %% "circe-core" % "0.14.17" cross CrossVersion.for3Use2_13,
  "io.circe" %% "circe-parser" % "0.14.17" cross CrossVersion.for3Use2_13,
  "io.circe" %% "circe-generic" % "0.14.17" cross CrossVersion.for3Use2_13,
  "org.postgresql" % "postgresql" % "42.7.14"
)
lazy val serviceSettings = scala3LibrarySettings ++ Seq(
  scalacOptions += "-Yretain-trees",
  Test / parallelExecution := false,
  libraryDependencies ++= serviceDependencies,
  assembly / assemblyMergeStrategy := {
    case PathList("META-INF", "services", _*) => MergeStrategy.concat
    case PathList("META-INF", "native-image", _*) => MergeStrategy.first
    case PathList("META-INF", _*) => MergeStrategy.discard
    case path if path.startsWith("baboon/runtime/") => MergeStrategy.deduplicate
    case _ => MergeStrategy.first
  }
)
lazy val serviceRuntime = project.in(file("shared/service-runtime")).settings(serviceSettings).settings(name := "service-runtime")
lazy val modelHttp = project.in(file("shared/model-http")).dependsOn(serviceRuntime).settings(serviceSettings).settings(name := "model-http")
lazy val retrievalCore = project.in(file("shared/retrieval-core")).settings(scala3LibrarySettings).settings(name := "retrieval-core")
lazy val retrievalPostgres = project.in(file("shared/retrieval-postgres")).dependsOn(serviceRuntime, retrievalCore).settings(serviceSettings).settings(name := "retrieval-postgres")
lazy val haystackServer = project.in(file("haystack/server")).dependsOn(haystackContracts, serviceRuntime, losslessJson, modelHttp, retrievalCore, retrievalPostgres).settings(serviceSettings).settings(
  name := "haystack-server",
  Compile / mainClass := Some("haystack.Main"),
  assembly / mainClass := Some("haystack.Main"),
  assembly / assemblyJarName := "haystack-server.jar",
  assembly / assemblyOutputPath := baseDirectory.value / "target/haystack-server.jar"
)
lazy val manureServer = project.in(file("manure/backend")).dependsOn(manureContracts, manureStorage, serviceRuntime, modelHttp, retrievalCore, retrievalPostgres).settings(serviceSettings).settings(
  name := "manure-server",
  Compile / mainClass := Some("manure.Main"),
  assembly / mainClass := Some("manure.Main"),
  assembly / assemblyJarName := "manure-server.jar",
  assembly / assemblyOutputPath := baseDirectory.value / "target/manure-server.jar"
)
lazy val root = project.in(file(".")).aggregate(baboonRuntime, contracts, chronicleServer, losslessJson, manureStorage, serviceRuntime, modelHttp, retrievalCore, retrievalPostgres, haystackContracts, manureContracts, haystackServer, manureServer).settings(
  name := "backend-foundation",
  publish / skip := true
)
lazy val chronicleServer = project.in(file("chronicle")).dependsOn(contracts, serviceRuntime, modelHttp, retrievalCore, retrievalPostgres).settings(
  name := "chronicle-server",
  // PostgreSQL suites truncate shared tables and mutate profile state.
  Test / parallelExecution := false,
  // Tests use Chronicle-relative fixture/config paths. Forking keeps the real
  // process cwd at this project's base, rather than the common build root.
  Test / fork := true,
  Compile / run / fork := true,
  Test / validationInventory := {
    val names = (Test / definedTests).value.map(_.name).sorted
    require(names.nonEmpty && names.distinct.size == names.size, "empty or duplicate release test inventory")
    val output = baseDirectory.value / "target" / "validation-inventory.txt"
    IO.writeLines(output, names)
    output
  },
  scalacOptions += "-Yretain-trees",
  Compile / unmanagedSourceDirectories ++= Seq(baseDirectory.value / "server/src/main/scala"),
  Test / unmanagedSourceDirectories += baseDirectory.value / "server/src/test/scala",
  Compile / unmanagedResourceDirectories ++= Seq(baseDirectory.value / "server/src/main/resources", baseDirectory.value / "migrations"),
  Compile / mainClass := Some("chronicle.Main"),
  assembly / mainClass := Some("chronicle.Main"),
  assembly / assemblyJarName := "chronicle-server.jar",
  assembly / assemblyOutputPath := baseDirectory.value / "target/chronicle-server.jar",
  assembly / assemblyMergeStrategy := { case PathList("META-INF", "services", _*) => MergeStrategy.concat; case PathList("META-INF", "native-image", _*) => MergeStrategy.first; case PathList("META-INF", _*) => MergeStrategy.discard; case path if path.startsWith("baboon/runtime/") => MergeStrategy.deduplicate; case _ => MergeStrategy.first },
  libraryDependencies ++= Seq(
    "io.7mind.izumi" %% "distage-core" % "1.2.25",
    "io.7mind.izumi" %% "distage-extension-plugins" % "1.2.25",
    "io.7mind.izumi" %% "distage-framework-api" % "1.2.25",
    "io.7mind.izumi" %% "logstage-core" % "1.2.25",
    "org.typelevel" %% "cats-effect" % "3.7.1" cross CrossVersion.for3Use2_13,
    "org.typelevel" % "scalac-compat-annotation_2.13" % "0.1.4",
    "org.http4s" %% "http4s-ember-server" % "0.23.38" cross CrossVersion.for3Use2_13,
    "org.http4s" %% "http4s-ember-client" % "0.23.38" cross CrossVersion.for3Use2_13,
    "org.http4s" %% "http4s-dsl" % "0.23.38" cross CrossVersion.for3Use2_13,
    "io.circe" %% "circe-core" % "0.14.17" cross CrossVersion.for3Use2_13,
    "io.circe" %% "circe-parser" % "0.14.17" cross CrossVersion.for3Use2_13,
    "io.circe" %% "circe-generic" % "0.14.17" cross CrossVersion.for3Use2_13,
    "org.postgresql" % "postgresql" % "42.7.14",
    "org.scalameta" %% "munit" % "1.3.6" % Test
  )
)
