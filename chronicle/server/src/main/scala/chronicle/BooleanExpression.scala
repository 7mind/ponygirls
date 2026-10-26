package chronicle

enum BooleanExpression[+P] {
  case True extends BooleanExpression[Nothing]
  case Text(value: String) extends BooleanExpression[Nothing]
  case Field(predicate: P)
  case And(left: BooleanExpression[P], right: BooleanExpression[P])
  case Or(left: BooleanExpression[P], right: BooleanExpression[P])
  case Not(value: BooleanExpression[P])

  def containsText: Boolean = this match {
    case Text(_) => true
    case And(left,right) => left.containsText || right.containsText
    case Or(left,right) => left.containsText || right.containsText
    case Not(value) => value.containsText
    case True | Field(_) => false
  }

  def evaluate(text: String => Boolean, field: P => Boolean): Boolean = this match {
    case True => true
    case Text(value) => text(value)
    case Field(predicate) => field(predicate)
    case And(left,right) => left.evaluate(text,field) && right.evaluate(text,field)
    case Or(left,right) => left.evaluate(text,field) || right.evaluate(text,field)
    case Not(value) => !value.evaluate(text,field)
  }
}
