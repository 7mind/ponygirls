package rites

import distage.{ModuleDef, Roots}
import java.nio.file.Files
import rites.plugins.RuntimeServices

final class WiringTest extends munit.FunSuite {
  test("production distage graph is complete without classpath scanning") {
    val config = StoreFixture.config(Files.createTempDirectory("rites-wiring"))
    val module = new ModuleDef {
      include(plugins.RitesPlugin)
      make[Config].fromValue(config)
      make[RuntimeModels].fromValue(RuntimeModels(Nil))
    }
    val plan = ponygirls.runtime.CatsIOInjector().plan(module, Roots.target[RuntimeServices]).getOrThrow()
    assert(plan.render().contains("RuntimeServices"))
  }
}
