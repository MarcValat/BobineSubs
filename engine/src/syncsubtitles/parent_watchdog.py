"""Exit this process as soon as a given parent process is gone.

The GUI launches the sidecar and is supposed to stop it on exit, but an
exit handler never runs on a crash, a forced kill, or when the in-app
updater terminates the app to replace its files -- and a sidecar left
running keeps its own exe locked, which made the next update's installer
fail ("Error opening file for writing: ...\\syncsubtitles-engine.exe"). This
makes the sidecar responsible for its own lifetime instead: it watches the
GUI's PID and exits the moment that process disappears, however it went.
"""

from __future__ import annotations

import os
import sys
import threading
import time

_POLL_INTERVAL_S = 1.0


def _wait_windows(pid: int) -> bool:
    """Block until `pid` exits. Returns False if it can't be watched at all.

    Waits on a process handle rather than polling the PID: the handle is
    opened while the parent is still alive and keeps referring to that
    exact process, so a later PID reuse by an unrelated process can't fool
    it.
    """
    import ctypes

    synchronize = 0x00100000
    infinite = 0xFFFFFFFF
    error_invalid_parameter = 87  # what OpenProcess reports for a PID that doesn't exist

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.restype = ctypes.c_void_p
    kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    handle = kernel32.OpenProcess(synchronize, False, pid)
    if not handle:
        # Already gone -> same as having watched it exit. Any other failure
        # (e.g. access denied) means we genuinely can't watch it: don't kill
        # a healthy server over that.
        return ctypes.get_last_error() == error_invalid_parameter
    kernel32.WaitForSingleObject(handle, infinite)
    return True


def _wait_posix(pid: int) -> bool:
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except PermissionError:
            pass  # exists, just not ours to signal
        time.sleep(_POLL_INTERVAL_S)


def _watch(pid: int) -> None:
    exited = _wait_windows(pid) if sys.platform == "win32" else _wait_posix(pid)
    if exited:
        # os._exit, not sys.exit: this runs on a background thread, and the
        # point is to go down immediately regardless of what uvicorn or an
        # in-flight job is doing on the others.
        os._exit(0)


def exit_when_parent_dies(pid: int) -> None:
    """Start watching `pid` on a daemon thread; returns immediately."""
    threading.Thread(target=_watch, args=(pid,), name="parent-watchdog", daemon=True).start()
