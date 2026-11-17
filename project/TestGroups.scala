import sbt.TestDefinition

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
