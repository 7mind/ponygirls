"""Real supervisor with an explicitly injected, signal-advanceable test clock."""
import os
import signal
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import supervisor as sv  # noqa: E402


class AdvanceableClock(sv.SystemClock):
    def __init__(self):
        self.offset = 0.0

    def monotonic(self):
        return super().monotonic() + self.offset

    def advance(self, *_):
        self.offset += sv.RECONNECT_WAIT_MS / 1000 + 1


if __name__ == "__main__":
    clock = AdvanceableClock()
    signal.signal(signal.SIGUSR1, clock.advance)
    sys.exit(sv.main(sys.argv[1:], clock=clock))
