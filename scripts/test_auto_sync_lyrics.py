import json
import tempfile
import unittest
from pathlib import Path

from auto_sync_lyrics import (
    TimedWord,
    calculate_line_times,
    find_pending_songs,
    has_timing,
    lrc_timestamp,
    normalize_source_lyrics,
)


class AutoSyncLyricsTests(unittest.TestCase):
    def test_aligns_lines_to_word_starts(self):
        lines = ["오늘도 걸어간다", "힘들단 말은 삼켜두고", "아무렇지 않은 척"]
        words = [
            TimedWord("오늘도", 10.0),
            TimedWord("또", 10.8),
            TimedWord("걸어간다", 11.2),
            TimedWord("힘들단", 15.0),
            TimedWord("말은", 15.8),
            TimedWord("삼켜두고", 16.4),
            TimedWord("아무렇지", 20.0),
            TimedWord("않은", 20.8),
            TimedWord("척", 21.2),
        ]

        line_times, confidence = calculate_line_times(lines, words, 30.0)

        self.assertEqual(line_times, [10.0, 15.0, 20.0])
        self.assertGreater(confidence, 0.9)

    def test_interpolates_an_unrecognized_middle_line(self):
        lines = ["첫 번째 줄", "완전히 다른 가사", "마지막 줄"]
        words = [TimedWord("첫 번째 줄", 5.0), TimedWord("마지막 줄", 15.0)]

        line_times, _ = calculate_line_times(lines, words, 20.0)

        self.assertEqual(line_times[0], 5.0)
        self.assertEqual(line_times[1], 10.0)
        self.assertEqual(line_times[2], 15.0)

    def test_timestamp_and_existing_lrc_detection(self):
        self.assertEqual(lrc_timestamp(61.236), "[01:01.24]")
        self.assertTrue(has_timing("[00:03.20]가사"))
        self.assertFalse(has_timing("시간 없는 가사"))

    def test_pending_scan_backfills_only_missing_results(self):
        songs = [
            {"id": "pending", "audio_url": "/songs/pending.mp3", "lyrics": "첫 줄\n둘째 줄"},
            {"id": "timed", "audio_url": "/songs/timed.mp3", "lyrics": "[00:01.00]완료"},
            {"id": "done", "audio_url": "/songs/done.mp3", "lyrics": "이미 분석한 가사"},
        ]
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            audio_root = root / "songs"
            output_dir = root / "results"
            audio_root.mkdir()
            output_dir.mkdir()
            for name in ("pending.mp3", "timed.mp3", "done.mp3"):
                (audio_root / name).write_bytes(b"audio")

            source = normalize_source_lyrics(songs[2]["lyrics"])
            import hashlib

            (output_dir / "done.json").write_text(
                json.dumps({
                    "state": "completed",
                    "songId": "done",
                    "sourceLyricsHash": hashlib.sha256(source.encode("utf-8")).hexdigest(),
                }),
                encoding="utf-8",
            )

            pending = find_pending_songs(songs, audio_root, output_dir)

        self.assertEqual([(song["id"], path.name) for song, path in pending], [("pending", "pending.mp3")])


if __name__ == "__main__":
    unittest.main()
