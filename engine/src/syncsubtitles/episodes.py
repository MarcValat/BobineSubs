"""Pair a series' videos with its subtitle files by episode number.

Subtitles downloaded separately rarely share the videos' names
("Show.S01E03.1080p.mkv" / "show - 1x03 - Title.fr.srt"), and a missing
file would shift a pairing by position for every episode after it: the
number in the name is the reliable link.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

# Most specific first. Years (1999, 2024) and resolutions (720, 1080) must
# never pass for an episode number.
_PATTERNS = [
    re.compile(r"s(?P<s>\d{1,2})[ ._-]*e(?P<e>\d{1,3})(?!\d)", re.IGNORECASE),
    re.compile(r"(?<![\dx])(?P<s>\d{1,2})x(?P<e>\d{1,3})(?!\d)", re.IGNORECASE),
    re.compile(r"(?:episode|[ée]pisode|ep|e)[ ._-]*(?P<e>\d{1,3})(?!\d)", re.IGNORECASE),
    # A lone number: "Show - 03 - Title", "[Group] Show 12 [1080p]".
    re.compile(r"(?:^|[ ._\-\[(])(?P<e>\d{1,3})(?:v\d)?(?=[ ._\-\])]|$)"),
]
_NOT_EPISODES = re.compile(r"(?<!\d)(?:480|576|720|1080|2160)[pi]?(?!\d)|(?<!\d)(?:19|20)\d\d(?!\d)|\b[xh]\.?26[45]\b", re.IGNORECASE)


def natural_key(name: str) -> list[int | str]:
    """Sorts "Episode 2" before "Episode 10"."""
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", name.lower())]


def episode_key(path: str) -> tuple[int | None, int] | None:
    """(season or None, episode) from a file name, or None."""
    name = _NOT_EPISODES.sub(" ", Path(path).stem)
    for pattern in _PATTERNS:
        if match := pattern.search(name):
            season = match.groupdict().get("s")
            return (int(season) if season else None, int(match["e"]))
    return None


@dataclass(frozen=True)
class Pair:
    video: str | None
    subtitle: str | None
    # "episode": same number in both names; "order": paired by position
    # among the files left once numbers are matched; None: alone.
    by: str | None


def _same_episode(a: tuple[int | None, int], b: tuple[int | None, int]) -> bool:
    return a[1] == b[1] and (a[0] is None or b[0] is None or a[0] == b[0])


def pair_files(videos: list[str], subtitles: list[str]) -> list[Pair]:
    """One row per video (name order), with its subtitle file; subtitles
    left over get rows of their own at the end."""
    videos = sorted(videos, key=lambda p: natural_key(Path(p).name))
    subtitles = sorted(subtitles, key=lambda p: natural_key(Path(p).name))
    keys = {p: episode_key(p) for p in [*videos, *subtitles]}

    matched: dict[str, str] = {}
    free = list(subtitles)
    for video in videos:
        key = keys[video]
        if key is None:
            continue
        candidates = [s for s in free if keys[s] is not None and _same_episode(key, keys[s])]
        # An exact season match beats a season-less one.
        candidates.sort(key=lambda s: keys[s][0] != key[0])
        if candidates:
            matched[video] = candidates[0]
            free.remove(candidates[0])

    rows = []
    leftovers = iter(free)
    for video in videos:
        if video in matched:
            rows.append(Pair(video, matched[video], "episode"))
        else:
            subtitle = next(leftovers, None)
            rows.append(Pair(video, subtitle, "order" if subtitle else None))
    rows.extend(Pair(None, s, None) for s in leftovers)
    return rows
