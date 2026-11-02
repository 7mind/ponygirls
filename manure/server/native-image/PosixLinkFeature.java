package manure.build;

import com.oracle.svm.core.jdk.PlatformNativeLibrarySupport;
import com.oracle.svm.hosted.c.NativeLibraries;
import org.graalvm.nativeimage.ImageSingletons;
import org.graalvm.nativeimage.hosted.Feature;
import org.graalvm.nativeimage.hosted.RuntimeJNIAccess;

/** Build-only adapter for the pinned Graal CE 25.4.4.1.1; never on the JVM application classpath.
 * The two SVM APIs are internal: upgrade only with actual static-musl probe acceptance.
 * See lib/svm/builder/svm.src.zip: JNINativeLinkage.isBuiltInFunction and
 * NativeLibraries.addStaticJniLibrary. Public JNI registration alone does not select
 * static symbol dispatch. The bridge has no OnLoad state and linked() does not load a DSO.
 */
public final class PosixLinkFeature implements Feature {
    @Override
    public void beforeAnalysis(BeforeAnalysisAccess access) {
        PlatformNativeLibrarySupport.singleton().addBuiltinNativePrefix("manure_storage_PosixNative_");
        ImageSingletons.lookup(NativeLibraries.class).addStaticJniLibrary("manure_posix");
        Class<?> bridge = access.findClassByName("manure.storage.PosixNative");
        if (bridge == null) throw new IllegalStateException("missing PosixNative");
        for (java.lang.reflect.Method method : bridge.getDeclaredMethods()) {
            if (java.lang.reflect.Modifier.isNative(method.getModifiers())) RuntimeJNIAccess.register(method);
        }
        try {
            Class<?> failure = access.findClassByName("manure.storage.NativeFailure");
            if (failure == null) throw new IllegalStateException("missing NativeFailure");
            RuntimeJNIAccess.register(failure.getConstructor(int.class, String.class));
            RuntimeJNIAccess.register(OutOfMemoryError.class.getConstructor(String.class));
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("POSIX JNI exception ABI mismatch", error);
        }
        // C entries() uses FindClass("[B") to construct byte[][].
        RuntimeJNIAccess.register(byte[].class);
    }
}
