package chronicle

import java.nio.ByteBuffer
import java.security.MessageDigest

final class ResumableSha256Test extends munit.FunSuite {
  private def jdk(bytes: Array[Byte]): Seq[Byte] = MessageDigest.getInstance("SHA-256").digest(bytes).toSeq

  test("equals the JDK digest on random inputs split at random points, each split exported and resumed in a fresh instance") {
    val random=new scala.util.Random(20261120L)
    // Every length up to two blocks and two bytes reaches each padding case; the random lengths span many blocks.
    val lengths=(0 to 130)++Seq.fill(300)(random.nextInt(4096))
    lengths.foreach { length =>
      val input=new Array[Byte](length); random.nextBytes(input)
      val splits=Seq.fill(random.nextInt(4))(random.nextInt(length+1)).sorted
      var hash=ResumableSha256()
      var from=0
      splits.foreach { split =>
        hash.update(input,from,split-from); from=split
        val state=hash.state
        assertEquals(state.length,40+split%64)
        assertEquals(hash.digest.toSeq,jdk(input.take(split)))
        hash=ResumableSha256.resume(state)
      }
      hash.update(input,from,length-from)
      assertEquals(hash.length,length.toLong)
      assertEquals(hash.digest.toSeq,jdk(input),s"length $length, splits $splits")
    }
  }

  test("the state carries a 64-bit byte length; a malformed state is refused") {
    def state(length: Long,pending: Int): Array[Byte] = {
      val out=ByteBuffer.allocate(40+pending); (1 to 8).foreach(out.putInt); out.putLong(length); out.put(Array.fill(pending)(7.toByte)); out.array()
    }
    val large=state((1L<<40)+3,3)
    val resumed=ResumableSha256.resume(large)
    assertEquals(resumed.state.toSeq,large.toSeq)
    val continued=resumed.update(new Array[Byte](70)).state
    assertEquals((continued.length,ByteBuffer.wrap(continued).getLong(32)),(49,(1L<<40)+73))
    List(state(4,3),state(Long.MinValue+3,3),state(3,3).take(39)).foreach { malformed =>
      assertEquals(intercept[DomainError](ResumableSha256.resume(malformed)).code,"internal")
    }
  }
}
