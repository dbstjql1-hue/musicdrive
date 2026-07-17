import unittest

from auto_sync_lyrics import TimedWord, calculate_line_times, has_timing, lrc_timestamp


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


if __name__ == "__main__":
    unittest.main()
