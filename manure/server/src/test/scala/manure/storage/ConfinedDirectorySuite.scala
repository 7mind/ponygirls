package manure.storage

import java.io.IOException
import java.nio.charset.StandardCharsets.UTF_8
import java.nio.file.*
import scala.jdk.CollectionConverters.*
import scala.util.Using

/** Specified-origin. Behavioral/Active; real temporary filesystem = Good Communication.
  * Public handle assertions are Blackbox; external sentinel/tree assertions are Effectual.
  * Deliberate replacements test deterministic boundaries, not probabilistic race coverage.
  * No fake OS: these cases depend on actual descriptors, links, rename and provider behavior.
  */
final class ConfinedDirectorySuite extends munit.FunSuite:
  private def name(value: String): RelativeName = RelativeName.parse(value)
  private def bytes(value: String): Array[Byte] = value.getBytes(UTF_8)

  private def fixture(body: Path => Unit): Unit =
    val temp = Files.createTempDirectory("manure-confined-test-")
    try body(temp)
    finally
      // Test-owned trusted top-level; Files.walk does not follow symlinks.
      Using.resource(Files.walk(temp)) { paths =>
        paths.iterator().asScala.toVector.sortBy(_.getNameCount).reverse.foreach(Files.deleteIfExists(_))
      }

  test("literal names reject all traversal syntax without normalization") {
    Vector("", "/a", "a/", "a//b", ".", "..", "a/../b", "a/./b", "a\\b", "a\u0000b").foreach { invalid =>
      intercept[IllegalArgumentException](name(invalid))
    }
    assertEquals(name("résumé/馬💩.txt").toString, "résumé/馬💩.txt")
    assertEquals(name("%2e%2e").toString, "%2e%2e") // Literal FS names, not URL decoding.
  }

  test("new handle reads offset writes, EOF and Unicode; force is file-only") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      Files.createDirectory(root.resolve("資料"))
      Using.resource(ConfinedDirectory.open(root)) { directory =>
        Using.resource(directory.createFile(name("資料/馬💩.txt"))) { file =>
          file.write(0, bytes("abcdef"))
          file.write(2, bytes("XY"))
          assertEquals(file.read(0, 100).toVector, bytes("abXYef").toVector)
          assertEquals(file.read(6, 10).length, 0)
          assertEquals(file.read(0, 0).length, 0)
          file.forceFile()
          directory.forceDirectory(name("資料"))
          directory.forceRootDirectory()
          intercept[IllegalArgumentException](file.write(-1, bytes("x")))
          intercept[IllegalArgumentException](file.read(Long.MaxValue, 1))
        }
        intercept[FileAlreadyExistsException](directory.createFile(name("資料/馬💩.txt")))
      }
    }
  }

  test("symlink root and symlink ancestor are rejected on initial open") {
    fixture { temp =>
      val real = Files.createDirectories(temp.resolve("real/root"))
      Files.createSymbolicLink(temp.resolve("alias"), temp.resolve("real"))
      Files.createSymbolicLink(temp.resolve("root-link"), real)
      intercept[IOException](ConfinedDirectory.open(temp.resolve("alias/root")))
      intercept[IOException](ConfinedDirectory.open(temp.resolve("root-link")))
      intercept[IllegalArgumentException](ConfinedDirectory.open(real.resolve("../root")))
    }
  }

  test("symlink payload parent and existing symlink leaf cannot redirect creation") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      val outside = Files.createDirectory(temp.resolve("root-sibling"))
      val sentinel = Files.writeString(outside.resolve("sentinel"), "untouched")
      Files.createSymbolicLink(root.resolve("parent"), outside)
      Files.createSymbolicLink(root.resolve("leaf"), sentinel)
      Using.resource(ConfinedDirectory.open(root)) { directory =>
        intercept[IOException](directory.createFile(name("parent/new")))
        intercept[IOException](directory.forceDirectory(name("parent")))
        intercept[FileAlreadyExistsException](directory.createFile(name("leaf")))
        assertEquals(Files.readString(sentinel), "untouched")
        assert(!Files.exists(outside.resolve("new")))
      }
    }
  }

  test("physical root replacement refuses operations before touching replacement") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      Using.resource(ConfinedDirectory.open(root)) { directory =>
        Files.move(root, temp.resolve("old-root"))
        Files.createDirectory(root)
        Files.writeString(root.resolve("sentinel"), "untouched")
        intercept[RootReplaced](directory.createFile(name("new")))
        intercept[RootReplaced](directory.deleteFile(name("sentinel")))
        intercept[RootReplaced](directory.forceRootDirectory())
        intercept[RootReplaced](directory.forceDirectory(name("sentinel")))
        intercept[RootReplaced](directory.move(name("sentinel"), name("renamed")))
        intercept[RootReplaced](directory.removeTree(name("sentinel"), 10000, 64))
        assertEquals(Files.readString(root.resolve("sentinel")), "untouched")
        assert(!Files.exists(root.resolve("new")))
      }
    }
  }

  test("ancestor replacement with symlink refuses root revalidation") {
    fixture { temp =>
      val ancestor = Files.createDirectory(temp.resolve("ancestor"))
      val root = Files.createDirectory(ancestor.resolve("root"))
      val outside = Files.createDirectories(temp.resolve("outside/root"))
      Using.resource(ConfinedDirectory.open(root)) { directory =>
        Files.move(ancestor, temp.resolve("old-ancestor"))
        Files.createSymbolicLink(ancestor, outside.getParent)
        intercept[IOException](directory.createFile(name("new")))
        assert(!Files.exists(outside.resolve("new")))
      }
    }
  }

  test("an open file remains pinned after leaf replacement and parent/root renames") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      val parent = Files.createDirectory(root.resolve("parent"))
      val sentinel = Files.writeString(temp.resolve("sentinel"), "untouched")
      Using.resource(ConfinedDirectory.open(root)) { directory =>
        Using.resource(directory.createFile(name("parent/file"))) { file =>
          Files.move(parent.resolve("file"), parent.resolve("original"))
          Files.createSymbolicLink(parent.resolve("file"), sentinel)
          Files.move(parent, root.resolve("old-parent"))
          Files.move(root, temp.resolve("old-root"))
          Files.createDirectory(root)
          file.write(0, bytes("pinned"))
          file.forceFile()
          assertEquals(file.read(0, 20).toVector, bytes("pinned").toVector)
          assertEquals(Files.readString(temp.resolve("old-root/old-parent/original")), "pinned")
          assertEquals(Files.readString(sentinel), "untouched")
          intercept[RootReplaced](directory.createFile(name("other")))
        }
      }
    }
  }

  test("descriptor-relative directory rename supports staging to live but cannot fsync commit") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      Files.createDirectories(root.resolve("staging/id/tree"))
      Files.createDirectory(root.resolve("live"))
      Using.resource(ConfinedDirectory.open(root)) { directory =>
        Using.resource(directory.createFile(name("staging/id/tree/payload"))) { file =>
          file.write(0, bytes("payload"))
          file.forceFile()
        }
        directory.move(name("staging/id/tree"), name("live/id"))
        assert(!Files.exists(root.resolve("staging/id/tree")))
        assertEquals(Files.readString(root.resolve("live/id/payload")), "payload")
        directory.forceDirectory(name("live/id"))
        directory.forceDirectory(name("live"))
        directory.forceRootDirectory()
      }
    }
  }

  test("rename cannot traverse destination parent symlink; symlink source is moved, not followed") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      val outside = Files.createDirectory(temp.resolve("outside"))
      val sentinel = Files.writeString(outside.resolve("sentinel"), "untouched")
      Files.createSymbolicLink(root.resolve("escape"), outside)
      Files.createSymbolicLink(root.resolve("link"), sentinel)
      Using.resource(ConfinedDirectory.open(root)) { directory =>
        intercept[IOException](directory.move(name("link"), name("escape/moved")))
        directory.move(name("link"), name("moved-link"))
        assert(Files.isSymbolicLink(root.resolve("moved-link")))
        assertEquals(Files.readString(sentinel), "untouched")
        assert(!Files.exists(outside.resolve("moved")))
      }
    }
  }

  test("cleanup unlinks symlinks and never descends into their targets") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      val tree = Files.createDirectories(root.resolve("tree/nested"))
      val outside = Files.createDirectory(temp.resolve("outside"))
      val sentinel = Files.writeString(outside.resolve("sentinel"), "untouched")
      Files.writeString(tree.resolve("file"), "inside")
      Files.createSymbolicLink(tree.resolve("escape"), outside)
      Files.createSymbolicLink(tree.resolve("cycle"), root.resolve("tree"))
      Using.resource(ConfinedDirectory.open(root)) { directory =>
        directory.removeTree(name("tree"), 10000, 64)
        assert(!Files.exists(root.resolve("tree")))
        assertEquals(Files.readString(sentinel), "untouched")
        Files.createSymbolicLink(root.resolve("link"), outside)
        directory.removeTree(name("link"), 10000, 64)
        assert(!Files.exists(root.resolve("link"), LinkOption.NOFOLLOW_LINKS))
        assertEquals(Files.readString(sentinel), "untouched")
      }
    }
  }

  test("cleanup bounds abort explicitly without claiming completion") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      Files.createDirectories(root.resolve("tree/child/grandchild"))
      Using.resource(ConfinedDirectory.open(root)) { directory =>
        intercept[IOException](directory.removeTree(name("tree"), maxEntries = 10000, maxDepth = 1))
        assert(Files.exists(root.resolve("tree/child/grandchild")))
        intercept[IOException](directory.removeTree(name("tree"), maxEntries = 1, maxDepth = 64))
        assert(Files.exists(root.resolve("tree")))
      }
    }
  }

  test("unsupported primitives and durable activation refuse before effects") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      Using.resource(ConfinedDirectory.open(root)) { directory =>
        val missing = intercept[MissingPrimitive](directory.requireDurableStore())
        assertEquals(missing.primitives, ConfinedDirectory.missingPrimitives)
        intercept[MissingPrimitive](directory.createDirectory(name("must-not-exist")))
        intercept[MissingPrimitive](directory.claimExclusiveRoot())
        intercept[MissingPrimitive](directory.openExistingFile(name("could-be-fifo")))
        assert(!Files.exists(root.resolve("must-not-exist")))
        Using.resource(Files.list(root))(entries => assertEquals(entries.count(), 0L))
      }
    }
  }

  test("read-only provider preflight has no payload side effects") {
    fixture { temp =>
      ConfinedDirectory.checkProvider(temp.resolve("does-not-exist"))
      Using.resource(Files.list(temp))(entries => assertEquals(entries.count(), 0L))
    }
  }

  test("cleanup exact inclusive entry/depth bounds succeed") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      Files.writeString(root.resolve("leaf"), "inside")
      Files.createDirectories(root.resolve("tree/child"))
      Files.writeString(root.resolve("tree/child/file"), "inside")
      Using.resource(ConfinedDirectory.open(root)) { directory =>
        directory.removeTree(name("leaf"), 1, 1)
        directory.removeTree(name("tree"), 3, 3)
        Using.resource(Files.list(root))(entries => assertEquals(entries.count(), 0L))
      }
    }
  }

  test("open file authority survives unlink and closing its directory") {
    fixture { temp =>
      val directory = ConfinedDirectory.open(temp)
      Using.resource(directory.createFile(name("file"))) { file =>
        try directory.deleteFile(name("file"))
        finally directory.close()
        file.write(0, bytes("unlinked"))
        file.forceFile()
        assertEquals(file.read(0, 100).toVector, bytes("unlinked").toVector)
        assert(!Files.exists(temp.resolve("file")))
      }
    }
  }

  test("opening two handles does not pretend to claim exclusive root ownership") {
    fixture { temp =>
      Using.resource(ConfinedDirectory.open(temp)) { first =>
        Using.resource(ConfinedDirectory.open(temp)) { second =>
          intercept[MissingPrimitive](first.claimExclusiveRoot())
          intercept[MissingPrimitive](second.claimExclusiveRoot())
          Using.resource(first.createFile(name("first")))(_.forceFile())
          Using.resource(second.createFile(name("second")))(_.forceFile())
        }
      }
    }
  }

  test("close is idempotent; closed directory and file reject IO") {
    fixture { temp =>
      val directory = ConfinedDirectory.open(temp)
      val file = directory.createFile(name("file"))
      file.close()
      file.close()
      intercept[java.nio.channels.ClosedChannelException](file.read(0, 1))
      intercept[java.nio.channels.ClosedChannelException](file.read(0, 0))
      intercept[java.nio.channels.ClosedChannelException](file.write(0, bytes("x")))
      intercept[java.nio.channels.ClosedChannelException](file.write(0, Array.emptyByteArray))
      intercept[java.nio.channels.ClosedChannelException](file.forceFile())
      directory.close()
      directory.close()
      intercept[java.nio.channels.ClosedChannelException](directory.createFile(name("other")))
    }
  }
