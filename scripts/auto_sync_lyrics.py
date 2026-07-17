#!/usr/bin/env python3
"""Generate validated LRC timing for a newly uploaded MusicDrive song."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import tempfile
import unicodedata
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


TIMESTAMP_RE = re.compile(r"^\[\d{1,2}:\d{2}(?:\.\d{2,3})?\]")


@dataclass(frozen=True)
class TimedWord:
    text: str
    start: float


def normalize_source_lyrics(value: str | None) -> str:
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def plain_lyric_lines(value: str | None) -> list[str]:
    return [line.strip() for line in normalize_source_lyrics(value).split("\n") if line.strip()]


def has_timing(value: str | None) -> bool:
    return any(TIMESTAMP_RE.match(line) for line in plain_lyric_lines(value))


def comparable_characters(value: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", value).lower()
    return [character for character in normalized if character.isalnum()]


def flatten_transcript(words: Iterable[TimedWord]) -> tuple[list[str], list[float]]:
    characters: list[str] = []
    times: list[float] = []
    for word in words:
        for character in comparable_characters(word.text):
            characters.append(character)
            times.append(max(float(word.start), 0.0))
    return characters, times


def flatten_lyrics(lines: list[str]) -> tuple[list[str], list[int]]:
    characters: list[str] = []
    line_indexes: list[int] = []
    for line_index, line in enumerate(lines):
        for character in comparable_characters(line):
            characters.append(character)
            line_indexes.append(line_index)
    return characters, line_indexes


def align_exact_matches(lyrics_chars: list[str], transcript_chars: list[str]) -> list[tuple[int, int]]:
    """Return exact character matches from a global Levenshtein alignment."""
    transcript_length = len(transcript_chars)
    previous = list(range(transcript_length + 1))
    directions: list[bytearray] = [bytearray(transcript_length + 1)]

    for lyric_index, lyric_character in enumerate(lyrics_chars, start=1):
        current = [lyric_index] + [0] * transcript_length
        row_directions = bytearray(transcript_length + 1)
        row_directions[0] = 1
        for transcript_index, transcript_character in enumerate(transcript_chars, start=1):
            substitution = previous[transcript_index - 1] + (lyric_character != transcript_character)
            deletion = previous[transcript_index] + 1
            insertion = current[transcript_index - 1] + 1
            best = min(substitution, deletion, insertion)
            current[transcript_index] = best
            if substitution == best:
                row_directions[transcript_index] = 0
            elif deletion == best:
                row_directions[transcript_index] = 1
            else:
                row_directions[transcript_index] = 2
        directions.append(row_directions)
        previous = current

    lyric_index = len(lyrics_chars)
    transcript_index = transcript_length
    matches: list[tuple[int, int]] = []
    while lyric_index > 0 or transcript_index > 0:
        if lyric_index == 0:
            transcript_index -= 1
            continue
        if transcript_index == 0:
            lyric_index -= 1
            continue
        direction = directions[lyric_index][transcript_index]
        if direction == 0:
            if lyrics_chars[lyric_index - 1] == transcript_chars[transcript_index - 1]:
                matches.append((lyric_index - 1, transcript_index - 1))
            lyric_index -= 1
            transcript_index -= 1
        elif direction == 1:
            lyric_index -= 1
        else:
            transcript_index -= 1

    matches.reverse()
    return matches


def interpolate_missing_times(times: list[float | None], duration: float) -> list[float]:
    known_indexes = [index for index, value in enumerate(times) if value is not None]
    if not known_indexes:
        raise ValueError("No lyric line could be matched to the transcript.")

    result = list(times)
    first_known = known_indexes[0]
    first_time = float(result[first_known])
    leading_step = first_time / max(first_known + 1, 1)
    for index in range(first_known):
        result[index] = max(0.0, first_time - leading_step * (first_known - index))

    for left, right in zip(known_indexes, known_indexes[1:]):
        left_time = float(result[left])
        right_time = float(result[right])
        span = right - left
        for index in range(left + 1, right):
            result[index] = left_time + (right_time - left_time) * ((index - left) / span)

    last_known = known_indexes[-1]
    last_time = float(result[last_known])
    trailing_count = len(result) - last_known - 1
    trailing_limit = max(float(duration) - 0.2, last_time + trailing_count * 0.1)
    trailing_step = (trailing_limit - last_time) / max(trailing_count + 1, 1)
    for index in range(last_known + 1, len(result)):
        result[index] = last_time + trailing_step * (index - last_known)

    final: list[float] = []
    for index, value in enumerate(result):
        current = max(float(value), 0.0)
        if index > 0:
            current = max(current, final[-1] + 0.08)
        final.append(current)
    return final


def calculate_line_times(lines: list[str], words: list[TimedWord], duration: float) -> tuple[list[float], float]:
    lyric_chars, lyric_line_indexes = flatten_lyrics(lines)
    transcript_chars, transcript_times = flatten_transcript(words)
    if not lyric_chars:
        raise ValueError("The lyrics do not contain searchable characters.")
    if not transcript_chars:
        raise ValueError("Whisper did not return searchable transcript text.")

    matches = align_exact_matches(lyric_chars, transcript_chars)
    line_matches: list[list[float]] = [[] for _ in lines]
    for lyric_char_index, transcript_char_index in matches:
        line_matches[lyric_line_indexes[lyric_char_index]].append(transcript_times[transcript_char_index])

    line_times: list[float | None] = []
    for matched_times in line_matches:
        line_times.append(min(matched_times) if matched_times else None)

    confidence = len(matches) / len(lyric_chars)
    return interpolate_missing_times(line_times, duration), confidence


def lrc_timestamp(seconds: float) -> str:
    centiseconds = max(0, int(round(seconds * 100)))
    minutes, remainder = divmod(centiseconds, 6000)
    whole_seconds, fraction = divmod(remainder, 100)
    return f"[{minutes:02d}:{whole_seconds:02d}.{fraction:02d}]"


def fetch_songs(api_url: str) -> list[dict]:
    endpoint = f"{api_url.rstrip('/')}/api/songs?query=&category="
    request = urllib.request.Request(endpoint, headers={"User-Agent": "musicdrive-lyrics-sync/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if isinstance(payload, dict):
        payload = payload.get("songs", payload.get("data", []))
    if not isinstance(payload, list):
        raise ValueError("The songs API returned an unexpected response.")
    return payload


def audio_basename(value: str | None) -> str:
    parsed = urllib.parse.urlparse(str(value or ""))
    return Path(urllib.parse.unquote(parsed.path)).name


def find_song(songs: list[dict], audio_path: Path) -> dict | None:
    target_name = audio_path.name
    return next((song for song in songs if audio_basename(song.get("audio_url")) == target_name), None)


def transcribe(audio_path: Path, model_name: str, language: str, prompt: str) -> tuple[list[TimedWord], float]:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        str(audio_path),
        language=language,
        beam_size=5,
        word_timestamps=True,
        vad_filter=False,
        initial_prompt=prompt[:2000]
    )
    words: list[TimedWord] = []
    final_end = 0.0
    for segment in segments:
        final_end = max(final_end, float(segment.end or 0.0))
        for word in segment.words or []:
            if word.start is not None and str(word.word or "").strip():
                words.append(TimedWord(str(word.word), float(word.start)))
    duration = float(getattr(info, "duration", 0.0) or final_end)
    return words, duration


def write_result(output_dir: Path, result: dict) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{result['songId']}.json"
    handle, temporary_name = tempfile.mkstemp(prefix=f".{result['songId']}-", suffix=".tmp", dir=output_dir)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as temporary_file:
            json.dump(result, temporary_file, ensure_ascii=False, indent=2)
            temporary_file.write("\n")
        os.replace(temporary_name, output_path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
    return output_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-path", required=True, type=Path)
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("frontend/public/lyrics-sync-results"))
    parser.add_argument("--model", default="medium")
    parser.add_argument("--language", default="ko")
    args = parser.parse_args()

    songs = fetch_songs(args.api_url)
    song = find_song(songs, args.audio_path)
    if not song:
        raise SystemExit(f"No API song matches audio file {args.audio_path.name}")

    source_lyrics = normalize_source_lyrics(song.get("lyrics"))
    lines = plain_lyric_lines(source_lyrics)
    if not lines:
        print(f"Skipping {song.get('title', args.audio_path.name)}: no lyrics")
        return 0
    if has_timing(source_lyrics):
        print(f"Skipping {song.get('title', args.audio_path.name)}: lyrics already have timing")
        return 0

    print(f"Transcribing {song.get('title', args.audio_path.name)} with Whisper {args.model}...")
    words, duration = transcribe(args.audio_path, args.model, args.language, source_lyrics)
    line_times, confidence = calculate_line_times(lines, words, duration)
    if not math.isfinite(confidence) or confidence < 0.6:
        raise SystemExit(f"Alignment confidence {confidence:.3f} is below the safe threshold (0.600)")

    lrc = "\n".join(f"{lrc_timestamp(start)}{line}" for start, line in zip(line_times, lines))
    result = {
        "version": 1,
        "state": "completed",
        "songId": song["id"],
        "sourceLyricsHash": hashlib.sha256(source_lyrics.encode("utf-8")).hexdigest(),
        "lineCount": len(lines),
        "confidence": round(confidence, 4),
        "model": args.model,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "lrc": lrc,
    }
    output_path = write_result(args.output_dir, result)
    print(f"Wrote {output_path} ({len(lines)} lines, confidence {confidence:.3f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
