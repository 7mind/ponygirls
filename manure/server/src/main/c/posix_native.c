#define _GNU_SOURCE
#define _FILE_OFFSET_BITS 64
#include "manure_storage_PosixNative.h"
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/magic.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/un.h>
#include <unistd.h>

#ifndef __linux__
#error "Manure POSIX bridge requires Linux"
#endif
_Static_assert(sizeof(off_t) >= 8, "64-bit offsets required");
_Static_assert(sizeof(jlong) >= sizeof(ino_t), "inode identity must fit jlong");
_Static_assert(sizeof(jlong) >= sizeof(dev_t), "device identity must fit jlong");

#define JNI_METHOD(name) Java_manure_storage_PosixNative_##name
#define UNUSED_SELF (void)self

/* No cached JNI references or mutable C registry. Never replace a pending JVM exception. */
static void failure(JNIEnv *env, int error, const char *operation) {
    if ((*env)->ExceptionCheck(env)) return;
    jclass cls = (*env)->FindClass(env, "manure/storage/NativeFailure");
    if (cls == NULL) return;
    jmethodID ctor = (*env)->GetMethodID(env, cls, "<init>", "(ILjava/lang/String;)V");
    if (ctor != NULL) {
        jstring label = (*env)->NewStringUTF(env, operation); /* constant ASCII only */
        if (label != NULL) {
            jobject ex = (*env)->NewObject(env, cls, ctor, (jint)error, label);
            if (ex != NULL) {
                (void)(*env)->Throw(env, (jthrowable)ex);
                (*env)->DeleteLocalRef(env, ex);
            }
            (*env)->DeleteLocalRef(env, label);
        }
    }
    (*env)->DeleteLocalRef(env, cls);
}

static void *allocate(JNIEnv *env, size_t size) {
    void *p = malloc(size == 0 ? 1 : size);
    if (p == NULL) {
        jclass cls = (*env)->FindClass(env, "java/lang/OutOfMemoryError");
        if (cls != NULL) {
            (void)(*env)->ThrowNew(env, cls, "native allocation failed");
            (*env)->DeleteLocalRef(env, cls);
        }
    }
    return p;
}

/* Cleanup close is deliberately not retried, even on EINTR (Linux). */
static void discard(int fd) { if (fd >= 0) (void)close(fd); }
static int valid_fd(JNIEnv *env, jint fd, const char *op) {
    if (fd < 0) { failure(env, EBADF, op); return 0; }
    return 1;
}

static char *bytes(JNIEnv *env, jbyteArray array, const char *op, size_t *length) {
    if (array == NULL) { failure(env, EINVAL, op); return NULL; }
    jsize n = (*env)->GetArrayLength(env, array);
    char *s = allocate(env, (size_t)n + 1);
    if (s == NULL) return NULL;
    (*env)->GetByteArrayRegion(env, array, 0, n, (jbyte *)s);
    if ((*env)->ExceptionCheck(env)) { free(s); return NULL; }
    s[n] = '\0';
    if (n == 0 || memchr(s, '\0', (size_t)n) != NULL) {
        free(s); failure(env, EINVAL, op); return NULL;
    }
    *length = (size_t)n;
    return s;
}
static int is_component(const char *s, size_t n) {
    return n > 0 && memchr(s, '/', n) == NULL &&
        !(n == 1 && s[0] == '.') && !(n == 2 && s[0] == '.' && s[1] == '.');
}
static char *component(JNIEnv *env, jbyteArray array, const char *op) {
    size_t n;
    char *s = bytes(env, array, op, &n);
    if (s != NULL && !is_component(s, n)) {
        free(s); failure(env, EINVAL, op); return NULL;
    }
    return s;
}
static int directory_at(int fd, const char *name) {
    int result;
    do { result = openat(fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC); }
    while (result < 0 && errno == EINTR);
    return result;
}
static int stat_fd(int fd, struct stat *st) {
    int r;
    do { r = fstat(fd, st); } while (r < 0 && errno == EINTR);
    return r;
}
static int regular_stat(JNIEnv *env, int fd, const char *op, struct stat *st) {
    if (!valid_fd(env, fd, op)) return 0;
    if (stat_fd(fd, st) < 0) { failure(env, errno, op); return 0; }
    if (!S_ISREG(st->st_mode)) {
        failure(env, S_ISDIR(st->st_mode) ? EISDIR : EINVAL, op); return 0;
    }
    return 1;
}
static int regular_fd(JNIEnv *env, int fd, const char *op) {
    struct stat st;
    return regular_stat(env, fd, op, &st);
}
static int valid_range(JNIEnv *env, jlong offset, jsize length, const char *op) {
    if (offset < 0 || length < 0 || offset > INT64_MAX - (int64_t)length) {
        failure(env, EINVAL, op); return 0;
    }
    return 1;
}

