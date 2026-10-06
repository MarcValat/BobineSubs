from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from synthetic import dialogue_cues, edited, translated

from syncsubtitles.server import app
from syncsubtitles.subformats import SRT, SubtitleDocument, read_file

client = TestClient(app)


@pytest.fixture
def pair(tmp_path: Path) -> tuple[Path, Path]:
    ref_cues = dialogue_cues(900.0)
    ref = tmp_path / "vo.en.srt"
    vf = tmp_path / "episode.fr.srt"
    ref.write_text(SubtitleDocument(SRT, ref_cues).to_text(), encoding="utf-8")
    vf.write_text(SubtitleDocument(SRT, edited(translated(ref_cues, -1.0), [(450.0, 0.5)])).to_text(), encoding="utf-8")
    return ref, vf


def _wait(job_id: str) -> dict:
    for _ in range(300):
        state = client.get(f"/jobs/{job_id}").json()
        if state["status"] != "running":
            return state
        time.sleep(0.05)
    raise AssertionError("job never finished")


def test_probe_a_subtitle_file(pair):
    body = client.get("/probe", params={"path": str(pair[1])}).json()
    assert body["kind"] == "subtitles" and body["cue_count"] > 100 and body["tracks"] == []


def test_probe_a_missing_file_is_a_400():
    assert client.get("/probe", params={"path": "nope.mkv"}).status_code == 400


def test_analyze_then_render_with_hand_edited_segments(pair, tmp_path):
    ref, vf = pair
    job = client.post("/jobs/analyze", json={"reference": {"path": str(ref)}, "target": {"path": str(vf)}}).json()
    state = _wait(job["job_id"])
    assert state["status"] == "done", state
    result = state["result"]
    assert len(result["segments"]) == 2
    assert result["segments"][0]["offset_start"] == pytest.approx(-1.0, abs=0.05)
    assert len(result["target_cues"]) == len(read_file(vf).cues)
    assert all(c["corrected"] is not None for c in result["target_cues"])
    assert any("Recherche" in m for m in state["messages"])

    # A deliberately different single segment: the export must use it as given.
    segments = [{"start_s": 0.0, "end_s": 1000.0, "offset_start": 2.0, "offset_end": 2.0}]
    out = tmp_path / "out.srt"
    job = client.post(
        "/jobs/render",
        json={"reference": result["reference"], "target": result["target"], "segments": segments, "output": str(out)},
    ).json()
    state = _wait(job["job_id"])
    assert state["status"] == "done", state
    assert read_file(out).cues[5].start == pytest.approx(read_file(vf).cues[5].start - 2.0, abs=0.001)


def test_preview_follows_the_given_segments(pair):
    segments = [{"start_s": 0.0, "end_s": 1000.0, "offset_start": 1.0, "offset_end": 1.0}]
    body = client.post("/preview", json={"target": {"path": str(pair[1])}, "segments": segments}).json()
    first = read_file(pair[1]).cues[0]
    assert body["corrected"][0] == pytest.approx([first.start - 1.0, first.end - 1.0])


def test_analysis_error_is_reported_by_the_job(tmp_path, pair):
    empty = tmp_path / "empty.srt"
    empty.write_text("")
    job = client.post("/jobs/analyze", json={"reference": {"path": str(empty)}, "target": {"path": str(pair[1])}}).json()
    state = _wait(job["job_id"])
    assert state["status"] == "error" and "aucune réplique" in state["error"]


def test_default_output(pair):
    body = client.get("/default-output", params={"reference": "D:/Films/Film.mkv", "target": str(pair[1])}).json()
    assert Path(body["path"]) == Path("D:/Films/Film.synced.mkv")
    body = client.get("/default-output", params={"reference": "D:/Films/Film.mkv", "target": str(pair[1]), "subs_only": True}).json()
    assert body["path"].endswith("episode.fr.synced.srt")


def test_job_websocket_streams_progress_then_result(pair):
    job = client.post("/jobs/analyze", json={"reference": {"path": str(pair[0])}, "target": {"path": str(pair[1])}}).json()
    kinds = []
    with client.websocket_connect(f"/jobs/{job['job_id']}/ws") as ws:
        while True:
            message = ws.receive_json()
            kinds.append(message["type"])
            if message["type"] != "log":
                break
    assert "log" in kinds and kinds[-1] == "done"


def test_cancelled_export_leaves_no_file(tmp_path, monkeypatch):
    import syncsubtitles.render as render_module
    from syncsubtitles.cancellation import Cancelled

    def cancelled(cmd):
        Path(cmd[-1]).write_bytes(b"half a file")
        raise Cancelled()

    monkeypatch.setattr(render_module, "run_checked", cancelled)
    monkeypatch.setattr(render_module, "probe_streams", lambda _path: [])
    monkeypatch.setattr(render_module, "remux_shift", lambda _path: 0.0)
    out = tmp_path / "out.mkv"
    with pytest.raises(Cancelled):
        render_module.mux("in.mkv", SubtitleDocument(SRT, []), out, render_module.TrackMetadata())
    assert list(tmp_path.iterdir()) == []


def test_default_output_in_a_chosen_folder(pair):
    body = client.get(
        "/default-output", params={"reference": "D:/Films/Film.mkv", "target": str(pair[1]), "folder": "E:/Out"}
    ).json()
    assert Path(body["path"]) == Path("E:/Out/Film.synced.mkv")


def test_expand_a_folder_in_episode_order(tmp_path):
    for name in ["E10.mkv", "E2.mkv", "notes.txt", "E1.srt"]:
        (tmp_path / name).write_text("")
    body = client.post("/paths/expand", json={"paths": [str(tmp_path)], "extensions": ["mkv", "srt"]}).json()
    assert [Path(f).name for f in body["files"]] == ["E1.srt", "E2.mkv", "E10.mkv"]


def test_pairs_endpoint():
    body = client.post("/pairs", json={"videos": ["S01E02.mkv", "S01E01.mkv"], "subtitles": ["1x01.srt"]}).json()
    assert body["pairs"] == [
        {"video": "S01E01.mkv", "subtitle": "1x01.srt", "by": "episode"},
        {"video": "S01E02.mkv", "subtitle": None, "by": None},
    ]


def test_plan_outputs_keeps_names_in_another_folder(tmp_path, pair):
    out = tmp_path / "out"
    out.mkdir()
    items = [[{"path": "D:/S/E01.mp4", "index": None}, {"path": str(pair[1]), "index": None}]]
    body = client.post("/plan-outputs", json={"items": items, "folder": str(out)}).json()
    assert body["paths"] == [str(out / "E01.mkv")]
    body = client.post("/plan-outputs", json={"items": items, "folder": str(out), "subs_only": True}).json()
    assert body["paths"] == [str(out / "episode.fr.srt")]
    body = client.post("/plan-outputs", json={"items": items}).json()
    assert Path(body["paths"][0]) == Path("D:/S/E01.synced.mkv")
