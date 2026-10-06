"""Stopping a running job (an export started too early...) from outside it.

A job's thread carries a cancel event (``jobs.start_job`` sets it); every
ffmpeg run of that job watches it and kills ffmpeg as soon as it's set (see
``ffmpeg_backend._run``), so a long render stops within a fraction of a
second instead of running to its end.
"""

from __future__ import annotations

import threading
from contextvars import ContextVar

_cancel_event: ContextVar[threading.Event | None] = ContextVar("syncsubtitles_cancel_event", default=None)


class Cancelled(Exception):
    """The job doing this was cancelled."""


def current_cancel_event() -> threading.Event | None:
    """The cancel event of the job running on this thread, if any."""
    return _cancel_event.get()


def bind_cancel_event(event: threading.Event) -> None:
    """Make ``event`` the cancel event of whatever runs next on this thread."""
    _cancel_event.set(event)


def check_cancelled() -> None:
    """Raise ``Cancelled`` if the current job was cancelled."""
    event = _cancel_event.get()
    if event is not None and event.is_set():
        raise Cancelled()