JNIEXPORT void JNICALL JNI_METHOD(check)(JNIEnv *env, jobject self) {
    UNUSED_SELF;
    /* Force a real JNI call at factory time; platform/offset requirements are compile-time. */
    (void)env;
}
JNIEXPORT jint JNICALL JNI_METHOD(openRoot)(JNIEnv *env, jobject self, jbyteArray path) {
    UNUSED_SELF;
    const char *op = "openRoot";
    size_t n;
    char *s = bytes(env, path, op, &n);
    if (s == NULL) return -1;
    /* Root '/' is valid; reject ambiguous empty/dot components before any opens. */
    if (s[0] != '/') { free(s); failure(env, EINVAL, op); return -1; }
    for (size_t start = 1; start < n;) {
        size_t end = start;
        while (end < n && s[end] != '/') ++end;
        if (!is_component(s + start, end - start) || end + 1 == n) {
            free(s); failure(env, EINVAL, op); return -1;
        }
        start = end + 1;
    }
    int fd = directory_at(AT_FDCWD, "/");
    int error = fd < 0 ? errno : 0;
    for (size_t start = 1; fd >= 0 && start < n;) {
        size_t end = start;
        while (end < n && s[end] != '/') ++end;
        s[end] = '\0';
        int child = directory_at(fd, s + start);
        error = child < 0 ? errno : 0;
        discard(fd);
        fd = child;
        start = end + 1;
    }
    free(s);
    if (fd < 0) failure(env, error, op);
    return fd;
}
JNIEXPORT jint JNICALL JNI_METHOD(openDirectory)(JNIEnv *env, jobject self, jint parent, jbyteArray name) {
    UNUSED_SELF;
    const char *op = "openDirectory";
    if (!valid_fd(env, parent, op)) return -1;
    char *s = component(env, name, op);
    if (s == NULL) return -1;
    int fd = directory_at(parent, s);
    int error = errno;
    free(s);
    if (fd < 0) failure(env, error, op);
    return fd;
}
JNIEXPORT void JNICALL JNI_METHOD(mkdir)(JNIEnv *env, jobject self, jint parent, jbyteArray name) {
    UNUSED_SELF;
    const char *op = "mkdir";
    if (!valid_fd(env, parent, op)) return;
    char *s = component(env, name, op);
    if (s == NULL) return;
    int r;
    do { r = mkdirat(parent, s, 0700); } while (r < 0 && errno == EINTR);
    int error = errno;
    free(s);
    if (r < 0) failure(env, error, op);
}
JNIEXPORT jint JNICALL JNI_METHOD(createFile)(JNIEnv *env, jobject self, jint parent, jbyteArray name) {
    UNUSED_SELF;
    const char *op = "createFile";
    if (!valid_fd(env, parent, op)) return -1;
    char *s = component(env, name, op);
    if (s == NULL) return -1;
    int fd;
    do { fd = openat(parent, s, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0600); }
    while (fd < 0 && errno == EINTR);
    int error = errno;
    free(s);
    if (fd < 0) { failure(env, error, op); return -1; }
    if (!regular_fd(env, fd, op)) { discard(fd); return -1; }
    return fd;
}
JNIEXPORT jint JNICALL JNI_METHOD(openFile)(JNIEnv *env, jobject self, jint parent, jbyteArray name, jboolean writable) {
    UNUSED_SELF;
    const char *op = "openFile";
    if (!valid_fd(env, parent, op)) return -1;
    char *s = component(env, name, op);
    if (s == NULL) return -1;
    int pin;
    do { pin = openat(parent, s, O_PATH | O_NOFOLLOW | O_CLOEXEC); }
    while (pin < 0 && errno == EINTR);
    int error = errno;
    free(s);
    if (pin < 0) { failure(env, error, op); return -1; }
    struct stat before, after;
    if (stat_fd(pin, &before) < 0) { error = errno; goto fail_pin; }
    if (!S_ISREG(before.st_mode)) {
        error = S_ISLNK(before.st_mode) ? ELOOP : (S_ISDIR(before.st_mode) ? EISDIR : EINVAL);
        goto fail_pin;
    }
    /* Explicit trusted-procfs pinned-inode reopen. Never reopen the payload name.
     * The process must have genuine procfs at /proc, with its own /proc/self/fd;
     * privileged mount/namespace manipulation and concurrent external close of
     * our descriptors are outside the threat model. Verify procfs before open. */
    int proc = directory_at(AT_FDCWD, "/proc");
    if (proc < 0) { error = errno; goto fail_pin; }
    struct statfs fs;
    if (fstatfs(proc, &fs) < 0) { error = errno; discard(proc); goto fail_pin; }
    if ((unsigned long)fs.f_type != (unsigned long)PROC_SUPER_MAGIC) {
        error = ENOTSUP; discard(proc); goto fail_pin;
    }
    int proc_fds;
    do { proc_fds = openat(proc, "self/fd", O_RDONLY | O_DIRECTORY | O_CLOEXEC); }
    while (proc_fds < 0 && errno == EINTR);
    error = errno;
    discard(proc);
    if (proc_fds < 0) goto fail_pin;
    if (fstatfs(proc_fds, &fs) < 0) { error = errno; discard(proc_fds); goto fail_pin; }
    if ((unsigned long)fs.f_type != (unsigned long)PROC_SUPER_MAGIC) {
        error = ENOTSUP; discard(proc_fds); goto fail_pin;
    }
    char number[32];
    int count = snprintf(number, sizeof(number), "%d", pin);
    if (count < 0 || (size_t)count >= sizeof(number)) {
        error = EOVERFLOW; discard(proc_fds); goto fail_pin;
    }
    int fd;
    do { fd = openat(proc_fds, number, (writable ? O_RDWR : O_RDONLY) | O_CLOEXEC | O_NONBLOCK); }
    while (fd < 0 && errno == EINTR);
    error = errno;
    discard(proc_fds);
    if (fd < 0) goto fail_pin;
    if (stat_fd(fd, &after) < 0) { error = errno; discard(fd); goto fail_pin; }
    if (!S_ISREG(after.st_mode) || before.st_dev != after.st_dev || before.st_ino != after.st_ino) {
        error = ESTALE; discard(fd); goto fail_pin;
    }
    discard(pin);
    return fd;
fail_pin:
    discard(pin);
    failure(env, error, op);
    return -1;
}
JNIEXPORT jlongArray JNICALL JNI_METHOD(identity)(JNIEnv *env, jobject self, jint fd) {
    UNUSED_SELF;
    const char *op = "identity";
    if (!valid_fd(env, fd, op)) return NULL;
    struct stat st;
    if (stat_fd(fd, &st) < 0) { failure(env, errno, op); return NULL; }
    jlong values[2] = {(jlong)st.st_dev, (jlong)st.st_ino};
    jlongArray result = (*env)->NewLongArray(env, 2);
    if (result != NULL) (*env)->SetLongArrayRegion(env, result, 0, 2, values);
    return result;
}
JNIEXPORT jint JNICALL JNI_METHOD(kind)(JNIEnv *env, jobject self, jint parent, jbyteArray name) {
    UNUSED_SELF;
    const char *op = "kind";
    if (!valid_fd(env, parent, op)) return 0;
    char *s = component(env, name, op);
    if (s == NULL) return 0;
    struct stat st;
    int r;
    do { r = fstatat(parent, s, &st, AT_SYMLINK_NOFOLLOW); } while (r < 0 && errno == EINTR);
    int error = errno;
    free(s);
    if (r < 0) { failure(env, error, op); return 0; }
    if (S_ISREG(st.st_mode)) return 1;
    if (S_ISDIR(st.st_mode)) return 2;
    if (S_ISLNK(st.st_mode)) return 3;
    return 4;
}

