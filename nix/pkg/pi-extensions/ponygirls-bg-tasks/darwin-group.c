#include <errno.h>
#include <libproc.h>
#include <stdbool.h>
#include <sys/proc.h>

#define GROUP_SNAPSHOT_CAPACITY 64

enum group_observation {
    GROUP_ERROR = -1,
    GROUP_EMPTY,
    GROUP_NOT_SETTLED,
    GROUP_LIVE,
};

int bg_group_observe(pid_t pgid, int check_live)
{
    if (pgid <= 1) {
        errno = EINVAL;
        return GROUP_ERROR;
    }

    pid_t members[GROUP_SNAPSHOT_CAPACITY];
    int capacity = sizeof(members);
    errno = 0;
    int bytes = proc_listpids(PROC_PGRP_ONLY, (uint32_t)pgid, members, capacity);
    if (bytes < 0 || errno != 0) {
        if (errno == 0) {
            errno = EIO;
        }
        return GROUP_ERROR;
    }
    if (bytes >= capacity || bytes % sizeof(pid_t) != 0) {
        errno = EOVERFLOW;
        return GROUP_ERROR;
    }

    bool others = false;
    size_t count = (size_t)bytes / sizeof(pid_t);
    for (size_t i = 0; i < count; i++) {
        pid_t member = members[i];
        if (member <= 0) {
            errno = EIO;
            return GROUP_ERROR;
        }
        if (member != pgid) {
            others = true;
        }
    }
    if (!others) {
        return GROUP_EMPTY;
    }

    if (check_live) {
        for (size_t i = 0; i < count; i++) {
            pid_t member = members[i];
            if (member == pgid) {
                continue;
            }
            struct proc_bsdshortinfo info;
            int size = proc_pidinfo(member, PROC_PIDT_SHORTBSDINFO, 0, &info, sizeof(info));
            if (size == sizeof(info) && info.pbsi_pid == (uint32_t)member &&
                info.pbsi_pgid == (uint32_t)pgid &&
                (info.pbsi_status == SRUN || info.pbsi_status == SSLEEP || info.pbsi_status == SSTOP)) {
                return GROUP_LIVE;
            }
        }
    }
    return GROUP_NOT_SETTLED;
}
