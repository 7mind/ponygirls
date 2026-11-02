package manure.storage;

import java.io.IOException;

/** An errno and a fixed operation label, never an OS message or payload path. */
public final class NativeFailure extends IOException {
    private static final long serialVersionUID = 1L;
    public final int errno;
    public final String operation;

    public NativeFailure(int errno, String operation) {
        super(operation + " failed (errno " + errno + ")");
        this.errno = errno;
        this.operation = operation;
    }

    public int errno() { return errno; }
    public String operation() { return operation; }
}
