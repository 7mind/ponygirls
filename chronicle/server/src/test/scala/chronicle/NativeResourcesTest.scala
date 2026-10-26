package chronicle
import java.nio.file.{Files,Path}
import java.util.Properties
import scala.jdk.CollectionConverters.*
import scala.util.Using

class NativeResourcesTest extends munit.FunSuite {
  test("Blackbox-Group: native resource selectors include every database migration") {
    val properties=new Properties
    val resource=getClass.getResourceAsStream("/META-INF/native-image/chronicle/native-image.properties")
    assert(resource!=null,"native image properties missing")
    Using.resource(resource)(properties.load)
    val prefix="-H:IncludeResources="
    val selectors=properties.getProperty("Args").split("\\s+").filter(_.startsWith(prefix)).map(_.stripPrefix(prefix).r)
    assert(selectors.nonEmpty,"native resource selectors missing")
    val migrations=Using.resource(Files.list(Path.of("migrations"))) { paths =>
      paths.iterator.asScala.map(_.getFileName.toString).filter(_.endsWith(".sql")).toList.sorted
    }
    assert(migrations.nonEmpty,"database migration inventory empty")
    val excluded=migrations.filterNot(name => selectors.exists(_.pattern.matcher(name).matches()))
    assertEquals(excluded,List.empty[String])
  }
}
