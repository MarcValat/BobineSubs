# syncsubtitles engine

Python engine of SyncSubtitles: reads the subtitle tracks of an MKV (or an external SRT/ASS file), finds how the target track is shifted against the reference one, rewrites its timestamps and muxes it back.

```
uv sync
uv run syncsubtitles --help
uv run pytest
```
