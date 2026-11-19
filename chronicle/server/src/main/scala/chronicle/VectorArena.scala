package chronicle

/** A running job's embedding vectors, held until its publication, in large primitive blocks. The native image keeps an
  * array above its large-array threshold (128 KiB) in a chunk of its own that collections relink instead of copying:
  * 60k vectors of a large job as 60k small arrays were copied by every full collection. Blocks are append-only; the
  * returned views never change. */
final class VectorArena(dimensions: Int) {
  Check(dimensions>0,"internal","vector dimensions")
  private val perBlock = math.max(1,VectorArena.blockDoubles/dimensions)
  private var block = Array.emptyDoubleArray
  private var used = perBlock
  def add(vector: Seq[Double]): Seq[Double] = {
    Check(vector.size==dimensions,"internal","vector dimensions")
    if(used==perBlock) { block=new Array[Double](perBlock*dimensions); used=0 }
    val offset=used*dimensions
    vector.copyToArray(block,offset)
    used+=1
    new VectorArena.View(block,offset,dimensions)
  }
}
object VectorArena {
  /** 2 MiB per block. */
  val blockDoubles: Int = 256*1024
  final class View private[VectorArena] (block: Array[Double],offset: Int,val length: Int) extends scala.collection.immutable.IndexedSeq[Double] {
    def apply(index: Int): Double = { if(index<0 || index>=length) throw new IndexOutOfBoundsException(index.toString); block(offset+index) }
  }
}
