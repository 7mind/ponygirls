package chronicle

import java.nio.ByteBuffer

/** SHA-256 (FIPS 180-4) whose midstate leaves the process: `state` after any prefix, and `ResumableSha256.resume`
  * continues it in a fresh instance; the JDK digest has no exportable state. The state is the eight chaining values
  * (u32 big-endian), the byte length hashed so far (u64 big-endian) and the `length mod 64` bytes not yet compressed:
  * 40..103 bytes. Used only where a hash outlives a transaction; whole values keep `MessageDigest`. */
final class ResumableSha256 private (chaining: Array[Int],private var hashed: Long,block: Array[Byte]) {
  private val schedule=new Array[Int](64)
  /** Bytes hashed so far. */
  def length: Long = hashed
  def update(bytes: Array[Byte]): this.type = update(bytes,0,bytes.length)
  def update(bytes: Array[Byte],offset: Int,size: Int): this.type = {
    java.util.Objects.checkFromIndexSize(offset,size,bytes.length)
    var pending=(hashed & 63).toInt
    hashed=Math.addExact(hashed,size.toLong)
    var from=offset
    val end=offset+size
    if(pending>0) {
      val taken=math.min(64-pending,size)
      System.arraycopy(bytes,from,block,pending,taken)
      from+=taken; pending+=taken
      if(pending==64) { ResumableSha256.compress(chaining,schedule,block,0); pending=0 }
    }
    while(end-from>=64) { ResumableSha256.compress(chaining,schedule,bytes,from); from+=64 }
    System.arraycopy(bytes,from,block,pending,end-from)
    this
  }
  def state: Array[Byte] = {
    val pending=(hashed & 63).toInt
    val out=ByteBuffer.allocate(ResumableSha256.fixedStateBytes+pending)
    chaining.foreach(out.putInt)
    out.putLong(hashed).put(block,0,pending).array()
  }
  /** The digest of the bytes hashed so far; this instance continues unchanged. */
  def digest: Array[Byte] = {
    val pending=(hashed & 63).toInt
    val padded=new Array[Byte](if(pending<56) 64 else 128)
    System.arraycopy(block,0,padded,0,pending)
    padded(pending)=0x80.toByte
    // The bit length modulo 2^64, as MessageDigest counts it.
    ByteBuffer.wrap(padded).putLong(padded.length-8,hashed<<3)
    val result=chaining.clone()
    padded.indices.by(64).foreach(ResumableSha256.compress(result,schedule,padded,_))
    val out=ByteBuffer.allocate(32)
    result.foreach(out.putInt)
    out.array()
  }
}
object ResumableSha256 {
  private val fixedStateBytes=40
  private val initial=Array(0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19)
  private val rounds=Array(
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2)
  def apply(): ResumableSha256 = new ResumableSha256(initial.clone(),0L,new Array[Byte](64))
  def resume(state: Array[Byte]): ResumableSha256 = {
    Check(state.length>=fixedStateBytes && state.length<fixedStateBytes+64,"internal","invalid SHA-256 state")
    val in=ByteBuffer.wrap(state)
    val chaining=Array.fill(8)(in.getInt())
    val hashed=in.getLong()
    Check(hashed>=0 && (hashed & 63)==state.length-fixedStateBytes,"internal","invalid SHA-256 state")
    val block=new Array[Byte](64)
    in.get(block,0,state.length-fixedStateBytes)
    new ResumableSha256(chaining,hashed,block)
  }
  private def compress(h: Array[Int],w: Array[Int],input: Array[Byte],offset: Int): Unit = {
    var t=0
    while(t<16) {
      val i=offset+4*t
      w(t)=(input(i)<<24)|((input(i+1)&0xff)<<16)|((input(i+2)&0xff)<<8)|(input(i+3)&0xff)
      t+=1
    }
    while(t<64) {
      val s0=Integer.rotateRight(w(t-15),7)^Integer.rotateRight(w(t-15),18)^(w(t-15)>>>3)
      val s1=Integer.rotateRight(w(t-2),17)^Integer.rotateRight(w(t-2),19)^(w(t-2)>>>10)
      w(t)=w(t-16)+s0+w(t-7)+s1
      t+=1
    }
    var a=h(0); var b=h(1); var c=h(2); var d=h(3); var e=h(4); var f=h(5); var g=h(6); var k=h(7)
    t=0
    while(t<64) {
      val t1=k+(Integer.rotateRight(e,6)^Integer.rotateRight(e,11)^Integer.rotateRight(e,25))+((e&f)^(~e&g))+rounds(t)+w(t)
      val t2=(Integer.rotateRight(a,2)^Integer.rotateRight(a,13)^Integer.rotateRight(a,22))+((a&b)^(a&c)^(b&c))
      k=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2
      t+=1
    }
    h(0)+=a; h(1)+=b; h(2)+=c; h(3)+=d; h(4)+=e; h(5)+=f; h(6)+=g; h(7)+=k
  }
}
