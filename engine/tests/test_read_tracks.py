"""A file's subtitle tracks read once (as it's listed), their line counts
for the app, and the analysis starting from them."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_mux import mkv  # noqa: F401 - fixture

import syncsubtitles.ffmpeg_backend as backend
from syncsubtitles.server import app

client = TestClient(app)


def test_read_tracks_counts_each_tracks_lines(mkv: Path):  # noqa: F811
    body = client.post("/read-tracks", json={"path": str(mkv)}).json()
    assert body == {"cues": {"0": 2, "1": 1}}


def test_tracks_already_read_are_not_read_again(mkv: Path, monkeypatch: pytest.MonkeyPatch):  # noqa: F811
    client.post("/read-tracks", json={"path": str(mkv)})
    calls = []
    real = backend._extract_subtitles
    monkeypatch.setattr(
        backend, "_extract_subtitles", lambda path, indices: calls.append(indices) or real(path, indices)
    )
    assert len(backend.extract_subtitles(str(mkv), [1])[1].cues) == 1
    assert calls == []


def test_a_changed_file_is_read_again(mkv: Path, monkeypatch: pytest.MonkeyPatch):  # noqa: F811
    backend.extract_subtitles(str(mkv), [0])
    calls = []
    real = backend._extract_subtitles
    monkeypatch.setattr(
        backend, "_extract_subtitles", lambda path, indices: calls.append(indices) or real(path, indices)
    )
    # Same content, a newer date.
    stat = mkv.stat()
    os.utime(mkv, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    backend.extract_subtitles(str(mkv), [0])
    assert calls == [[0]]


def test_read_tracks_of_a_missing_file_is_a_400():
    assert client.post("/read-tracks", json={"path": "nope.mkv"}).status_code == 400
