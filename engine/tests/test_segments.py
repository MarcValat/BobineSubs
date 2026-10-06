import numpy as np
import pytest
from synthetic import dialogue_cues, edited, translated

from syncsubtitles.retime import retime
from syncsubtitles.segments import STANDARD_RATIOS, detect_segments
from syncsubtitles.subformats import SRT, SubtitleDocument

PAL = STANDARD_RATIOS[2]  # 23.976 film played at 25 fps: the target runs fast


def _check(jumps=(), ratio=1.0, offset=0.0, duration=2400.0):
    """Detect, correct, and compare every corrected line to where it belongs."""
    ref_cues = dialogue_cues(duration)
    target = edited(translated(ref_cues, offset), list(jumps), ratio)
    detection = detect_segments(SubtitleDocument(SRT, ref_cues), SubtitleDocument(SRT, target))
    corrected = retime(SubtitleDocument(SRT, target), detection.segments)

    truth = {c.text: c.start for c in ref_cues}
    # No real line is ever lost (only lines of a scene the video lacks).
    assert {c.text for c in target} - {c.text for c in corrected.cues} <= {"extra"}
    errors = np.array([c.start - truth[c.text] for c in corrected.cues if c.text in truth])
    # translated() jitters every edge by up to 0.2 s: that much is the
    # dub's own timing, not a sync error.
    assert abs(np.median(errors)) < 0.03
    assert np.mean(np.abs(errors) > 0.25) < 0.01
    return detection


def test_constant_offset_is_one_segment():
    detection = _check(offset=-3.4)
    assert len(detection.segments) == 1
    assert detection.ratio == 1.0


@pytest.mark.parametrize(
    "jumps",
    [
        [(600.0, 0.5)],  # a few frames more in an ad break
        [(600.0, -0.5)],
        [(500.0, 45.0)],  # a whole scene only the target has
        [(500.0, -45.0)],  # a scene missing from the target
        [(400.0, -1.0), (900.0, 0.6), (1500.0, 0.3), (2000.0, -20.0)],
    ],
)
def test_jumps_are_found_and_corrected(jumps):
    detection = _check(jumps=jumps)
    assert len(detection.segments) == len(jumps) + 1


@pytest.mark.parametrize("ratio", [PAL, 1 / PAL, STANDARD_RATIOS[3]])
def test_frame_rate_drift_is_found_and_corrected(ratio):
    detection = _check(ratio=ratio, offset=1.2)
    assert detection.ratio == pytest.approx(ratio)


def test_drift_and_jumps_together():
    detection = _check(jumps=[(700.0, -0.8), (1600.0, 30.0)], ratio=PAL)
    assert detection.ratio == pytest.approx(PAL)
    assert len(detection.segments) == 3


def test_scene_only_in_the_target_has_its_lines_dropped():
    ref_cues = dialogue_cues(1800.0)
    target = edited(translated(ref_cues), [(600.0, 60.0)])
    detection = detect_segments(SubtitleDocument(SRT, ref_cues), SubtitleDocument(SRT, target))
    corrected = retime(SubtitleDocument(SRT, target), detection.segments)
    extra = sum(c.text == "extra" for c in target)
    assert extra > 10
    assert sum(c.text == "extra" for c in corrected.cues) <= 1
