package chronicle

import io.circe.Json

object JsonUtf8Size {
  def apply(value: Json): Long = value.fold(
    4L,
    boolean => if(boolean) 4L else 5L,
    number => number.toString.length.toLong,
    string,
    values => 2L + values.iterator.map(apply).sum + (values.size-1).max(0),
    fields => 2L + fields.toIterable.iterator.map { case (key,item) => string(key)+1L+apply(item) }.sum + (fields.size-1).max(0)
  )

  // Circe's noSpaces printer leaves Unicode scalars intact and escapes JSON controls.
  def string(value: String): Long = {
    var bytes=2L
    var index=0
    while(index<value.length) {
      val char=value.charAt(index)
      if(Character.isHighSurrogate(char)) {
        Check(index+1<value.length && Character.isLowSurrogate(value.charAt(index+1)),"read-budget","invalid source Unicode")
        bytes+=4L; index+=2
      } else {
        Check(!Character.isLowSurrogate(char),"read-budget","invalid source Unicode")
        bytes+= (char match {
          case '"' | '\\' | '\b' | '\f' | '\n' | '\r' | '\t' => 2L
          case control if Character.isISOControl(control) => 6L
          case ascii if ascii<0x80 => 1L
          case two if two<0x800 => 2L
          case _ => 3L
        })
        index+=1
      }
    }
    bytes
  }
}
