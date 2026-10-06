import pytest
from synthetic import dialogue_cues, translated

from syncsubtitles.detect import detect_constant
from syncsubtitles.retime import Segment, remap_time, retime
from syncsubtitles.subformats import SRT, SubtitleDocument


@pytest.mark.parametrize("offset", [-7.3, -0.4, 0.0, 2.15, 95.0])
def test_constant_offset_is_recovered_from_a_translated_track(offset):
    ref = SubtitleDocument(SRT, dialogue_cues())
    tgt = SubtitleDocument(SRT, translated(ref.cues, offset))
    detection = detect_constant(ref, tgt)
    assert detection.segments[0].offset_start == pytest.approx(offset, abs=0.05)
    assert not detection.ambiguous


def test_retime_brings_the_target_back_onto_the_reference():
    ref = SubtitleDocument(SRT, dialogue_cues())
    tgt = SubtitleDocument(SRT, translated(ref.cues, 3.0))
    corrected = retime(tgt, detect_constant(ref, tgt).segments)
    again = detect_constant(ref, corrected)
    assert again.segments[0].offset_start == pytest.approx(0.0, abs=0.03)


def test_remap_time_inverts_a_drift():
    seg = [Segment(0.0, 100.0, 0.0, 4.0)]  # target runs 4% slow
    assert remap_time(52.0, seg) == pytest.approx(50.0)
