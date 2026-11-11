scalaVersion := "3.9.0"
organization := "dev.chronicle"
version := "0.1.0"
lazy val contractCoassembly = taskKey[File]("Coassemble five current generated domains with exactly one canonical compiled runtime")
lazy val verifySingleBaboonRuntime = taskKey[Unit]("Prove every Baboon runtime class has exactly one compiled classpath owner")
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
  verifyBaboonRuntime := Def.uncached {
    val canonical = (file("shared/baboon-runtime/src/main/scala") * "Baboon*.scala").get().sortBy(_.getName)
    val generated = (baseDirectory.value.getParentFile / "scala" * "Baboon*.scala").get().sortBy(_.getName)
    require(canonical.nonEmpty, "missing canonical Baboon runtime")
    // --runtime without is supported by pinned 0.0.198. With-runtime domains must
    // prove complete byte identity, not silently select duplicate class definitions.
    if (generated.nonEmpty) {
      require(canonical.map(_.getName) == generated.map(_.getName), "Baboon runtime file set differs")
      canonical.zip(generated).foreach { case (a,b) =>
        require(java.util.Arrays.equals(IO.readBytes(a), IO.readBytes(b)), "Baboon runtime differs: " + b)
      }
    }
    require(((baseDirectory.value.getParentFile / "scala") ** "*.scala").get().exists(f => !f.getName.startsWith("Baboon")), "missing generated domain sources")
  },
  Compile / compile := Def.uncached { (Compile / compile).dependsOn(verifyBaboonRuntime).value }
)
lazy val contracts = project.in(file("chronicle/generated/.build")).dependsOn(baboonRuntime).settings(contractSettings)
lazy val haystackContracts = project.in(file("haystack/generated/.build")).dependsOn(baboonRuntime).settings(contractSettings)
lazy val manureContracts = project.in(file("manure/generated/.build")).dependsOn(baboonRuntime).settings(contractSettings)
lazy val ritesContracts = project.in(file("rites/generated/.build")).dependsOn(baboonRuntime).settings(contractSettings)
lazy val ontologyContracts = project.in(file("ontology/generated/.build")).dependsOn(baboonRuntime).settings(contractSettings)
lazy val validationInventory = taskKey[File]("Write the discovered, unfiltered release test inventory")
lazy val testChildClasspath = taskKey[String]("Export the physical classpath for isolated test children")
// Libraries use only artifacts already present in the common dependency lock.
lazy val scala3LibrarySettings = Seq(
  cleanFiles += baseDirectory.value / "target",
  Test / fork := true,
  Test / testReportsDirectory := baseDirectory.value / "target" / "test-reports",
  Test / validationInventory := Def.uncached {
    val names = (Test / definedTests).value.map(_.name).sorted
    require(names.nonEmpty && names.distinct.size == names.size, "empty or duplicate foundation test inventory")
    val output = baseDirectory.value / "target" / "validation-inventory.txt"
    IO.writeLines(output, names)
    output
  },
  libraryDependencies += "org.scalameta" %% "munit" % "1.3.6" % Test
)
lazy val manureTestChildSettings = Seq(
  Test / testChildClasspath := Def.uncached {
    val converter = fileConverter.value
    val classpath = (Test / fullClasspath).value.map(entry => converter.toPath(entry.data).toString).mkString(java.io.File.pathSeparator)
    val exportStream = (Test / streams).value.text("export")
    try exportStream.println(classpath)
    finally exportStream.close()
    classpath
  },
  Test / javaOptions += "-Dmanure.test.childClasspath=" + (Test / testChildClasspath).value
)
lazy val losslessJson = project.in(file("shared/lossless-json")).settings(scala3LibrarySettings).settings(
  name := "lossless-json"
)
lazy val manureStorage = project.in(file("manure/server")).settings(scala3LibrarySettings ++ manureTestChildSettings).settings(
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
lazy val baboonAssemblySettings = Seq(
  // Scala 3 services deliberately consume the Scala 2.13 generated-code boundary.
  allowMismatchScala := true,
  verifySingleBaboonRuntime := Def.uncached {
    val converter = fileConverter.value
    val entries = (Compile / fullClasspath).value.map(entry => converter.toPath(entry.data).toFile).flatMap { entry =>
      val names = if (entry.isDirectory) (entry ** "*.class").get().flatMap(_.relativeTo(entry).map(_.getPath.replace('\\', '/')))
      else if (entry.getName.endsWith(".jar")) {
        val zip = new java.util.zip.ZipFile(entry)
        try {
          import scala.jdk.CollectionConverters.*
          zip.entries().asScala.map(_.getName).toVector
        } finally zip.close()
      } else Seq.empty
      names.filter(n => n.startsWith("baboon/runtime/") && n.endsWith(".class")).map(_ -> entry)
    }
    require(entries.nonEmpty, "no compiled Baboon runtime found")
    val owners = entries.groupBy(_._1)
    owners.foreach { case (name, found) => require(found.size == 1, "duplicate compiled Baboon runtime class: " + name + " in " + found.map(_._2).mkString(",")) }
    require(entries.map(_._2).distinct.size == 1, "Baboon runtime must come from exactly one compiled module")
    streams.value.log.info("Verified " + owners.size + " Baboon runtime classes from one owner: " + entries.head._2)
  },
  assembly := Def.uncached {
    val built = assembly.dependsOn(verifySingleBaboonRuntime).value
    val source = fileConverter.value.toPath(built).toFile
    val output = baseDirectory.value / "target" / (assembly / assemblyJarName).value
    IO.createDirectory(output.getParentFile)
    if (source != output) IO.copyFile(source, output)
    streams.value.log.info("Published assembly: " + output)
    built
  }
)
lazy val serviceRuntime = project.in(file("shared/service-runtime")).settings(serviceSettings).settings(name := "service-runtime")
lazy val modelHttp = project.in(file("shared/model-http")).dependsOn(serviceRuntime, retrievalCore).settings(serviceSettings).settings(name := "model-http")
lazy val retrievalCore = project.in(file("shared/retrieval-core")).settings(scala3LibrarySettings).settings(name := "retrieval-core", libraryDependencies ++= Seq("io.circe" %% "circe-core" % "0.14.17" cross CrossVersion.for3Use2_13, "io.circe" %% "circe-parser" % "0.14.17" cross CrossVersion.for3Use2_13))
lazy val retrievalPostgres = project.in(file("shared/retrieval-postgres")).dependsOn(serviceRuntime, retrievalCore, modelHttp).settings(serviceSettings).settings(name := "retrieval-postgres")
lazy val haystackServer = project.in(file("haystack/server")).dependsOn(haystackContracts, serviceRuntime, losslessJson, modelHttp, retrievalCore, retrievalPostgres).settings(serviceSettings ++ baboonAssemblySettings).settings(
  name := "haystack-server",
  Compile / unmanagedResourceDirectories += baseDirectory.value.getParentFile / "migrations",
  Compile / mainClass := Some("haystack.Main"),
  assembly / mainClass := Some("haystack.Main"),
  assembly / assemblyJarName := "haystack-server.jar"
)
lazy val manureServer = project.in(file("manure/backend")).dependsOn(manureContracts, manureStorage, serviceRuntime, modelHttp, retrievalCore, retrievalPostgres).settings(serviceSettings ++ baboonAssemblySettings ++ manureTestChildSettings).settings(
  name := "manure-server",
  Compile / mainClass := Some("manure.Main"),
  assembly / mainClass := Some("manure.Main"),
  assembly / assemblyJarName := "manure-server.jar"
)
lazy val ritesServer = project.in(file("rites/server")).dependsOn(ritesContracts, serviceRuntime).settings(serviceSettings ++ baboonAssemblySettings).settings(
  name := "rites-server",
  Compile / unmanagedResourceDirectories += baseDirectory.value.getParentFile / "migrations",
  Compile / mainClass := Some("rites.Main"),
  assembly / mainClass := Some("rites.Main"),
  assembly / assemblyJarName := "rites-server.jar",
)
lazy val ontologyServer = project.in(file("ontology/server")).dependsOn(ontologyContracts, serviceRuntime, losslessJson, modelHttp, retrievalCore, retrievalPostgres).settings(serviceSettings ++ baboonAssemblySettings).settings(
  name := "ontology-server",
  libraryDependencies ++= Seq(
    "org.eclipse.rdf4j" % "rdf4j-repository-sail" % "6.1.0",
    "org.eclipse.rdf4j" % "rdf4j-sail-memory" % "6.1.0",
    "org.eclipse.rdf4j" % "rdf4j-sail-nativerdf" % "6.1.0"
  ),
  Compile / unmanagedResourceDirectories ++= Seq(baseDirectory.value.getParentFile / "migrations", baseDirectory.value.getParentFile / "generated" / "wire"),
  Compile / mainClass := Some("ontology.Main"),
  assembly / mainClass := Some("ontology.Main"),
  assembly / assemblyJarName := "ontology-server.jar"
)
lazy val root = project.in(file(".")).aggregate(ontologyContracts, ontologyServer, baboonRuntime, contracts, chronicleServer, losslessJson, manureStorage, serviceRuntime, modelHttp, retrievalCore, retrievalPostgres, haystackContracts, manureContracts, ritesContracts, haystackServer, manureServer, ritesServer).settings(
  name := "backend-foundation",
  publish / skip := true,
  cleanFiles += baseDirectory.value / "target" / "contracts-coassembly.jar",
  contractCoassembly := Def.uncached {
    val compiled = Seq(
      (baboonRuntime / Compile / compile).value,
      (contracts / Compile / compile).value,
      (haystackContracts / Compile / compile).value,
      (manureContracts / Compile / compile).value,
      (ritesContracts / Compile / compile).value
    )
    val roots = Seq(
      (baboonRuntime / Compile / classDirectory).value,
      (contracts / Compile / classDirectory).value,
      (haystackContracts / Compile / classDirectory).value,
      (manureContracts / Compile / classDirectory).value,
      (ritesContracts / Compile / classDirectory).value
    )
    val files = roots.flatMap(root => (root ** "*.class").get().map(f => f -> f.relativeTo(root).get.getPath.replace('\\', '/')))
    val owners = files.groupBy(_._2)
    owners.foreach { case (name, found) => require(found.size == 1, "duplicate coassembled class: " + name) }
    val runtime = files.filter(_._2.startsWith("baboon/runtime/"))
    require(runtime.nonEmpty && runtime.forall(_._1.toPath.startsWith(roots.head.toPath)), "noncanonical compiled runtime owner")
    Seq("chronicle/api/", "haystack/api/", "manure/api/", "rites/api/", "rites/worker/").foreach(prefix => require(files.exists(_._2.startsWith(prefix)), "missing compiled domain: " + prefix))
    val output = baseDirectory.value / "target" / "contracts-coassembly.jar"
    IO.zip(files.sortBy(_._2), output, Some(315532800000L))
    streams.value.log.info("Coassembled all five current domains: " + files.size + " classes; " + runtime.size + " runtime classes from exactly one canonical owner")
    output
  }
)
lazy val chronicleServer = project.in(file("chronicle")).dependsOn(contracts, serviceRuntime, modelHttp, retrievalCore, retrievalPostgres).settings(serviceSettings ++ baboonAssemblySettings).settings(
  name := "chronicle-server",
  // PostgreSQL suites truncate shared tables and mutate profile state.
  Test / parallelExecution := false,
  // Tests use Chronicle-relative fixture/config paths. Forking keeps the real
  // process cwd at this project's base, rather than the common build root.
  Test / fork := true,
  Compile / run / fork := true,
  Compile / run / baseDirectory := baseDirectory.value,
  Test / validationInventory := Def.uncached {
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
  assembly / assemblyMergeStrategy := { case PathList("META-INF", "services", _*) => MergeStrategy.concat; case PathList("META-INF", "native-image", _*) => MergeStrategy.first; case PathList("META-INF", _*) => MergeStrategy.discard; case path if path.startsWith("baboon/runtime/") => MergeStrategy.deduplicate; case _ => MergeStrategy.first }
)
