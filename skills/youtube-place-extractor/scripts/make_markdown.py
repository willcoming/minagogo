#!/usr/bin/env python3
"""Create a Markdown place table from structured YouTube extraction JSON."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def md_escape(value: object) -> str:
    text = "" if value is None else str(value)
    return text.replace("|", "\\|").replace("\n", "<br>")


def time_to_seconds(value: str) -> int | None:
    parts = [p for p in str(value).split(":") if p != ""]
    if not parts or not all(p.isdigit() for p in parts):
        return None
    total = 0
    for part in parts:
        total = total * 60 + int(part)
    return total


def video_id(video_url: str) -> str:
    parsed = urlparse(video_url)
    query_id = parse_qs(parsed.query).get("v", [""])[0]
    if query_id:
        return query_id
    match = re.search(r"(?:youtu\.be/|embed/|shorts/)([A-Za-z0-9_-]{6,})", video_url)
    return match.group(1) if match else ""


def timestamp_link(video_url: str, timestamp: str) -> str:
    seconds = time_to_seconds(timestamp)
    if seconds is None:
        return video_url
    vid = video_id(video_url)
    base = f"https://www.youtube.com/watch?v={vid}" if vid else video_url.split("&t=")[0]
    return f"{base}&t={seconds}s"


def render(data: dict) -> str:
    title = data.get("title", "YouTube 地點清單")
    video_url = data.get("video_url", "")
    channel = data.get("channel", "")
    checked_date = data.get("checked_date", "")
    places = data.get("places", [])

    lines = [
        f"# {md_escape(data.get('heading') or title)}",
        "",
        f"- 影片：[{md_escape(title)}]({video_url})",
        f"- 頻道：{md_escape(channel)}",
    ]
    if checked_date:
        lines.append(f"- 評價來源：Google Maps，查核日期 {md_escape(checked_date)}")
    lines.extend(
        [
            "",
            "| 店名 | 地圖連結 | Google Maps 評價 | YouTube 評價 | 影片連結 | 頻道名稱 |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
    )

    for place in places:
        name = md_escape(place.get("name", ""))
        map_url = place.get("map_url", "")
        map_link = f"[Google Maps]({map_url})" if map_url else ""
        google_rating = md_escape(place.get("google_rating", ""))
        youtube_review = md_escape(place.get("youtube_review", ""))
        timestamp = str(place.get("time", "") or "")
        video_link_url = timestamp_link(video_url, timestamp) if video_url else ""
        video_link = f"[{md_escape(timestamp)}]({video_link_url})" if timestamp and video_link_url else video_url
        row_channel = md_escape(place.get("channel", channel))
        lines.append(
            f"| {name} | {map_link} | {google_rating} | {youtube_review} | {video_link} | {row_channel} |"
        )

    return "\n".join(lines) + "\n"


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: make_markdown.py input.json output.md", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    data = json.loads(input_path.read_text(encoding="utf-8"))
    output_path.write_text(render(data), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
