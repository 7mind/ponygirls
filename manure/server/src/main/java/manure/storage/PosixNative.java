package manure.storage;

import java.io.IOException;
import java.nio.file.Path;
import java.util.Objects;

/**
 * Explicit Linux JNI primitives. The caller owns every returned descriptor and
 * must serialize use/close: a closed integer can be reused by the OS. There is
 * no process-global descriptor/claim registry, implicit loader or fallback.
 * Paths are raw bytes, not JNI modified UTF-8. Children are single components.
 * Primitive success does not implement a publication or recovery protocol.
 */
public final class PosixNative {
    public static final int REGULAR = 1;
    public static final int DIRECTORY = 2;
    public static final int SYMLINK = 3;
    public static final int OTHER = 4;

    private PosixNative() {}

    @SuppressWarnings("restricted") // This explicitly selected factory is the native boundary.
    public static PosixNative shared(String absoluteLibraryPath) throws IOException {
        Objects.requireNonNull(absoluteLibraryPath, "absoluteLibraryPath");
        if (!Path.of(absoluteLibraryPath).isAbsolute())
            throw new IllegalArgumentException("native library path must be absolute");
        System.load(absoluteLibraryPath);
        return linked();
    }

    /** Requires build-time static JNI registration; never loads a shared library. */
    public static PosixNative linked() throws IOException {
        PosixNative result = new PosixNative();
        result.check();
        return result;
    }

    private native void check() throws NativeFailure;
    public native int openRoot(byte[] absolutePath) throws NativeFailure;
    public native int openDirectory(int parent, byte[] name) throws NativeFailure;
    public native void mkdir(int parent, byte[] name) throws NativeFailure;
    public native int createFile(int parent, byte[] name) throws NativeFailure;
    public native int openFile(int parent, byte[] name, boolean writable) throws NativeFailure;
    /** Unsigned kernel dev/ino bit patterns. */
    public native long[] identity(int fd) throws NativeFailure;
    public native int kind(int parent, byte[] name) throws NativeFailure;
    /** Independent enumeration; EOVERFLOW rather than silently truncated cleanup. */
    public native byte[][] entries(int directory, int maxEntries) throws NativeFailure;
    /** Reads up to maxBytes, stopping at EOF; offset/length must fit signed off_t. */
    public native byte[] read(int fd, long offset, int maxBytes) throws NativeFailure;
    /** Completes all positional writes or throws; failure may follow partial progress. */
    public native void write(int fd, long offset, byte[] bytes) throws NativeFailure;
    /** Current regular-file byte length, including holes. */
    public native long size(int fd) throws NativeFailure;
    /** Changes regular-file length; nonnegative signed 64-bit byte length only. */
    public native void truncate(int fd, long size) throws NativeFailure;
    public native void sync(int fd) throws NativeFailure;
    public native void move(int sourceParent, byte[] source, int destinationParent,
                            byte[] destination) throws NativeFailure;
    public native void unlink(int parent, byte[] name, boolean directory) throws NativeFailure;
    /** Name excludes the initial abstract-namespace NUL, which the bridge adds. */
    public native int claim(byte[] abstractSocketName) throws NativeFailure;
    /** Closes once, including EINTR: the Linux descriptor must never be retried. */
    public native void close(int fd) throws NativeFailure;
}
