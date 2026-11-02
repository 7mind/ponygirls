package manure.storage

import java.io.IOException
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.*
import scala.jdk.CollectionConverters.*
import scala.util.Using

/** Synthetic standalone JVM/native entrypoint using the actual implementation, no MUnit.
  * Exit 2 means exercised capabilities passed but full durable activation was refused.
  * Any unexpected exception/assertion exits unsuccessfully without the REFUSED marker.
  */
object FilesystemCapabilityProbe:
  def main(args: Array[String]): Unit =
    require(args.isEmpty, "no paths/arguments accepted: synthetic temporary storage only")
    println(s"RUNTIME: ${System.getProperty("java.vm.name")} ${System.getProperty("java.version")}")
    // Refuse unsupported native providers before even provisioning synthetic payload dirs.
    ConfinedDirectory.checkProvider(Path.of("."))
    val temp = Files.createTempDirectory("manure-capability-probe-")
    try
      val root = Files.createDirectory(temp.resolve("root"))
      val outside = Files.createDirectory(temp.resolve("outside"))
      val sentinel = Files.writeString(outside.resolve("sentinel"), "untouched")
      Files.createDirectories(root.resolve("staging/id/tree/資料"))
      Files.createDirectory(root.resolve("live"))
      val source = RelativeName.parse("staging/id/tree/資料/馬💩.txt")
      Using.resource(ConfinedDirectory.open(root)) { directory =>
        Using.resource(directory.createFile(source)) { file =>
          val payload = "hello 馬".getBytes(UTF_8)
          file.write(0, payload)
          file.forceFile()
          assert(file.read(0, 100).toVector == payload.toVector)
        }
        directory.forceDirectory(RelativeName.parse("staging/id/tree/資料"))
        directory.forceDirectory(RelativeName.parse("staging/id/tree"))
        directory.move(RelativeName.parse("staging/id/tree"), RelativeName.parse("live/id"))
        directory.forceDirectory(RelativeName.parse("staging/id"))
        directory.forceDirectory(RelativeName.parse("live"))
        directory.forceRootDirectory()
        assert(Files.readString(root.resolve("live/id/資料/馬💩.txt")) == "hello 馬")
        Files.createSymbolicLink(root.resolve("live/id/escape"), outside)
        expectIOException {
          val escaped = directory.createFile(RelativeName.parse("live/id/escape/new"))
          escaped.close()
        }
        directory.removeTree(RelativeName.parse("live/id"), 100, 16)
        assert(Files.readString(sentinel) == "untouched")
        assert(!Files.exists(outside.resolve("new")))
        Files.move(root, temp.resolve("old-root"))
        Files.createDirectory(root)
        try
          directory.createFile(RelativeName.parse("must-not-exist")).close()
          throw new AssertionError("replacement root was accepted")
        catch case _: RootReplaced => ()
        assert(!Files.exists(root.resolve("must-not-exist")))
        println("PASS: descriptor IO/file force, descriptor-dot directory force, Unicode, atomic move, no-follow, non-traversing cleanup, root replacement")
        try
          directory.requireDurableStore()
          throw new AssertionError("durable-store gate unexpectedly passed")
        catch
          case missing: MissingPrimitive =>
            assert(missing.primitives == ConfinedDirectory.missingPrimitives)
            println(s"REFUSED: ${missing.getMessage}")
      }
    finally
      Using.resource(Files.walk(temp)) { entries =>
        entries.iterator().asScala.toVector.sortBy(_.getNameCount).reverse.foreach(Files.deleteIfExists(_))
      }
    System.exit(2)

  private def expectIOException(body: => Unit): Unit =
    try
      body
      throw new AssertionError("symlink parent was accepted")
    catch case _: IOException => ()
