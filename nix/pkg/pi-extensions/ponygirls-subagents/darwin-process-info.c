#include <errno.h>
#include <limits.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <sys/proc.h>
#include <sys/sysctl.h>

static int absent(pid_t target) {
    if (kill(target, 0) != -1 || errno != ESRCH) return 1;
    puts("dead");
    return 0;
}

static int identity(int mib[4]) {
    struct kinfo_proc info;
    size_t size = sizeof(info);
    if (sysctl(mib, 4, &info, &size, NULL, 0) == -1) return 1;
    if (size == 0) return absent(mib[3]);
    if (size != sizeof(info) || info.kp_proc.p_pid != mib[3]) return 1;
    if (info.kp_proc.p_stat == SZOMB) {
        puts("dead");
        return 0;
    }
    char boot[37];
    size = sizeof(boot);
    if (sysctlbyname("kern.bootsessionuuid", boot, &size, NULL, 0) == -1 ||
        size != sizeof(boot) || boot[sizeof(boot) - 1] != '\0') return 1;
    struct timeval birth = info.kp_proc.p_starttime;
    if (birth.tv_sec <= 0 || birth.tv_usec < 0 || birth.tv_usec >= 1000000) return 1;
    printf("%s %lld.%06d\n", boot, (long long)birth.tv_sec, (int)birth.tv_usec);
    return 0;
}

static int group(int mib[4]) {
    size_t size;
    if (sysctl(mib, 4, NULL, &size, NULL, 0) == -1) return 1;
    if (size == 0) return absent(-mib[3]);
    struct kinfo_proc *members = malloc(size);
    if (!members || sysctl(mib, 4, members, &size, NULL, 0) == -1) return 1;
    if (size == 0) return absent(-mib[3]);
    if (size % sizeof(*members) != 0) return 1;
    for (size_t i = 0; i < size / sizeof(*members); i++) {
        if (members[i].kp_eproc.e_pgid != mib[3]) return 1;
        if (members[i].kp_proc.p_stat != SZOMB) {
            puts("live");
            return 0;
        }
    }
    puts("dead");
    return 0;
}

int main(int argc, char **argv) {
    if (argc != 3) return 1;
    char *end;
    long id = strtol(argv[2], &end, 10);
    if (*end != '\0' || id <= 1 || id > INT_MAX) return 1;
    int mib[] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, (int)id };
    if (strcmp(argv[1], "pid") == 0) return identity(mib);
    if (strcmp(argv[1], "group") != 0) return 1;
    mib[2] = KERN_PROC_PGRP;
    return group(mib);
}
