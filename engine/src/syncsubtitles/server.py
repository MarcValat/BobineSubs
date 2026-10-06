"""HTTP sidecar exposing the engine to the app (a thin layer over ``service``).

Quick requests (probe, default output path) answer directly. Analysis and
export run as jobs: ``POST /jobs/...`` returns a ``job_id`` at once, and
``WS /jobs/{job_id}/ws`` streams the job's progress messages, ending with
its result, its error or its cancellation.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from syncsubtitles.ffmpeg_backend import FFmpegError, probe_duration, probe_subtitle_streams, subtitle_format
from syncsubtitles.jobs import get_job, start_job
from syncsubtitles.models import SubtitleTrackSpec
from syncsubtitles.render import default_mkv_output, default_subtitle_output
from syncsubtitles.retime import Segment
from syncsubtitles.service import Analysis, AnalysisError, analyze, load_target, write_result
from syncsubtitles.subformats import read_file
from syncsubtitles.tracks import SUBTITLE_EXTENSIONS

app = FastAPI(title="SyncSubtitles", version="0.1.0")

# Only ever bound to 127.0.0.1 (see `syncsubtitles serve`): open CORS just
# lets the app's webview (tauri://..., localhost:1420 in dev) call it.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(FFmpegError)
async def _ffmpeg_error(_request: Request, exc: FFmpegError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(AnalysisError)
async def _analysis_error(_request: Request, exc: AnalysisError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


class TrackRef(BaseModel):
    """A subtitle track: a standalone SRT/ASS file, or stream ``index`` of a
    container (``None``: the reference is chosen, see tracks.load_pair)."""

    path: str
    index: int | None = None

    def to_spec(self) -> SubtitleTrackSpec:
        if Path(self.path).suffix.lower() in SUBTITLE_EXTENSIONS:
            return SubtitleTrackSpec(self.path, self.path, None, is_external=True)
        raw = f"{self.path}@{self.index}" if self.index is not None else self.path
        return SubtitleTrackSpec(raw, self.path, self.index)


def _ref(spec: SubtitleTrackSpec) -> TrackRef:
    return TrackRef(path=spec.path, index=None if spec.is_external else spec.stream_index)


# --- probe -------------------------------------------------------------------


class TrackInfo(BaseModel):
    index: int
    codec: str
    # "srt"/"ass" (can be corrected), "pgs"/"vobsub" (reference only), None.
    format: str | None
    language: str | None
    title: str | None
    forced: bool
    default: bool


class ProbeResponse(BaseModel):
    path: str
    # "container": an MKV/MP4... with tracks; "subtitles": a standalone SRT/ASS.
    kind: str
    duration: float | None
    tracks: list[TrackInfo]
    cue_count: int | None = None


@app.get("/probe", response_model=ProbeResponse)
def probe(path: str) -> ProbeResponse:
    if not Path(path).is_file():
        raise HTTPException(400, f"Fichier introuvable : {path}")
    if Path(path).suffix.lower() in SUBTITLE_EXTENSIONS:
        try:
            doc = read_file(path)
        except (ValueError, OSError) as exc:
            raise HTTPException(400, f"Sous-titres illisibles : {exc}") from exc
        duration = max((c.end for c in doc.cues), default=None)
        return ProbeResponse(path=path, kind="subtitles", duration=duration, tracks=[], cue_count=len(doc.cues))
    tracks = [
        TrackInfo(
            index=s.index,
            codec=s.codec,
            format=subtitle_format(s.codec),
            language=s.language,
            title=s.title,
            forced=s.forced,
            default=s.default,
        )
        for s in probe_subtitle_streams(path)
    ]
    return ProbeResponse(path=path, kind="container", duration=probe_duration(path), tracks=tracks)


@app.get("/default-output")
def default_output(reference: str, target: str, target_index: int | None = None, subs_only: bool = False) -> dict[str, str]:
    """Where an export goes unless told otherwise."""
    if subs_only:
        spec = TrackRef(path=target, index=target_index).to_spec()
        fmt = Path(target).suffix.lower().lstrip(".") if spec.is_external else "srt"
        if not spec.is_external:
            streams = probe_subtitle_streams(target)
            if target_index is not None and target_index < len(streams):
                fmt = subtitle_format(streams[target_index].codec) or "srt"
        return {"path": str(default_subtitle_output(spec, "ass" if fmt == "ssa" else fmt))}
    return {"path": str(default_mkv_output(reference))}


@app.get("/exists")
def exists(path: str) -> dict[str, bool]:
    """Whether an export would overwrite something (the app warns first)."""
    return {"exists": Path(path).exists()}


# --- jobs --------------------------------------------------------------------


class JobStarted(BaseModel):
    job_id: str


class SegmentModel(BaseModel):
    start_s: float
    end_s: float
    offset_start: float
    offset_end: float
    confidence: float = 1.0

    @classmethod
    def of(cls, seg: Segment) -> SegmentModel:
        return cls(**{k: getattr(seg, k) for k in cls.model_fields})

    def to_segment(self) -> Segment:
        return Segment(self.start_s, self.end_s, self.offset_start, self.offset_end, self.confidence)


class TargetCueModel(BaseModel):
    start: float
    end: float
    text: str
    group: int
    corrected: tuple[float, float] | None


class AnalysisModel(BaseModel):
    reference: TrackRef
    target: TrackRef
    reference_choice: str | None
    ratio: float
    ratio_name: str | None
    segments: list[SegmentModel]
    reference_cues: list[tuple[float, float]]
    target_cues: list[TargetCueModel]
    warnings: list[str]

    @classmethod
    def of(cls, a: Analysis) -> AnalysisModel:
        return cls(
            reference=_ref(a.reference),
            target=_ref(a.target),
            reference_choice=a.reference_choice,
            ratio=a.ratio,
            ratio_name=a.ratio_name,
            segments=[SegmentModel.of(s) for s in a.segments],
            reference_cues=a.reference_cues,
            target_cues=[TargetCueModel(**vars(c)) for c in a.target_cues],
            warnings=a.warnings,
        )


class AnalyzeRequest(BaseModel):
    reference: TrackRef
    target: TrackRef
    constant: bool = False


@app.post("/jobs/analyze", response_model=JobStarted)
def start_analyze(req: AnalyzeRequest) -> JobStarted:
    def run(log):
        return AnalysisModel.of(analyze(req.reference.to_spec(), req.target.to_spec(), req.constant, log)).model_dump()

    return JobStarted(job_id=start_job(run).id)


class RenderRequest(BaseModel):
    reference: TrackRef
    target: TrackRef
    # Possibly edited by hand: exported as given, never re-detected.
    segments: list[SegmentModel]
    output: str | None = None
    subs_only: bool = False
    language: str | None = None
    title: str | None = None
    default: bool | None = None


@app.post("/jobs/render", response_model=JobStarted)
def start_render(req: RenderRequest) -> JobStarted:
    if not req.segments:
        raise HTTPException(400, "Aucun segment à appliquer.")
    if req.reference.index is None and not req.reference.to_spec().is_external:
        raise HTTPException(400, "Piste de référence non précisée.")

    def run(log):
        written = write_result(
            req.reference.to_spec(),
            req.target.to_spec(),
            [s.to_segment() for s in req.segments],
            req.output,
            req.subs_only,
            req.language,
            req.title,
            req.default,
            log,
        )
        log(f"Écrit : {written.path}")
        return {
            "path": str(written.path),
            "kind": written.kind,
            "language": written.language,
            "dropped": [{"start": start, "text": text} for start, text in written.dropped],
        }

    return JobStarted(job_id=start_job(run).id)


class PreviewRequest(BaseModel):
    target: TrackRef
    segments: list[SegmentModel]


@app.post("/preview")
def preview(req: PreviewRequest) -> dict[str, list[tuple[float, float] | None]]:
    """Where each target cue lands under ``segments`` (None: dropped), for
    the app to redraw after a hand edit."""
    from syncsubtitles.service import corrected_cues

    doc = load_target(req.target.to_spec())
    return {"corrected": corrected_cues(doc, [s.to_segment() for s in req.segments])}


@app.websocket("/jobs/{job_id}/ws")
async def job_ws(websocket: WebSocket, job_id: str) -> None:
    await websocket.accept()
    job = get_job(job_id)
    if job is None:
        await websocket.send_json({"type": "error", "message": f"Tâche inconnue : {job_id}"})
        await websocket.close()
        return
    since = 0
    try:
        while True:
            messages, since, status, result, error = job.snapshot(since)
            for message in messages:
                await websocket.send_json({"type": "log", "message": message})
            if status != "running":
                if status == "done":
                    await websocket.send_json({"type": "done", "result": result})
                elif status == "cancelled":
                    await websocket.send_json({"type": "cancelled"})
                else:
                    await websocket.send_json({"type": "error", "message": error})
                break
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        return
    await websocket.close()


@app.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(404, f"Tâche inconnue : {job_id}")
    messages, _, status, result, error = job.snapshot()
    return {"status": status, "messages": messages, "result": result, "error": error}


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict[str, bool]:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(404, f"Tâche inconnue : {job_id}")
    job.cancel()
    return {"cancelled": True}
