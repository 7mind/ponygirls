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
final class FilesystemBehavior(bridge: PosixNative, childCommand: Vector[String]):
  val cases = scala.collection.mutable.ArrayBuffer.empty[(String, () => Unit)]
  private def test(label: String)(body: => Unit): Unit = cases += ((label, () => body))
  private def assertEquals[A](actual: A, expected: A): Unit = assert(actual == expected, s"$actual != $expected")
  private def intercept[A <: Throwable: scala.reflect.ClassTag](body: => Any): A =
    try
      body
      throw new AssertionError("expected exception")
    catch
      case error: Throwable if summon[scala.reflect.ClassTag[A]].runtimeClass.isInstance(error) => error.asInstanceOf[A]

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
    Vector("", "/a", "a/", "a//b", ".", "..", "a/../b", "a/./b", "a\\b", "a\u0000b", "\ud800", "x\udfff").foreach { invalid =>
      intercept[IllegalArgumentException](name(invalid))
    }
    assertEquals(name("résumé/馬💩.txt").toString, "résumé/馬💩.txt")
    assertEquals(name("%2e%2e").toString, "%2e%2e") // Literal FS names, not URL decoding.
  }

  test("new handle reads offset writes, EOF and Unicode; force is file-only") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      Files.createDirectory(root.resolve("資料"))
      Using.resource(ConfinedDirectory.open(root, bridge)) { directory =>
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
      intercept[IOException](ConfinedDirectory.open(temp.resolve("alias/root"), bridge))
      intercept[IOException](ConfinedDirectory.open(temp.resolve("root-link"), bridge))
      intercept[IllegalArgumentException](ConfinedDirectory.open(real.resolve("../root"), bridge))
    }
  }

  test("symlink payload parent and existing symlink leaf cannot redirect creation") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      val outside = Files.createDirectory(temp.resolve("root-sibling"))
      val sentinel = Files.writeString(outside.resolve("sentinel"), "untouched")
      Files.createSymbolicLink(root.resolve("parent"), outside)
      Files.createSymbolicLink(root.resolve("leaf"), sentinel)
      Using.resource(ConfinedDirectory.open(root, bridge)) { directory =>
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
      Using.resource(ConfinedDirectory.open(root, bridge)) { directory =>
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
      Using.resource(ConfinedDirectory.open(root, bridge)) { directory =>
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
      Using.resource(ConfinedDirectory.open(root, bridge)) { directory =>
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
      Using.resource(ConfinedDirectory.open(root, bridge)) { directory =>
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
      Using.resource(ConfinedDirectory.open(root, bridge)) { directory =>
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
      Using.resource(ConfinedDirectory.open(root, bridge)) { directory =>
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
      Using.resource(ConfinedDirectory.open(root, bridge)) { directory =>
        intercept[IOException](directory.removeTree(name("tree"), maxEntries = 10000, maxDepth = 1))
        assert(Files.exists(root.resolve("tree/child/grandchild")))
        intercept[IOException](directory.removeTree(name("tree"), maxEntries = 1, maxDepth = 64))
        assert(Files.exists(root.resolve("tree")))
      }
    }
  }

  test("cleanup exact inclusive entry/depth bounds succeed") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      Files.writeString(root.resolve("leaf"), "inside")
      Files.createDirectories(root.resolve("tree/child"))
      Files.writeString(root.resolve("tree/child/file"), "inside")
      Using.resource(ConfinedDirectory.open(root, bridge)) { directory =>
        directory.removeTree(name("leaf"), 1, 1)
        directory.removeTree(name("tree"), 3, 3)
        Using.resource(Files.list(root))(entries => assertEquals(entries.count(), 0L))
      }
    }
  }

  test("root close refuses live pinned handles and retains claim after unlink and root rename") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      val directory = ConfinedDirectory.open(root, bridge)
      try
        Using.resource(directory.createFile(name("file"))) { file =>
          directory.deleteFile(name("file"))
          intercept[OpenFileHandles](directory.close())
          intercept[RootAlreadyClaimed](ConfinedDirectory.open(root, bridge))
          Files.move(root, temp.resolve("renamed"))
          intercept[RootAlreadyClaimed](ConfinedDirectory.open(temp.resolve("renamed"), bridge))
          file.write(0, bytes("unlinked"))
          file.forceFile()
          assertEquals(file.read(0, 100).toVector, bytes("unlinked").toVector)
        }
      finally directory.close()
      Using.resource(ConfinedDirectory.open(temp.resolve("renamed"), bridge))(_.forceRootDirectory())
    }
  }

  test("metadata and worker lease retains physical claim without an open file") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      val directory = ConfinedDirectory.open(root, bridge)
      val lease = directory.lease()
      try
        lease.validate()
        assertEquals(lease.run(17), 17)
        intercept[OpenRootLeases](directory.close())
        intercept[RootAlreadyClaimed](ConfinedDirectory.open(root, bridge))
        Files.move(root, temp.resolve("renamed"))
        intercept[RootAlreadyClaimed](ConfinedDirectory.open(temp.resolve("renamed"), bridge))
        var touched = false
        intercept[IOException](lease.run { touched = true })
        assert(!touched, "root validation must precede DB effects")
      finally
        lease.close()
        lease.close()
        directory.close()
      intercept[java.nio.channels.ClosedChannelException](lease.run(1))
      Using.resource(ConfinedDirectory.open(temp.resolve("renamed"), bridge))(_.forceRootDirectory())
    }
  }

  test("strict bounded publication topology and raw orphan cleanup") {
    fixture { temp =>
      Files.createDirectories(temp.resolve("tree/資料"))
      Files.writeString(temp.resolve("tree/資料/file"), "payload")
      Using.resource(ConfinedDirectory.open(temp, bridge)) { directory =>
        val entries = directory.tree(name("tree"), 2, 2)
        assertEquals(entries.map(e => (e.name.value,e.directory)).toSet, Set(("資料",true),("資料/file",false)))
        intercept[IOException](directory.tree(name("tree"), 1, 2))
        Files.createSymbolicLink(temp.resolve("tree/link"), temp.resolve("tree/資料/file"))
        intercept[IOException](directory.tree(name("tree"), 3, 3))
        val fd = bridge.openRoot(temp.resolve("tree").toString.getBytes(UTF_8))
        try
          val file = bridge.createFile(fd, Array('x'.toByte, 0xff.toByte))
          bridge.close(file)
        finally bridge.close(fd)
        assertEquals(directory.cleanupChildren(name("tree"), Set("資料"), 10, 10), 2)
        assertEquals(Files.readString(temp.resolve("tree/資料/file")), "payload")
        assertEquals(directory.cleanupChildren(name("tree"), Set.empty, 10, 10), 1)
      }
    }
  }

  test("close is idempotent; closed directory and file reject IO") {
    fixture { temp =>
      val directory = ConfinedDirectory.open(temp, bridge)
      val file = directory.createFile(name("file"))
      file.close()
      file.close()
      intercept[java.nio.channels.ClosedChannelException](file.read(0, 1))
      intercept[java.nio.channels.ClosedChannelException](file.read(0, 0))
      intercept[java.nio.channels.ClosedChannelException](file.write(0, bytes("x")))
      intercept[java.nio.channels.ClosedChannelException](file.write(0, Array.emptyByteArray))
      intercept[java.nio.channels.ClosedChannelException](file.forceFile())
      // Churn native descriptors: the closed handle must not touch a reused fd.
      Using.resource(directory.createFile(name("replacement"))) { replacement =>
        replacement.write(0, bytes("retained"))
        intercept[java.nio.channels.ClosedChannelException](file.write(0, bytes("wrong")))
        intercept[java.nio.channels.ClosedChannelException](file.truncate(0))
        intercept[java.nio.channels.ClosedChannelException](file.size())
        assertEquals(replacement.read(0, 100).toVector, bytes("retained").toVector)
      }
      directory.close()
      directory.close()
      intercept[java.nio.channels.ClosedChannelException](directory.createFile(name("other")))
    }
  }

  test("mkdirat and existing regular-file handles support Unicode and readonly access") {
    fixture { temp =>
      Using.resource(ConfinedDirectory.open(temp, bridge)) { directory =>
        directory.createDirectory(name("資料"))
        directory.createDirectory(name("資料/nested"))
        intercept[FileAlreadyExistsException](directory.createDirectory(name("資料")))
        intercept[NoSuchFileException](directory.createDirectory(name("absent/child")))
        Using.resource(directory.createFile(name("資料/nested/馬💩")))(_.write(0, bytes("original")))
        Using.resource(directory.openExistingFile(name("資料/nested/馬💩"), ExistingFileAccess.ReadWrite)) { file =>
          file.write(0, bytes("replaced"))
          file.forceFile()
        }
        Using.resource(directory.openExistingFile(name("資料/nested/馬💩"), ExistingFileAccess.ReadOnly)) { file =>
          assertEquals(file.read(0, 100).toVector, bytes("replaced").toVector)
          intercept[IOException](file.write(0, bytes("forbidden")))
        }
        directory.forceDirectory(name("資料/nested"))
        directory.forceDirectory(name("資料"))
        directory.forceRootDirectory()
      }
    }
  }

  test("existing opens reject symlinks, directories and FIFO without blocking") {
    fixture { temp =>
      val sentinel = Files.writeString(temp.resolve("sentinel"), "untouched")
      Files.createDirectory(temp.resolve("directory"))
      Files.createSymbolicLink(temp.resolve("link"), sentinel)
      val mkfifo = new ProcessBuilder("mkfifo", temp.resolve("fifo").toString).start()
      try
        assert(mkfifo.waitFor(10, java.util.concurrent.TimeUnit.SECONDS), "mkfifo deadline")
        assertEquals(mkfifo.exitValue(), 0)
      finally ProbeChildren.stop(mkfifo)
      // A broken FIFO open must fail by deadline, not hang this test process.
      Vector("link", "directory", "fifo").foreach { leaf =>
        assertEquals(ProbeChildren.rejectExisting(childCommand, temp, leaf), 0)
      }
      assertEquals(Files.readString(sentinel), "untouched")
    }
  }

  test("existing device inode is rejected without an IO open") {
    // /dev/null is an actual character inode, not a symlink fixture. No device reads/writes.
    assertEquals(ProbeChildren.rejectExisting(childCommand, Path.of("/dev"), "null"), 0)
  }

  test("existing handles stay pinned when their name becomes a symlink") {
    fixture { temp =>
      Files.writeString(temp.resolve("file"), "original")
      val sentinel = Files.writeString(temp.resolve("sentinel"), "untouched")
      Using.resource(ConfinedDirectory.open(temp, bridge)) { directory =>
        Using.resource(directory.openExistingFile(name("file"), ExistingFileAccess.ReadWrite)) { file =>
          Files.move(temp.resolve("file"), temp.resolve("old"))
          Files.createSymbolicLink(temp.resolve("file"), sentinel)
          file.write(0, bytes("retained"))
          file.forceFile()
          assertEquals(file.read(0, 100).toVector, bytes("retained").toVector)
          assertEquals(Files.readString(temp.resolve("old")), "retained")
          assertEquals(Files.readString(sentinel), "untouched")
        }
      }
    }
  }

  test("cleanup retains raw invalid-UTF8 names and rejects oversized batches") {
    fixture { temp =>
      val tree = Files.createDirectory(temp.resolve("tree"))
      Using.resource(ConfinedDirectory.open(temp, bridge)) { directory =>
        // Raw native setup only: public string names deliberately cannot express this name.
        val fd = bridge.openRoot(tree.toString.getBytes(UTF_8))
        try
          val file = bridge.createFile(fd, Array('x'.toByte, 0xff.toByte))
          bridge.close(file)
        finally bridge.close(fd)
        directory.removeTree(name("tree"), 2, 2)
        assert(!Files.exists(tree))
        Files.createDirectory(tree)
        (1 to 8).foreach(i => Files.writeString(tree.resolve(s"file$i"), "data"))
        intercept[IOException](directory.removeTree(name("tree"), 2, 4))
        assert(Files.exists(tree))
        directory.removeTree(name("tree"), 9, 2)
      }
    }
  }

  test("kernel claims contend across processes, inode rename aliases, and failed root close") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      val renamed = temp.resolve("renamed")
      val directory = ConfinedDirectory.open(root, bridge)
      try
        Using.resource(directory.createFile(name("file"))) { file =>
          assertEquals(ProbeChildren.exit(childCommand, "--try-root", root), 3)
          intercept[OpenFileHandles](directory.close())
          assertEquals(ProbeChildren.exit(childCommand, "--try-root", root), 3)
          Files.move(root, renamed)
          assertEquals(ProbeChildren.exit(childCommand, "--try-root", renamed), 3)
          file.write(0, bytes("still-owned"))
        }
      finally directory.close()
      assertEquals(ProbeChildren.exit(childCommand, "--try-root", renamed), 0)
    }
  }

  test("kernel claims release after owning process is killed, without lockfile cleanup") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      val child = ProbeChildren.start(childCommand, "--hold-root", root)
      try
        ProbeChildren.ready(child)
        intercept[RootAlreadyClaimed](ConfinedDirectory.open(root, bridge))
        Using.resource(Files.list(root))(entries => assertEquals(entries.count(), 0L))
      finally ProbeChildren.stop(child)
      Using.resource(ConfinedDirectory.open(root, bridge))(_.forceRootDirectory())
    }
  }

  test("errno mapping is stable and never includes user-controlled paths") {
    fixture { temp =>
      Using.resource(ConfinedDirectory.open(temp, bridge)) { directory =>
        val secret = "not-for-errors-馬"
        val missing = intercept[NoSuchFileException](directory.openExistingFile(name(secret), ExistingFileAccess.ReadOnly))
        assert(!missing.toString.contains(secret))
        assert(!missing.toString.contains(temp.toString))
        directory.createDirectory(name("dir"))
        val exists = intercept[FileAlreadyExistsException](directory.createDirectory(name("dir")))
        assertEquals(exists.getFile, "storage entry")
      }
    }
  }

  test("raw invalid-UTF8 root Path cannot silently select a Unicode replacement sibling") {
    fixture { temp =>
      val replacement = Files.createDirectory(temp.resolve("root-\ufffd"))
      val fd = bridge.openRoot(temp.toString.getBytes(UTF_8))
      try bridge.mkdir(fd, bytes("root-") ++ Array(0xff.toByte))
      finally bridge.close(fd)
      val raw = Using.resource(Files.list(temp)) { entries =>
        entries.iterator().asScala.find(path => path != replacement).get
      }
      assertEquals(raw.toString, replacement.toString)
      assert(raw != replacement)
      intercept[IllegalArgumentException] {
        Using.resource(ConfinedDirectory.open(raw, bridge))(_.forceRootDirectory())
      }
      Using.resource(ConfinedDirectory.open(replacement, bridge)) { directory =>
        directory.createDirectory(name("accepted-unicode"))
      }
      assert(Files.isDirectory(replacement.resolve("accepted-unicode")))
      Using.resource(Files.list(raw))(entries => assertEquals(entries.count(), 0L))
    }
  }

  test("physical root claims interoperate with Python stdlib in both directions") {
    fixture { temp =>
      val root = Files.createDirectory(temp.resolve("root"))
      val script = """import errno, hashlib, os, socket, sys, time
st = os.stat(sys.argv[1], follow_symlinks=False)
key = ('%d:%d' % (st.st_dev, st.st_ino)).encode('utf-8')
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
try:
    s.bind('\0manure-' + hashlib.sha256(key).hexdigest())
except OSError as exc:
    if exc.errno != errno.EADDRINUSE:
        raise
    sys.exit(3)
if sys.argv[2] == 'hold':
    print('READY', flush=True)
    time.sleep(60)
"""
      val command = Vector("python3", "-c", script, root.toString)
      Using.resource(ConfinedDirectory.open(root, bridge)) { directory =>
        assertEquals(ProbeChildren.exit(command :+ "try"), 3)
        directory.forceRootDirectory()
      }
      val child = new ProcessBuilder((command :+ "hold")*).redirectErrorStream(true).start()
      val renamed = temp.resolve("renamed")
      try
        ProbeChildren.ready(child)
        intercept[RootAlreadyClaimed](ConfinedDirectory.open(root, bridge))
        Files.move(root, renamed)
        intercept[RootAlreadyClaimed](ConfinedDirectory.open(renamed, bridge))
      finally ProbeChildren.stop(child)
      Using.resource(ConfinedDirectory.open(renamed, bridge))(_.forceRootDirectory())
    }
  }

  test("cleanup handles 1500 descriptor-relative levels without call-stack dependence") {
    fixture { temp =>
      val tree = Files.createDirectory(temp.resolve("deep"))
      var fd = bridge.openRoot(tree.toString.getBytes(UTF_8))
      try
        (1 to 1500).foreach { _ =>
          bridge.mkdir(fd, bytes("d"))
          val child = bridge.openDirectory(fd, bytes("d"))
          bridge.close(fd)
          fd = child
        }
      finally bridge.close(fd)
      Using.resource(ConfinedDirectory.open(temp, bridge)) { directory =>
        directory.removeTree(name("deep"), 1501, 1501)
      }
      assert(!Files.exists(tree))
    }
  }

  test("pinned file size and truncate shrink, extend, reject readonly and closed handles") {
    fixture { temp =>
      Using.resource(ConfinedDirectory.open(temp, bridge)) { directory =>
        Using.resource(directory.createFile(name("file"))) { file =>
          assertEquals(file.size(), 0L)
          file.write(0, bytes("abcdef"))
          assertEquals(file.size(), 6L)
          Files.move(temp.resolve("file"), temp.resolve("original"))
          Files.writeString(temp.resolve("file"), "replacement")
          file.truncate(3)
          assertEquals(file.size(), 3L)
          assertEquals(file.read(0, 100).toVector, bytes("abc").toVector)
          file.truncate(6)
          assertEquals(file.size(), 6L)
          assertEquals(file.read(0, 100).toVector, (bytes("abc") ++ Array[Byte](0, 0, 0)).toVector)
          file.forceFile()
          assertEquals(Files.readString(temp.resolve("file")), "replacement")
          intercept[IllegalArgumentException](file.truncate(-1))
        }
        val readonly = directory.openExistingFile(name("original"), ExistingFileAccess.ReadOnly)
        try
          assertEquals(readonly.size(), 6L)
          intercept[IOException](readonly.truncate(0))
        finally readonly.close()
        intercept[java.nio.channels.ClosedChannelException](readonly.size())
        intercept[java.nio.channels.ClosedChannelException](readonly.truncate(0))
      }
    }
  }
