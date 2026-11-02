package manure.storage;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/** Behavioral-Active / Blackbox / Good-Communication, specified-origin.
 * Exact Linux JNI/procfs/kernel-lifetime semantics; not a business-logic dummy suite.
 * Every payload, symlink, FIFO and optional device belongs to this owned temp tree.
 */
public final class NativeSelfTest {
    private static int assertions;
    private static byte[] b(String value) { return value.getBytes(StandardCharsets.UTF_8); }
    private static void check(boolean condition) {
        ++assertions;
        if (!condition) throw new AssertionError("native contract assertion " + assertions);
    }
    @FunctionalInterface private interface Action { void run() throws Exception; }
    private static void fails(int errno, String label, Action action) throws Exception {
        try { action.run(); throw new AssertionError("expected " + label + " errno " + errno); }
        catch (NativeFailure failure) {
            check(failure.errno == errno && failure.errno() == errno);
            check(failure.operation.equals(label) && failure.operation().equals(label));
            check(failure.getMessage().equals(label + " failed (errno " + errno + ")"));
        }
    }
    private static PosixNative load(String[] args) throws Exception {
        if (args[0].equals("--shared")) return PosixNative.shared(args[1]);
        if (args[0].equals("--linked")) return PosixNative.linked();
        throw new IllegalArgumentException("explicit --shared or --linked required");
    }
    private static Process child(String[] args, String mode, String name) throws Exception {
        // This helper is for the JVM selftest; actual native-image acceptance is separate.
        return new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin/java").toString(),
            "--enable-native-access=ALL-UNNAMED", "-Xcheck:jni", "-cp", System.getProperty("java.class.path"),
            NativeSelfTest.class.getName(), args[0], args[1], mode, name).redirectError(ProcessBuilder.Redirect.INHERIT).start();
    }
    private static Process tool(String... command) throws Exception {
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.environment().remove("LD_PRELOAD"); // ASan is scoped to the JNI JVM, not host tools.
        return builder.redirectError(ProcessBuilder.Redirect.DISCARD).start();
    }
    private static long fdCount() throws Exception {
        try (var paths = Files.list(Path.of("/proc/self/fd"))) { return paths.count(); }
    }
    public static void main(String[] args) throws Exception {
        PosixNative api = load(args);
        if (args.length > 2 && args[2].equals("hold")) {
            int fd = api.claim(b(args[3]));
            System.out.println("held"); System.out.flush();
            Thread.sleep(30000);
            api.close(fd);
            return;
        }
        if (args.length > 2 && args[2].equals("contend")) {
            fails(98, "claim", () -> api.claim(b(args[3])));
            return;
        }
        Path temp = Files.createTempDirectory("manure-jni-selftest-");
        int root = -1;
        try {
            root = api.openRoot(b(temp.toString()));
            final int r = root;
            check(api.identity(r).length == 2);
            fails(22, "openRoot", () -> api.openRoot(b("relative")));
            for (String suffix : new String[]{"/", "/.", "/..", "//child"})
                fails(22, "openRoot", () -> api.openRoot(b(temp + suffix)));
            fails(22, "openRoot", () -> api.openRoot(new byte[]{'/', 0}));
            fails(22, "openRoot", () -> api.openRoot(null));
            for (byte[] name : new byte[][]{b(""), b("."), b(".."), b("x/y"), b("/x"), new byte[]{'x', 0}, null}) {
                fails(22, "openDirectory", () -> api.openDirectory(r, name));
                fails(22, "mkdir", () -> api.mkdir(r, name));
                fails(22, "createFile", () -> api.createFile(r, name));
                fails(22, "openFile", () -> api.openFile(r, name, false));
                fails(22, "kind", () -> api.kind(r, name));
                fails(22, "move", () -> api.move(r, b("x"), r, name));
                fails(22, "move", () -> api.move(r, name, r, b("x")));
                fails(22, "unlink", () -> api.unlink(r, name, false));
            }
            fails(9, "openDirectory", () -> api.openDirectory(-100, b("tmp")));
            fails(9, "identity", () -> api.identity(-1));
            fails(9, "close", () -> api.close(-1));
            fails(22, "entries", () -> api.entries(r, -1));
            check(api.entries(r, 0).length == 0);
            api.mkdir(r, b("sub"));
            check(api.kind(r, b("sub")) == PosixNative.DIRECTORY);
            int sub = api.openDirectory(r, b("sub"));
            try {
                int file = api.createFile(sub, b("unicode-雪-🐴"));
                try {
                    check(api.kind(sub, b("unicode-雪-🐴")) == PosixNative.REGULAR);
                    check(api.size(file) == 0);
                    api.truncate(file, 0);
                    check(api.size(file) == 0);
                    fails(22, "truncate", () -> api.truncate(file, -1));
                    fails(22, "truncate", () -> api.truncate(file, Long.MIN_VALUE));
                    fails(17, "createFile", () -> api.createFile(sub, b("unicode-雪-🐴")));
                    api.write(file, 3, b("abc"));
                    check(Arrays.equals(api.read(file, 0, 10), new byte[]{0, 0, 0, 'a', 'b', 'c'}));
                    check(Arrays.equals(api.read(file, 4, 1), b("b")));
                    check(api.read(file, 6, 20).length == 0);
                    check(api.read(file, 0, 0).length == 0);
                    api.write(file, 0, new byte[0]);
                    fails(22, "read", () -> api.read(file, -1, 1));
                    fails(22, "read", () -> api.read(file, 0, -1));
                    fails(22, "read", () -> api.read(file, Long.MAX_VALUE, 1));
                    fails(22, "write", () -> api.write(file, -1, b("x")));
                    fails(22, "write", () -> api.write(file, Long.MAX_VALUE, b("x")));
                    fails(22, "write", () -> api.write(file, 0, null));
                    api.write(file, 0x100000003L, b("large-offset"));
                    check(Arrays.equals(api.read(file, 0x100000003L, 12), b("large-offset")));
                    check(api.size(file) == 0x10000000fL);
                    api.truncate(file, 0x200000005L); // grow a sparse inode beyond 32-bit limits
                    check(api.size(file) == 0x200000005L);
                    check(Arrays.equals(api.read(file, 0x200000002L, 8), new byte[3]));
                    check(Arrays.equals(api.read(file, 0x100000003L, 12), b("large-offset")));
                    api.truncate(file, 5); // discard the sparse tail and the final 'c'
                    check(api.size(file) == 5);
                    check(Arrays.equals(api.read(file, 0, 12), new byte[]{0, 0, 0, 'a', 'b'}));
                    check(api.read(file, 0x100000003L, 12).length == 0);
                    api.truncate(file, 8); // discarded bytes must not reappear on regrowth
                    check(api.size(file) == 8);
                    check(Arrays.equals(api.read(file, 3, 8), new byte[]{'a', 'b', 0, 0, 0}));
                    api.sync(file);
                    int opened = api.openFile(sub, b("unicode-雪-🐴"), false);
                    try {
                        check(Arrays.equals(api.identity(file), api.identity(opened)));
                        fails(9, "write", () -> api.write(opened, 0, b("x")));
                        check(api.size(opened) == 8);
                        fails(22, "truncate", () -> api.truncate(opened, 0)); // Linux RO ftruncate
                        fails(22, "truncate", () -> api.truncate(opened, 8));
                        fails(22, "truncate", () -> api.truncate(opened, -1));
                        check(api.size(opened) == 8);
                    } finally { api.close(opened); }
                    int writable = api.openFile(sub, b("unicode-雪-🐴"), true);
                    try {
                        api.truncate(writable, 0);
                        check(api.size(writable) == 0 && api.size(file) == 0);
                        api.write(writable, 0, b("yes"));
                        check(api.size(writable) == 3 && api.size(file) == 3);
                    } finally { api.close(writable); }
                    check(Arrays.equals(api.read(file, 0, 3), b("yes")));
                    api.move(sub, b("unicode-雪-🐴"), r, b("moved"));
                    check(api.kind(r, b("moved")) == PosixNative.REGULAR);
                    api.unlink(r, b("moved"), false);
                    // Open descriptors pin the inode even after unlink; no pathname fallback.
                    check(Arrays.equals(api.read(file, 0, 3), b("yes")));
                    check(api.size(file) == 3);
                    api.truncate(file, 2); // works on the pinned unlinked inode
                    check(api.size(file) == 2 && Arrays.equals(api.read(file, 0, 3), b("ye")));
                } finally { api.close(file); }
                fails(9, "close", () -> api.close(file));
                fails(9, "read", () -> api.read(file, 0, 1));
                fails(9, "identity", () -> api.identity(file));
                fails(9, "size", () -> api.size(file));
                fails(9, "truncate", () -> api.truncate(file, 0));
                fails(9, "size", () -> api.size(-1));
                fails(9, "truncate", () -> api.truncate(-1, 0));
                fails(21, "size", () -> api.size(sub));
                fails(21, "truncate", () -> api.truncate(sub, 0));
                fails(21, "read", () -> api.read(sub, 0, 1));
                fails(21, "write", () -> api.write(sub, 0, b("x")));
                fails(21, "openFile", () -> api.openFile(r, b("sub"), false));
                byte[] raw = new byte[]{(byte)0xff, (byte)0xfe};
                int rawFile = api.createFile(sub, raw); api.close(rawFile);
                check(Arrays.equals(api.entries(sub, 1)[0], raw));
                check(Arrays.equals(api.entries(sub, 1)[0], raw)); // independent offsets
                fails(75, "entries", () -> api.entries(sub, 0));
                api.unlink(sub, raw, false);
                api.sync(sub);
            } finally { api.close(sub); }
            Files.createSymbolicLink(temp.resolve("alias"), Path.of("sub"));
            check(api.kind(r, b("alias")) == PosixNative.SYMLINK);
            fails(20, "openDirectory", () -> api.openDirectory(r, b("alias")));
            fails(40, "openFile", () -> api.openFile(r, b("alias"), true));
            fails(20, "openRoot", () -> api.openRoot(b(temp.resolve("alias").toString())));
            fails(20, "openRoot", () -> api.openRoot(b(temp.resolve("alias/child").toString())));
            api.unlink(r, b("alias"), false);
            Process fifo = tool("mkfifo", temp.resolve("fifo").toString());
            check(fifo.waitFor() == 0);
            check(api.kind(r, b("fifo")) == PosixNative.OTHER);
            fails(22, "openFile", () -> api.openFile(r, b("fifo"), false));
            fails(22, "openFile", () -> api.openFile(r, b("fifo"), true));
            // Owned device node only. A real device rejection is tested when mknod is permitted.
            Process node = tool("mknod", temp.resolve("device").toString(), "c", "1", "3");
            if (node.waitFor() == 0) {
                fails(22, "openFile", () -> api.openFile(r, b("device"), false));
                fails(22, "openFile", () -> api.openFile(r, b("device"), true));
                api.unlink(r, b("device"), false);
            } else System.out.println("SKIP owned device node: mknod privilege unavailable");
            // Repeated error paths must not leak O_PATH pins or procfs/listing descriptors.
            api.entries(r, 10); fdCount();
            long before = fdCount();
            for (int i = 0; i < 100; ++i) {
                fails(22, "openFile", () -> api.openFile(r, b("fifo"), true));
                fails(75, "entries", () -> api.entries(r, 1));
                fails(2, "openFile", () -> api.openFile(r, b("missing"), false));
            }
            check(fdCount() == before);
            api.unlink(r, b("fifo"), false);
            api.unlink(r, b("sub"), true);
            api.sync(r);
            check(api.entries(r, 0).length == 0);
            long[] id = api.identity(r);
            String material = Long.toUnsignedString(id[0]) + ":" + Long.toUnsignedString(id[1]);
            String name = "manure-" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b(material)));
            fails(22, "claim", () -> api.claim(null));
            fails(22, "claim", () -> api.claim(new byte[]{0}));
            fails(22, "claim", () -> api.claim(new byte[108]));
            fails(22, "claim", () -> api.claim(b("x".repeat(108))));
            int claim = api.claim(b(name));
            try {
                fails(98, "claim", () -> load(args).claim(b(name))); // independent instances
                Process competitor = child(args, "contend", name);
                check(competitor.waitFor(10, TimeUnit.SECONDS));
                check(competitor.exitValue() == 0);
                String python = "import errno,hashlib,os,socket,sys\n" +
                    "st=os.stat(sys.argv[1]); name='\\0manure-'+hashlib.sha256(('%d:%d'%(st.st_dev,st.st_ino)).encode()).hexdigest()\n" +
                    "s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)\n" +
                    "try: s.bind(name)\n" +
                    "except OSError as e: sys.exit(0 if e.errno==errno.EADDRINUSE else 2)\n" +
                    "sys.exit(3)\n";
                Process pythonPeer = tool("python3", "-c", python, temp.toString());
                check(pythonPeer.waitFor() == 0);
            } finally { api.close(claim); }
            int reclaimed = api.claim(b(name)); api.close(reclaimed);
            String crashName = "manure-test-" + UUID.randomUUID();
            Process holder = child(args, "hold", crashName);
            try (BufferedReader output = new BufferedReader(new InputStreamReader(holder.getInputStream(), StandardCharsets.UTF_8))) {
                check("held".equals(output.readLine()));
                fails(98, "claim", () -> api.claim(b(crashName)));
                holder.destroyForcibly();
                check(holder.waitFor(10, TimeUnit.SECONDS));
                int released = api.claim(b(crashName)); api.close(released);
            } finally { if (holder.isAlive()) { holder.destroyForcibly(); holder.waitFor(); } }
            System.out.println("PASS NativeSelfTest assertions=" + assertions);
        } finally {
            if (root >= 0) api.close(root);
            try (var paths = Files.walk(temp)) {
                for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.delete(path);
            }
        }
    }
}
