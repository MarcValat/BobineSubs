from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SubtitleTrackSpec:
    """A subtitle track, parsed from a CLI argument.

    Either a subtitle stream inside a container (``path@INDEX``, ``INDEX``
    counted among subtitle streams only, like ffmpeg's ``0:s:N``), or a
    standalone SRT/ASS file (``stream_index`` is ``None``).
    """

    raw: str
    path: str
    stream_index: int | None = None

    @property
    def is_external(self) -> bool:
        return self.stream_index is None


@dataclass(frozen=True)
class StreamInfo:
    """One stream of a container, in the container's own order."""

    index: int  # global index, like ffmpeg's 0:N
    kind: str  # "Video", "Audio", "Subtitle", "Attachment", "Data"
    codec: str | None
    language: str | None
    title: str | None
    default: bool
    forced: bool


@dataclass(frozen=True)
class SubtitleStreamInfo:
    """One subtitle stream of a container."""

    index: int  # among subtitle streams only, like ffmpeg's 0:s:N
    global_index: int
    codec: str
    language: str | None
    title: str | None
    # Forced subtitles (only the lines the audio doesn't cover), by
    # disposition or, as many files only say it there, by title.
    forced: bool
    default: bool
