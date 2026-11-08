package rites

import java.nio.file.Files

final class ModelConfigTest extends munit.FunSuite {
  private def modelFile(thinking: String): String = {
    val root = Files.createTempDirectory("rites-model-config")
    val path = root.resolve("model.json")
    Files.writeString(path, """{"provider":"fixture","modelsJson":{"providers":{"fixture":{"name":"Fixture","baseUrl":"https://model.example.invalid/v1","api":"anthropic-messages","models":[{"id":"fixture-model","name":"Fixture model","reasoning":true,"contextWindow":128000,"maxTokens":16384,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}]}}},"credential":{"type":"api_key","key":"fixture-model-secret"}}""")
    val selected = ModelConfig.load(ModelRef("model", "fixture", "fixture-model", thinking, path.toString), false)
    assertEquals(selected.publicInfo.thinkingLevel, thinking)
    JsonSupport.parse(Files.readString(path)).noSpaces
  }
  test("Pi thinking levels off and max match exact worker boundary") {
    modelFile("off"); modelFile("max")
  }
  test("selected provider API fragment is preserved without OpenAI synthesis") {
    val raw = JsonSupport.parse(modelFile("xhigh"))
    assertEquals(raw.hcursor.downField("modelsJson").downField("providers").downField("fixture").get[String]("api"), Right("anthropic-messages"))
  }
  test("server prompt bound cannot exceed worker 256KiB cap") {
    val config = StoreFixture.config(Files.createTempDirectory("rites-prompt-cap"))
    intercept[DomainError](config.copy(maxPromptBytes = 262145).validate())
  }
  test("public GitHub separates logical clone host from REST API host") {
    val forge = ForgeConfig(rites.api.ForgeKind.Github, "github.com", "https://api.github.com", "https://github.com")
    forge.parsed(false)
  }
  test("OAuth client metadata omits actual OAuth client id") {
    val config = StoreFixture.config(Files.createTempDirectory("rites-oauth-public"))
    val wire = JsonSupport.encode(rites.api.OAuthClientInfo.codecJson, config.oauthClients.head.publicInfo).noSpaces
    assert(!wire.contains("fixture-client-id"))
  }
}
