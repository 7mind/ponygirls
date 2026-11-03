package ponygirls.retrieval

import cats.effect.IO
import cats.effect.unsafe.implicits.global
import java.nio.file.Files
import scala.concurrent.duration.*

class CredentialBoundaryTest extends munit.FunSuite {
  override val munitTimeout = 10.seconds
  // Regression origin: metadata size checks admitted a FIFO reporting size 0,
  // then Files.readString consumed an unbounded 20KB stream (or waited forever).
  test("Blackbox-GoodCommunication regression: FIFO size zero cannot bypass actual credential byte bound") {
    val directory=Files.createTempDirectory("controlled-model-fifo")
    val fifo=directory.resolve("credential")
    assertEquals(new ProcessBuilder("mkfifo",fifo.toString).start().waitFor(),0)
    val script="""import os,sys,time
end=time.monotonic()+2
while True:
 try:
  fd=os.open(sys.argv[1],os.O_WRONLY|os.O_NONBLOCK)
  break
 except OSError:
  if time.monotonic()>end: sys.exit(0)
  time.sleep(.01)
data=b'x'*20000
while data and time.monotonic()<end:
 try: data=data[os.write(fd,data):]
 except BlockingIOError: time.sleep(.01)
 except BrokenPipeError: break
os.close(fd)
"""
    val producer=new ProcessBuilder("python3","-c",script,fifo.toString).start()
    try {
      val result=JsonHttp.credential(fifo.toString).attempt.timeout(4.seconds).unsafeRunSync()
      assert(result.isLeft,"FIFO was read as a credential despite metadata size zero")
    } finally {
      producer.destroyForcibly().waitFor()
      Files.deleteIfExists(fifo); Files.delete(directory)
    }
  }
  test("Blackbox-GoodCommunication: actual byte bound, strict UTF8, managed symlinks and explicit empty auth policy") {
    val directory=Files.createTempDirectory("controlled-model-credential")
    val regular=directory.resolve("resolved"); val link=directory.resolve("managed")
    try {
      Files.write(regular,Array.emptyByteArray); Files.createSymbolicLink(link,regular)
      assertEquals(JsonHttp.credential(link.toString).unsafeRunSync(),"")
      Files.writeString(regular,"controlled-bearer\n")
      assertEquals(JsonHttp.credential(link.toString).unsafeRunSync(),"controlled-bearer")
      Files.write(regular,Array.fill[Byte](16385)('x'.toByte))
      assert(JsonHttp.credential(link.toString).attempt.unsafeRunSync().isLeft)
      Files.write(regular,Array[Byte](0xc3.toByte,0x28.toByte))
      assert(JsonHttp.credential(link.toString).attempt.unsafeRunSync().isLeft)
    } finally { Files.deleteIfExists(link); Files.deleteIfExists(regular); Files.delete(directory) }
  }
}
