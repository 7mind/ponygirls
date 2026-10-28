ThisBuild / scalaVersion := "3.9.0"
ThisBuild / organization := "dev.chronicle"
ThisBuild / version := "0.1.0"
lazy val contracts = project.in(file("generated/.build")).settings(
  scalaVersion := "2.13.18",
  scalacOptions += "-Xsource:3",
  Compile / unmanagedSourceDirectories := Seq(baseDirectory.value.getParentFile / "scala"),
  libraryDependencies ++= Seq("io.circe" %% "circe-core" % "0.14.17", "io.circe" %% "circe-parser" % "0.14.17")
)
lazy val validationInventory = taskKey[File]("Write the discovered, unfiltered release test inventory")
lazy val root = project.in(file(".")).dependsOn(contracts).settings(
  name := "chronicle-server",
  // PostgreSQL suites truncate shared tables and mutate profile state.
  Test / parallelExecution := false,
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
  assembly / assemblyMergeStrategy := { case PathList("META-INF", "services", _*) => MergeStrategy.concat; case PathList("META-INF", "native-image", _*) => MergeStrategy.first; case PathList("META-INF", _*) => MergeStrategy.discard; case _ => MergeStrategy.first },
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
