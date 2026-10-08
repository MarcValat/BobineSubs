# syncsubtitles engine

Python engine of Bobine Subs: retimes a subtitle track (SRT/ASS) onto a reference subtitle track, handling a constant offset, a frame-rate drift and jumps (ad breaks, cut scenes), then muxes it into the MKV.

```
uv sync
uv run pytest
```

## CLI

```
uv run syncsubtitles probe Film.mkv                     # subtitle tracks: @0, @1...
uv run syncsubtitles align Film.mkv Film.mkv@2          # what would be corrected
uv run syncsubtitles render Film.mkv Film.mkv@2         # French track of the MKV replaced by its corrected version
uv run syncsubtitles render Film.mkv Film.fr.srt        # external file added to the MKV
uv run syncsubtitles render Film.mkv Film.fr.srt --subs-only   # corrected .srt only
```

- A track is `file.srt` / `file.ass`, or `file.mkv@N` (N among subtitle tracks, from 0). A reference MKV without `@N` uses its fullest non-forced track.
- The reference can be text (SRT, ASS) or image (PGS, VobSub: only their timing is read); the target must be text.
- Output: `Film.synced.mkv` next to the reference by default; the source file is never modified. `--language`, `--title`, `--default` for the new track, `--constant` for a single offset.
- Sound descriptions (`[music]`), lyrics, ASS signs/karaoke are ignored for syncing but retimed like everything else.

## How

Each track becomes a "line on screen" signal; the target's speed ratio is picked among the standard frame-rate conversions; a Viterbi pass gives every target line its own offset, a change of offset (a jump) costing a penalty; lines with no counterpart in the reference are set aside. See `segments.py`.
