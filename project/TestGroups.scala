import sbt.*
import sbt.Keys.*

/** A suite that gets a test group of its own while groups remain; `reason` records why it is slow. */
final case class IsolatedSuite(name: String, reason: String)

/** Grouped test run: group i forks its own test JVM against `databases(i)`, a JDBC URL no other group uses. */
final case class TestGrouping(databases: Seq[String], seed: Long) {
  require(databases.nonEmpty && databases.distinct.size == databases.size, "test groups need distinct databases")
}

object TestGroups {
  /** Partitions suites into at most `groupCount` groups. While groups remain, each isolated suite gets its own group; all
    * other suites go round-robin over the rest, in sorted order (seed 0) or shuffled by `seed`. Inside a group, suites keep
    * their order in `tests` (the serial run's order), so no pair runs in an order the serial run does not use. Fails unless
    * every suite is in exactly one group. */
  def assign(tests: Seq[TestDefinition], isolated: Seq[IsolatedSuite], groupCount: Int, seed: Long): Seq[Seq[TestDefinition]] = {
    require(groupCount >= 1, "test group count must be positive")
    val names = tests.map(_.name)
    require(names.nonEmpty && names.distinct.size == names.size, "empty or duplicate test inventory")
    val isolatedNames = isolated.map(_.name)
    require(isolatedNames.distinct.size == isolatedNames.size, "duplicate isolated suite")
    val undiscovered = isolatedNames.filterNot(names.toSet)
    require(undiscovered.isEmpty, "isolated suites not discovered: " + undiscovered.mkString(", "))
    val others = names.filterNot(isolatedNames.toSet).sorted
    val ordered = if (seed == 0L) others else new scala.util.Random(seed).shuffle(others)
    val (dedicated, shared) = if (groupCount > isolatedNames.size) (isolatedNames, ordered) else (Nil, isolatedNames ++ ordered)
    val sharedCount = groupCount - dedicated.size
    val roundRobin = (0 until sharedCount).map(g => shared.zipWithIndex.collect { case (name, i) if i % sharedCount == g => name })
    val position = names.zipWithIndex.toMap
    val byName = tests.map(test => test.name -> test).toMap
    val groups = (dedicated.map(Seq(_)) ++ roundRobin).filter(_.nonEmpty).map(_.sortBy(position).map(byName))
    val grouped = groups.flatten.map(_.name)
    require(grouped.sorted == names.sorted, "test groups must contain every discovered suite exactly once")
    groups
  }
}

/** Settings that run `Test` as concurrent forked groups: group i is one test JVM whose environment variable `databaseVariable`
  * is `grouping.databases(i)`. Suites inside a group stay serial. A group holding a `serial` suite runs while no other task runs
  * (for suites whose own deadlines are CPU-bound, such as a child JVM that must finish within seconds). */
object TestGroupSettings {
  private val ExclusiveGroup = Tags.Tag("exclusive-test-group")

  def apply(grouping: TestGrouping, groupPrefix: String, isolated: Seq[IsolatedSuite], serial: Seq[IsolatedSuite], databaseVariable: String): Seq[Setting[?]] = Seq(
    Test / testGrouping := Def.uncached {
      val tests = (Test / definedTests).value
      val fork = (Test / forkOptions).value
      val log = streams.value.log
      val groups = TestGroups.assign(tests, isolated, grouping.databases.size, grouping.seed)
      def exclusive(group: Seq[TestDefinition]) = group.exists(test => serial.exists(_.name == test.name))
      val (alone, concurrent) = groups.partition(exclusive)
      (concurrent ++ alone).zipWithIndex.map { case (group, i) =>
        val name = groupPrefix + "-g" + i
        log.info(name + ": " + group.map(_.name).mkString(" "))
        val tags = if (exclusive(group)) Seq(ExclusiveGroup -> 1) else Nil
        Tests.Group(name, group, Tests.SubProcess(fork.withEnvVars(fork.envVars.updated(databaseVariable, grouping.databases(i)))), tags)
      }
    },
    Test / parallelExecution := true,
    Test / testForkedParallel := false,
    // sbt 2.0.12 defaultRestrictions with the forked-test-group limit (default 1) raised to the group count.
    Global / concurrentRestrictions := Seq(Tags.limitAll(EvaluateTask.SystemProcessors), Tags.limit(Tags.ForkedTestGroup, grouping.databases.size), Tags.exclusiveGroup(Tags.Clean), Tags.exclusive(ExclusiveGroup))
  )
}