JNIEXPORT jobjectArray JNICALL JNI_METHOD(entries)(JNIEnv *env, jobject self, jint directory, jint max_entries) {
    UNUSED_SELF;
    const char *op = "entries";
    if (!valid_fd(env, directory, op)) return NULL;
    if (max_entries < 0) { failure(env, EINVAL, op); return NULL; }
    int fd = directory_at(directory, "."); /* new open-file description, not dup */
    if (fd < 0) { failure(env, errno, op); return NULL; }
    DIR *dir = fdopendir(fd);
    if (dir == NULL) { int error = errno; discard(fd); failure(env, error, op); return NULL; }
    char **names = NULL;
    size_t count = 0, capacity = 0;
    int error = 0;
    for (;;) {
        errno = 0;
        struct dirent *entry = readdir(dir);
        if (entry == NULL) { error = errno; break; }
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) continue;
        if (count >= (size_t)max_entries) { error = EOVERFLOW; break; }
        if (count == capacity) {
            size_t next = capacity == 0 ? 16 : capacity * 2;
            if (next > (size_t)max_entries) next = (size_t)max_entries;
            if (next > SIZE_MAX / sizeof(*names)) { error = EOVERFLOW; break; }
            char **grown = allocate(env, next * sizeof(*names));
            if (grown == NULL) break;
            if (count > 0) memcpy(grown, names, count * sizeof(*names));
            free(names); names = grown; capacity = next;
        }
        size_t length = strlen(entry->d_name);
        names[count] = allocate(env, length + 1);
        if (names[count] == NULL) break;
        memcpy(names[count], entry->d_name, length + 1);
        ++count;
    }
    if (closedir(dir) < 0 && error == 0) error = errno;
    jobjectArray result = NULL;
    if (error == 0 && !(*env)->ExceptionCheck(env)) {
        jclass byte_array = (*env)->FindClass(env, "[B");
        if (byte_array != NULL) {
            result = (*env)->NewObjectArray(env, (jsize)count, byte_array, NULL);
            (*env)->DeleteLocalRef(env, byte_array);
        }
        for (size_t i = 0; result != NULL && i < count && !(*env)->ExceptionCheck(env); ++i) {
            jsize n = (jsize)strlen(names[i]);
            jbyteArray value = (*env)->NewByteArray(env, n);
            if (value == NULL) break;
            (*env)->SetByteArrayRegion(env, value, 0, n, (const jbyte *)names[i]);
            if (!(*env)->ExceptionCheck(env)) (*env)->SetObjectArrayElement(env, result, (jsize)i, value);
            (*env)->DeleteLocalRef(env, value);
        }
    }
    for (size_t i = 0; i < count; ++i) free(names[i]);
    free(names);
    if (error != 0) failure(env, error, op);
    return result;
}
JNIEXPORT jbyteArray JNICALL JNI_METHOD(read)(JNIEnv *env, jobject self, jint fd, jlong offset, jint max_bytes) {
    UNUSED_SELF;
    const char *op = "read";
    if (!valid_range(env, offset, max_bytes, op) || !regular_fd(env, fd, op)) return NULL;
    char *data = allocate(env, (size_t)max_bytes);
    if (data == NULL) return NULL;
    size_t done = 0;
    while (done < (size_t)max_bytes) {
        ssize_t n = pread(fd, data + done, (size_t)max_bytes - done, (off_t)offset + (off_t)done);
        if (n < 0) {
            if (errno == EINTR) continue;
            int error = errno; free(data); failure(env, error, op); return NULL;
        }
        if (n == 0) break;
        done += (size_t)n;
    }
    jbyteArray result = (*env)->NewByteArray(env, (jsize)done);
    if (result != NULL) (*env)->SetByteArrayRegion(env, result, 0, (jsize)done, (const jbyte *)data);
    free(data);
    return result;
}
JNIEXPORT void JNICALL JNI_METHOD(write)(JNIEnv *env, jobject self, jint fd, jlong offset, jbyteArray bytes_array) {
    UNUSED_SELF;
    const char *op = "write";
    if (bytes_array == NULL) { failure(env, EINVAL, op); return; }
    jsize length = (*env)->GetArrayLength(env, bytes_array);
    if (!valid_range(env, offset, length, op) || !regular_fd(env, fd, op)) return;
    char *data = allocate(env, (size_t)length);
    if (data == NULL) return;
    (*env)->GetByteArrayRegion(env, bytes_array, 0, length, (jbyte *)data);
    if ((*env)->ExceptionCheck(env)) { free(data); return; }
    size_t done = 0;
    while (done < (size_t)length) {
        ssize_t n = pwrite(fd, data + done, (size_t)length - done, (off_t)offset + (off_t)done);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) {
            int error = n == 0 ? EIO : errno;
            free(data); failure(env, error, op); return;
        }
        done += (size_t)n;
    }
    free(data);
}
JNIEXPORT jlong JNICALL JNI_METHOD(size)(JNIEnv *env, jobject self, jint fd) {
    UNUSED_SELF;
    const char *op = "size";
    struct stat st;
    if (!regular_stat(env, fd, op, &st)) return -1;
    if (st.st_size < 0 || (uintmax_t)st.st_size > (uintmax_t)INT64_MAX) {
        failure(env, EOVERFLOW, op); return -1;
    }
    return (jlong)st.st_size;
}
JNIEXPORT void JNICALL JNI_METHOD(truncate)(JNIEnv *env, jobject self, jint fd, jlong size) {
    UNUSED_SELF;
    const char *op = "truncate";
    if (!valid_range(env, size, 0, op) || !regular_fd(env, fd, op)) return;
    int r;
    do { r = ftruncate(fd, (off_t)size); } while (r < 0 && errno == EINTR);
    if (r < 0) failure(env, errno, op);
}
JNIEXPORT void JNICALL JNI_METHOD(sync)(JNIEnv *env, jobject self, jint fd) {
    UNUSED_SELF;
    const char *op = "sync";
    if (!valid_fd(env, fd, op)) return;
    int r;
    do { r = fsync(fd); } while (r < 0 && errno == EINTR);
    if (r < 0) failure(env, errno, op);
}
JNIEXPORT void JNICALL JNI_METHOD(move)(JNIEnv *env, jobject self, jint source_parent, jbyteArray source,
                                         jint destination_parent, jbyteArray destination) {
    UNUSED_SELF;
    const char *op = "move";
    if (!valid_fd(env, source_parent, op) || !valid_fd(env, destination_parent, op)) return;
    char *s = component(env, source, op);
    if (s == NULL) return;
    char *d = component(env, destination, op);
    if (d == NULL) { free(s); return; }
    int r;
    do { r = renameat(source_parent, s, destination_parent, d); } while (r < 0 && errno == EINTR);
    int error = errno;
    free(s); free(d);
    if (r < 0) failure(env, error, op);
}
JNIEXPORT void JNICALL JNI_METHOD(unlink)(JNIEnv *env, jobject self, jint parent, jbyteArray name, jboolean directory) {
    UNUSED_SELF;
    const char *op = "unlink";
    if (!valid_fd(env, parent, op)) return;
    char *s = component(env, name, op);
    if (s == NULL) return;
    int r;
    do { r = unlinkat(parent, s, directory ? AT_REMOVEDIR : 0); } while (r < 0 && errno == EINTR);
    int error = errno;
    free(s);
    if (r < 0) failure(env, error, op);
}
JNIEXPORT jint JNICALL JNI_METHOD(claim)(JNIEnv *env, jobject self, jbyteArray name) {
    UNUSED_SELF;
    const char *op = "claim";
    size_t n;
    char *s = bytes(env, name, op, &n);
    if (s == NULL) return -1;
    struct sockaddr_un address = {0};
    if (n > sizeof(address.sun_path) - 1) {
        free(s); failure(env, EINVAL, op); return -1;
    }
    address.sun_family = AF_UNIX;
    memcpy(address.sun_path + 1, s, n);
    free(s);
    int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) { failure(env, errno, op); return -1; }
    if (bind(fd, (const struct sockaddr *)&address,
             (socklen_t)(offsetof(struct sockaddr_un, sun_path) + 1 + n)) < 0) {
        int error = errno; discard(fd); failure(env, error, op); return -1;
    }
    return fd;
}
JNIEXPORT void JNICALL JNI_METHOD(close)(JNIEnv *env, jobject self, jint fd) {
    UNUSED_SELF;
    const char *op = "close";
    if (!valid_fd(env, fd, op)) return;
    if (close(fd) < 0) failure(env, errno, op); /* no EINTR retry */
}
