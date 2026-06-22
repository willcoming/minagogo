#!/usr/bin/env python3
"""Refresh local YouTube channel place reports.

The updater intentionally works without a YouTube API key. It reads public
channel/video pages, preserves previously extracted place rows, and only parses
descriptions for newly discovered videos.
"""

from __future__ import annotations

import datetime as dt
import html
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests


ROOT = Path(__file__).resolve().parents[3]
TODAY = dt.datetime.now().astimezone().strftime("%Y-%m-%d")
FETCHED_AT = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace(
    "+00:00", "Z"
)


@dataclass(frozen=True)
class ChannelConfig:
    slug: str
    handle: str
    name: str
    raw_kind: str
    place_title: str
    no_places_title: str
    search_suffix: str = ""

    @property
    def source(self) -> str:
        return f"https://www.youtube.com/@{self.handle}"

    @property
    def videos_url(self) -> str:
        return f"{self.source}/videos"


CHANNELS = [
    ChannelConfig(
        slug="lotmainidea",
        handle="lotmainidea",
        name="老辣妹",
        raw_kind="nested_dict",
        place_title="老辣妹 全頻道地點清單",
        no_places_title="老辣妹 未抓到地點資料影片",
    ),
    ChannelConfig(
        slug="feipo1998",
        handle="feipo1998",
        name="肥波開吃啦",
        raw_kind="nested_dict",
        place_title="肥波開吃啦 全頻道店家清單",
        no_places_title="肥波開吃啦 未抓到店家資料影片",
    ),
    ChannelConfig(
        slug="solointokyolife",
        handle="SoloInTokyoLife",
        name="SoloInTokyoLife",
        raw_kind="list",
        place_title="SoloInTokyoLife 全頻道餐廳咖啡廳清單",
        no_places_title="SoloInTokyoLife 未抓到店家/地點資料影片",
        search_suffix="Tokyo Japan",
    ),
    ChannelConfig(
        slug="hinalifeinjapan",
        handle="HinaLifeinJapan",
        name="Hina Life in Japan",
        raw_kind="flat",
        place_title="Hina Life in Japan 全頻道地點清單",
        no_places_title="Hina Life in Japan 未抓到店家/地點資料影片",
        search_suffix="Tokyo Japan",
    ),
    ChannelConfig(
        slug="cellia1025",
        handle="cellia1025",
        name="Celia Ting",
        raw_kind="flat",
        place_title="Celia Ting 全頻道地點清單",
        no_places_title="Celia Ting 未抓到店家/地點資料影片",
    ),
    ChannelConfig(
        slug="missliv",
        handle="missliv",
        name="MissLiv 日本旅行和生活",
        raw_kind="flat",
        place_title="MissLiv 日本旅行和生活 全頻道地點清單",
        no_places_title="MissLiv 日本旅行和生活 未抓到店家/地點資料影片",
    ),
    ChannelConfig(
        slug="hirodaysintokyo",
        handle="hirodaysintokyo",
        name="Hiro | Days in Tokyo",
        raw_kind="flat",
        place_title="Hiro | Days in Tokyo 全頻道地點清單",
        no_places_title="Hiro | Days in Tokyo 未抓到店家/地點資料影片",
        search_suffix="Tokyo Japan",
    ),
    ChannelConfig(
        slug="uniquejapantravel",
        handle="UniqueJapanTravel",
        name="Unique Japan Travel",
        raw_kind="flat",
        place_title="Unique Japan Travel 全頻道地點清單",
        no_places_title="Unique Japan Travel 未抓到店家/地點資料影片",
        search_suffix="Japan",
    ),
    ChannelConfig(
        slug="hurleygourmet",
        handle="hurleygourmet",
        name="ハーリーのグルメ",
        raw_kind="flat",
        place_title="ハーリーのグルメ 全頻道地點清單",
        no_places_title="ハーリーのグルメ 未抓到店家/地點資料影片",
        search_suffix="Japan",
    ),
]


SESSION = requests.Session()
SESSION.headers.update(
    {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
        ),
        "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8,ja;q=0.7",
    }
)


def md_escape(value: Any) -> str:
    text = "" if value is None else scrub_text(str(value))
    return text.replace("|", "\\|").replace("\n", "<br>")


def scrub_text(text: str) -> str:
    """Normalize valid surrogate pairs and replace lone surrogate code points."""
    if not any("\ud800" <= char <= "\udfff" for char in text):
        return text
    return text.encode("utf-16", "surrogatepass").decode("utf-16", "replace")


def scrub_json(value: Any) -> Any:
    if isinstance(value, str):
        return scrub_text(value)
    if isinstance(value, list):
        return [scrub_json(item) for item in value]
    if isinstance(value, dict):
        return {scrub_text(str(key)): scrub_json(item) for key, item in value.items()}
    return value


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    if os.environ.get("YOUTUBE_PLACE_BASELINE") == "HEAD":
        try:
            return load_json_from_git(path)
        except Exception:
            pass
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        try:
            return load_json_from_git(path)
        except Exception:
            return default


def load_json_from_git(path: Path) -> Any:
    relative = path.relative_to(ROOT)
    original = subprocess.check_output(
        ["git", "show", f"HEAD:{relative.as_posix()}"],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
    )
    return json.loads(original)


def write_json(path: Path, data: Any) -> None:
    output = json.dumps(scrub_json(data), ensure_ascii=False, indent=2) + "\n"
    tmp_path = path.with_name(path.name + ".tmp")
    tmp_path.write_text(output, encoding="utf-8")
    tmp_path.replace(path)


def get_text(url: str, *, retries: int = 3) -> str:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            response = SESSION.get(url, timeout=30)
            response.raise_for_status()
            return response.text
        except Exception as exc:  # pragma: no cover - network guard
            last_error = exc
            time.sleep(1.5 + attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def post_json(url: str, payload: dict[str, Any], *, retries: int = 3) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            response = SESSION.post(url, json=payload, timeout=30)
            response.raise_for_status()
            return response.json()
        except Exception as exc:  # pragma: no cover - network guard
            last_error = exc
            time.sleep(1.5 + attempt)
    raise RuntimeError(f"Failed to post {url}: {last_error}")


def extract_json_assignment(html_text: str, name: str) -> dict[str, Any]:
    patterns = [
        rf"var {re.escape(name)} = (\{{.*?\}});</script>",
        rf"{re.escape(name)}\s*=\s*(\{{.*?\}});</script>",
        rf"{re.escape(name)}\s*=\s*(\{{.*?\}});",
    ]
    for pattern in patterns:
        match = re.search(pattern, html_text)
        if match:
            return json.loads(match.group(1))
    raise ValueError(f"{name} not found")


def extract_ytcfg(html_text: str) -> dict[str, Any]:
    match = re.search(r"ytcfg\.set\((\{.*?\})\);", html_text)
    if not match:
        raise ValueError("ytcfg not found")
    return json.loads(match.group(1))


def text_content(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        if "simpleText" in value:
            return str(value["simpleText"])
        if "content" in value:
            return str(value["content"])
        if "runs" in value:
            return "".join(str(run.get("text", "")) for run in value.get("runs", []))
        if "text" in value:
            return text_content(value["text"])
    return ""


def walk_values(obj: Any, key: str) -> list[Any]:
    found: list[Any] = []
    if isinstance(obj, dict):
        for item_key, value in obj.items():
            if item_key == key:
                found.append(value)
            found.extend(walk_values(value, key))
    elif isinstance(obj, list):
        for value in obj:
            found.extend(walk_values(value, key))
    return found


def extract_grid_contents(data: dict[str, Any]) -> list[dict[str, Any]]:
    containers: list[list[dict[str, Any]]] = []

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            if "richGridRenderer" in obj:
                containers.append(obj["richGridRenderer"].get("contents", []))
            if "richGridContinuation" in obj:
                containers.append(obj["richGridContinuation"].get("contents", []))
            if "appendContinuationItemsAction" in obj:
                containers.append(obj["appendContinuationItemsAction"].get("continuationItems", []))
            for value in obj.values():
                walk(value)
        elif isinstance(obj, list):
            for value in obj:
                walk(value)

    walk(data)
    return [item for group in containers for item in group]


def find_duration(lockup: dict[str, Any]) -> str:
    badges = walk_values(lockup.get("contentImage", {}), "thumbnailBadgeViewModel")
    for badge in badges:
        text = str(badge.get("text", ""))
        if re.fullmatch(r"\d{1,2}:\d{2}(?::\d{2})?", text):
            return text
    labels = walk_values(lockup.get("contentImage", {}), "accessibilityContext")
    for label in labels:
        label_text = text_content(label.get("label", ""))
        match = re.search(r"(\d{1,2}:\d{2}(?::\d{2})?)", label_text)
        if match:
            return match.group(1)
    return ""


def is_published_text(text: str) -> bool:
    return bool(
        re.search(
            r"(\d+\s*(?:秒|分鐘|小時|天|週|個月|年)前|^\d{4}-\d{2}-\d{2}$|premiered|streamed)",
            text,
            re.I,
        )
    )


def normalize_views_text(text: str) -> str:
    if not text:
        return ""
    if "觀看" in text or "view" in text.lower():
        return text
    if re.search(r"\d", text):
        suffix = "" if text.endswith("次") else "次"
        return f"觀看次數：{text}{suffix}"
    return text


def parse_lockup(lockup: dict[str, Any]) -> dict[str, Any] | None:
    video_id = lockup.get("contentId")
    if not video_id:
        commands = walk_values(lockup, "watchEndpoint")
        video_id = next((cmd.get("videoId") for cmd in commands if cmd.get("videoId")), "")
    title = text_content(
        lockup.get("metadata", {})
        .get("lockupMetadataViewModel", {})
        .get("title", {})
    )
    if not video_id or not title:
        return None

    metadata_parts: list[str] = []
    rows = (
        lockup.get("metadata", {})
        .get("lockupMetadataViewModel", {})
        .get("metadata", {})
        .get("contentMetadataViewModel", {})
        .get("metadataRows", [])
    )
    for row in rows:
        for part in row.get("metadataParts", []):
            content = text_content(part.get("text", {})).strip()
            if content:
                metadata_parts.append(content)

    published = next((part for part in metadata_parts if is_published_text(part)), "")
    views = next(
        (
            part
            for part in metadata_parts
            if part != published
            and ("觀看" in part or "view" in part.lower() or re.search(r"\d", part))
        ),
        "",
    )
    views = normalize_views_text(views)

    return {
        "id": video_id,
        "title": html.unescape(title),
        "duration": find_duration(lockup),
        "views": views,
        "published": published,
        "url": f"https://www.youtube.com/watch?v={video_id}",
    }


def parse_video_renderer(renderer: dict[str, Any]) -> dict[str, Any] | None:
    video_id = renderer.get("videoId", "")
    title = text_content(renderer.get("title", {}))
    if not video_id or not title:
        return None
    return {
        "id": video_id,
        "title": html.unescape(title),
        "duration": text_content(renderer.get("lengthText", {})),
        "views": text_content(renderer.get("viewCountText", {})),
        "published": text_content(renderer.get("publishedTimeText", {})),
        "url": f"https://www.youtube.com/watch?v={video_id}",
    }


def fetch_channel_videos(config: ChannelConfig) -> list[dict[str, Any]]:
    html_text = get_text(config.videos_url)
    initial_data = extract_json_assignment(html_text, "ytInitialData")
    ytcfg = extract_ytcfg(html_text)
    api_key = ytcfg["INNERTUBE_API_KEY"]
    context = ytcfg["INNERTUBE_CONTEXT"]

    videos: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_tokens: set[str] = set()

    def consume(data: dict[str, Any]) -> str:
        next_token = ""
        for item in extract_grid_contents(data):
            renderer = item.get("richItemRenderer", {}).get("content", {})
            video: dict[str, Any] | None = None
            if "lockupViewModel" in renderer:
                video = parse_lockup(renderer["lockupViewModel"])
            elif "videoRenderer" in renderer:
                video = parse_video_renderer(renderer["videoRenderer"])
            if video and video["id"] not in seen_ids:
                seen_ids.add(video["id"])
                videos.append(video)

            continuation = item.get("continuationItemRenderer", {}).get(
                "continuationEndpoint", {}
            ).get("continuationCommand", {})
            token = continuation.get("token", "")
            if token and not next_token:
                next_token = token
        return next_token

    token = consume(initial_data)
    while token and token not in seen_tokens:
        seen_tokens.add(token)
        payload = {"context": context, "continuation": token}
        data = post_json(f"https://www.youtube.com/youtubei/v1/browse?key={api_key}", payload)
        token = consume(data)
        time.sleep(0.2)

    for index, video in enumerate(videos, 1):
        video["index"] = index
        video["channel"] = config.name
    return videos


def fetch_video_description(video_id: str) -> tuple[str, dict[str, Any]]:
    html_text = get_text(f"https://www.youtube.com/watch?v={video_id}")
    player = extract_json_assignment(html_text, "ytInitialPlayerResponse")
    details = player.get("videoDetails", {})
    return details.get("shortDescription", "") or "", player


def is_map_url(line: str) -> bool:
    lowered = line.lower()
    return any(
        marker in lowered
        for marker in [
            "maps.app.goo.gl",
            "google.com/maps",
            "goo.gl/maps",
            "share.google/",
            "naver.me/",
            "map.naver.com",
        ]
    )


def extract_url(line: str) -> str:
    match = re.search(r"https?://[^\s)）】>]+", line)
    if not match:
        return ""
    return match.group(0).strip("。、，,；;")


def extract_map_url(line: str) -> str:
    url = extract_url(line)
    return url if url and is_map_url(url) else ""


def is_source_url(line: str) -> bool:
    lowered = line.lower()
    return any(
        marker in lowered
        for marker in [
            "tabelog.com/",
            "restaurant.ikyu.com/",
            "ozmall.co.jp/",
            "hotpepper.jp/",
            "gnavi.co.jp/",
            "retty.me/",
        ]
    )


def map_label(url: str) -> str:
    lowered = url.lower()
    if "naver" in lowered:
        return "Naver Map"
    if "google.com/maps/search" in lowered:
        return "Google Maps 搜尋"
    if any(marker in lowered for marker in ["maps.app.goo.gl", "google.com/maps", "goo.gl/maps", "share.google/"]):
        return "Google Maps"
    return "地圖連結"


def google_search_url(query: str) -> str:
    return "https://www.google.com/maps/search/?api=1&query=" + quote(query)


def clean_line(line: str) -> str:
    line = html.unescape(line.strip())
    line = line.strip(" \t　-•*・")
    line = re.sub(r"^[📍🚩]\s*", "", line)
    line = line.strip(" \t　-•*・")
    line = line.strip()
    if line.startswith("「") and line.endswith("」"):
        line = line[1:-1].strip()
    return line


def clean_place_name(line: str) -> tuple[str, str]:
    line = clean_line(re.sub(r"https?://\S+", "", line))
    time_label = ""
    match = re.match(r"^(?P<time>(?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)$", line)
    if match:
        time_label = match.group("time")
        line = clean_line(line[match.end("time") :])
    return line, time_label


def is_noise_name(line: str) -> bool:
    lowered = line.lower()
    if not line or len(line) > 90:
        return True
    return any(
        marker in lowered
        for marker in [
            "http",
            "instagram",
            "合作",
            "music",
            "credit",
            "email",
            "time code",
            "chapter",
            "章節",
            "目次",
            "today's route",
            "おすすめ動画",
            "subscribe",
            "camera",
            "mail",
            "拍攝日期",
        ]
    )


def time_to_seconds(value: str) -> int | None:
    parts = [part for part in str(value).split(":") if part != ""]
    if not parts or not all(part.isdigit() for part in parts):
        return None
    total = 0
    for part in parts:
        total = total * 60 + int(part)
    return total


def seconds_to_label(seconds: int | None) -> str:
    if seconds is None:
        return ""
    minutes, sec = divmod(seconds, 60)
    return f"{minutes}:{sec:02d}"


def parse_chapters(description: str) -> list[dict[str, Any]]:
    chapters: list[dict[str, Any]] = []
    for raw_line in description.splitlines():
        line = clean_line(raw_line)
        match = re.match(r"^(?P<time>(?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.+)$", line)
        if not match:
            continue
        label = match.group("time")
        title = clean_line(line[match.end("time") :])
        if not title:
            continue
        chapters.append(
            {
                "time": label,
                "seconds": time_to_seconds(label),
                "title": title,
            }
        )
    return chapters


def best_chapter_for_name(name: str, chapters: list[dict[str, Any]]) -> dict[str, Any] | None:
    simplified = re.sub(r"\s+", "", name.lower())
    best: tuple[int, dict[str, Any]] | None = None
    for chapter in chapters:
        title = chapter["title"]
        title_s = re.sub(r"\s+", "", title.lower())
        score = 0
        if simplified and simplified in title_s:
            score = len(simplified)
        elif title_s and title_s in simplified:
            score = len(title_s)
        else:
            tokens = [token for token in re.split(r"[/・,，\s()（）]+", name.lower()) if len(token) >= 3]
            score = sum(len(token) for token in tokens if token in title.lower())
        if score and (best is None or score > best[0]):
            best = (score, chapter)
    return best[1] if best else None


def base_place(
    *,
    video: dict[str, Any],
    config: ChannelConfig,
    name: str,
    map_url: str = "",
    time_label: str = "",
    seconds: int | None = None,
    review: str = "",
    address: str = "",
    chapter_title: str = "",
    source_review: str = "",
) -> dict[str, Any]:
    seconds = seconds if seconds is not None else time_to_seconds(time_label)
    label = time_label or seconds_to_label(seconds)
    if not map_url:
        query = " ".join(part for part in [name, config.search_suffix] if part)
        map_url = google_search_url(query)
        map_link_type = "search"
        google_rating = "Google Maps 未取得（以搜尋連結代替）"
    else:
        map_link_type = "direct"
        google_rating = "Google Maps 未取得"

    return {
        "video_id": video["id"],
        "video_title": video["title"],
        "video_url": video["url"],
        "published": video.get("published", ""),
        "views": video.get("views", ""),
        "channel_name": config.name,
        "name": name,
        "map_url": map_url,
        "map_link_type": map_link_type,
        "source_url": "" if map_url.startswith("https://www.google.com/maps/search") else map_url,
        "address": address,
        "timestamp_seconds": seconds,
        "timestamp_label": label,
        "chapter_title": chapter_title,
        "source_review": source_review,
        "google_rating": google_rating,
        "youtube_review": review,
        "youtube_review_zh": review,
        "time": label,
        "seconds": seconds,
    }


def feipo_review(block_lines: list[str]) -> str:
    dishes: list[str] = []
    score = ""
    for line in block_lines:
        if re.search(r"很想二刷指數", line):
            match = re.search(r"很想二刷指數\s*([0-9.]+)\s*[\\/]\s*5", line)
            if match:
                score = match.group(1)
            continue
        if re.search(r"time\s*code", line, re.I) or is_map_url(line):
            continue
        clean = clean_line(line)
        if clean and not is_noise_name(clean):
            dishes.append(clean)
    dish_text = "、".join(dishes)
    if dish_text and score:
        return f"品嚐了 {dish_text}，很想二刷指數為 {score}/5。"
    if dish_text:
        return f"影片介紹並品嚐了 {dish_text}。"
    if score:
        return f"影片很想二刷指數為 {score}/5。"
    return "描述欄列出此店家為本集造訪地點。"


def parse_feipo(description: str, video: dict[str, Any], config: ChannelConfig) -> list[dict[str, Any]]:
    lines = [line.strip() for line in description.splitlines()]
    places: list[dict[str, Any]] = []
    for idx, line in enumerate(lines):
        if not is_map_url(line):
            continue
        map_url = extract_map_url(line)
        name = ""
        for prev in range(idx - 1, max(-1, idx - 6), -1):
            candidate = clean_line(lines[prev])
            if candidate and not is_noise_name(candidate) and not is_map_url(candidate):
                name = candidate
                break
        if not name:
            continue
        lookahead = lines[idx + 1 : idx + 8]
        time_label = ""
        block: list[str] = []
        for item in lookahead:
            if is_map_url(item):
                break
            time_match = re.search(r"TIME\s*CODE\s*((?:\d{1,2}:)?\d{1,2}:\d{2})", item, re.I)
            if time_match:
                time_label = time_match.group(1)
                block.append(item)
                break
            block.append(item)
        places.append(
            base_place(
                video=video,
                config=config,
                name=name,
                map_url=map_url,
                time_label=time_label,
                review=feipo_review(block),
                source_review="\n".join(block),
            )
        )
    return dedupe_places(places)


def parse_lotmainidea(description: str, video: dict[str, Any], config: ChannelConfig) -> list[dict[str, Any]]:
    lines = [line.strip() for line in description.splitlines()]
    chapters = parse_chapters(description)
    places: list[dict[str, Any]] = []
    region = ""
    for idx, raw_line in enumerate(lines):
        line = clean_line(raw_line)
        region_match = re.match(r"^【(.+?)】$", raw_line.strip())
        if region_match:
            region = region_match.group(1)
            continue
        quote_match = re.search(r"「(.+?)」", raw_line)
        if not quote_match:
            continue
        name = clean_line(quote_match.group(1))
        map_url = ""
        for nxt in lines[idx + 1 : idx + 8]:
            if is_map_url(nxt):
                map_url = extract_map_url(nxt)
                break
        if not map_url:
            continue
        chapter = best_chapter_for_name(name, chapters)
        route = f"{region}散步路線" if region else "本集路線"
        review = f"影片將此處列入{route}，適合作為逛街、美食、咖啡或景點停留點。"
        places.append(
            base_place(
                video=video,
                config=config,
                name=name,
                map_url=map_url,
                time_label=chapter["time"] if chapter else "",
                seconds=chapter["seconds"] if chapter else None,
                chapter_title=chapter["title"] if chapter else "",
                review=review,
                source_review=f"描述欄將「{name}」列為本集地點。",
            )
        )
    return dedupe_places(places)


def parse_solo(description: str, video: dict[str, Any], config: ChannelConfig) -> list[dict[str, Any]]:
    places: list[dict[str, Any]] = []
    for chapter in parse_chapters(description):
        title = chapter["title"]
        if "📍" not in title and not title.startswith("📍"):
            continue
        name = clean_line(title.replace("📍", ""))
        if is_skip_chapter(name):
            continue
        review = f"本集東京美食巡禮造訪「{name}」，描述欄列為章節店家，未提供原始地圖連結。"
        if "ベーグル" in video["title"] or "貝果" in video["title"]:
            review = f"本集東京貝果巡禮造訪「{name}」，主打貝果、紅豆奶油或奶油起司等口味；描述欄列為章節店家，未提供原始地圖連結。"
        places.append(
            base_place(
                video=video,
                config=config,
                name=name,
                time_label=chapter["time"],
                seconds=chapter["seconds"],
                chapter_title=title,
                review=review,
                source_review=f"描述欄章節將「{name}」列為本集店家。",
            )
        )
    return dedupe_places(places)


def parse_hina(description: str, video: dict[str, Any], config: ChannelConfig) -> list[dict[str, Any]]:
    lines = [line.strip() for line in description.splitlines()]
    chapters = parse_chapters(description)
    places: list[dict[str, Any]] = []
    for idx, line in enumerate(lines):
        if not is_map_url(line):
            continue
        map_url = extract_map_url(line)
        name = ""
        for prev in range(idx - 1, max(-1, idx - 5), -1):
            candidate = clean_line(lines[prev])
            if candidate and not is_noise_name(candidate) and not is_map_url(candidate):
                name = candidate
                break
        if not name or is_skip_chapter(name):
            continue
        chapter = best_chapter_for_name(name, chapters)
        review = f"影片把「{name}」放進東京或日本行程，作為咖啡、美食、購物或散步路線的一站。"
        places.append(
            base_place(
                video=video,
                config=config,
                name=name,
                map_url=map_url,
                time_label=chapter["time"] if chapter else "",
                seconds=chapter["seconds"] if chapter else None,
                chapter_title=chapter["title"] if chapter else "",
                review=review,
                source_review=f"描述欄將「{name}」列為行程地點。",
            )
        )
    return dedupe_places(places)


ADDRESS_HINTS = [
    "Japan",
    "Taiwan",
    "Hong Kong",
    "Korea",
    "Singapore",
    "New York",
    "Tokyo",
    "Taipei",
    "Chome",
    "City",
    "District",
    "〒",
    "區",
    "路",
    "街",
    "號",
]


def looks_like_address(line: str) -> bool:
    if is_map_url(line) or line.lower().startswith("http"):
        return False
    if len(line) < 8:
        return False
    return "," in line or any(hint in line for hint in ADDRESS_HINTS)


def parse_celia(description: str, video: dict[str, Any], config: ChannelConfig) -> list[dict[str, Any]]:
    lines = [line.rstrip() for line in description.splitlines()]
    places: list[dict[str, Any]] = []
    idx = 0
    while idx < len(lines) - 1:
        name = clean_line(lines[idx])
        address = clean_line(lines[idx + 1])
        if (
            name
            and not is_noise_name(name)
            and not re.match(r"^Day\s+\d+", name, re.I)
            and not re.match(r"^(?:\d{1,2}:)?\d{1,2}:\d{2}", name)
            and looks_like_address(address)
        ):
            review = f"影片將「{name}」列入咖啡、散步、購物或旅行路線，描述欄提供地址作為參考。"
            places.append(
                base_place(
                    video=video,
                    config=config,
                    name=name,
                    address=address,
                    map_url=google_search_url(f"{name} {address}"),
                    review=review,
                    source_review=f"描述欄列出「{name}」與地址「{address}」。",
                )
            )
            idx += 2
            continue
        idx += 1
    return dedupe_places(places)


def is_skip_chapter(name: str) -> bool:
    lowered = name.lower()
    skip_words = [
        "opening",
        "open",
        "preview",
        "プレビュー",
        "ending",
        "結尾",
        "開場",
        "出發",
        "好物",
        "music",
        "camera",
        "intro",
        "outro",
        "day",
        "home",
        "cooking",
        "shopping haul",
    ]
    return any(word in lowered for word in skip_words)


def parse_missliv(description: str, video: dict[str, Any], config: ChannelConfig) -> list[dict[str, Any]]:
    places: list[dict[str, Any]] = []
    for chapter in parse_chapters(description):
        name = clean_line(chapter["title"])
        if is_skip_chapter(name) or len(name) > 40:
            continue
        review = f"描述欄或章節將「{name}」列為本集出現的店家或地點。"
        places.append(
            base_place(
                video=video,
                config=config,
                name=name,
                time_label=chapter["time"],
                seconds=chapter["seconds"],
                chapter_title=name,
                review=review,
                source_review=review,
            )
        )
    return dedupe_places(places)


def parse_hiro(description: str, video: dict[str, Any], config: ChannelConfig) -> list[dict[str, Any]]:
    places: list[dict[str, Any]] = []
    current_time = ""
    pending_name = ""
    pending_time = ""

    for raw_line in description.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        map_url = extract_map_url(line)
        if map_url:
            inline_name, inline_time = clean_place_name(line)
            name = inline_name or pending_name
            time_label = inline_time or pending_time or current_time
            if name and not is_noise_name(name):
                review = f"Hiro 將「{name}」列為本集東京散步路線中的停留點，描述欄提供 Google Maps 連結。"
                places.append(
                    base_place(
                        video=video,
                        config=config,
                        name=name,
                        map_url=map_url,
                        time_label=time_label,
                        review=review,
                        source_review=f"描述欄列出「{name}」與 Google Maps 連結。",
                    )
                )
            pending_name = ""
            pending_time = ""
            continue

        name, time_label = clean_place_name(line)
        if time_label:
            current_time = time_label
        if name and not is_noise_name(name):
            pending_name = name
            pending_time = time_label or current_time

    return dedupe_places(places)


def parse_uniquejapantravel(
    description: str, video: dict[str, Any], config: ChannelConfig
) -> list[dict[str, Any]]:
    skip_patterns = [
        r"^opening$",
        r"^ending$",
        r"^train trip\b",
        r"^bus ride\b",
        r"^music\b",
        r"^dinner at the inn$",
    ]
    place_markers = [
        "area",
        "beach",
        "bridge",
        "cafe",
        "café",
        "castle",
        "city",
        "coast",
        "falls",
        "farm",
        "garden",
        "gorge",
        "hotel",
        "island",
        "lake",
        "market",
        "museum",
        "onsen",
        "park",
        "pond",
        "port",
        "restaurant",
        "river",
        "ryokan",
        "shrine",
        "station",
        "street",
        "temple",
        "town",
        "trail",
        "village",
        "waterfall",
    ]
    places: list[dict[str, Any]] = []
    for chapter in parse_chapters(description):
        name = clean_line(chapter["title"])
        lowered = name.lower()
        if not name or len(name) > 80 or any(re.search(pattern, lowered) for pattern in skip_patterns):
            continue
        if "arrival at " not in lowered and not any(marker in lowered for marker in place_markers):
            continue
        review = f"描述欄章節將「{name}」列為本集日本旅行路線中的停留點；未提供原始地圖連結，改以 Google Maps 搜尋連結補足。"
        places.append(
            base_place(
                video=video,
                config=config,
                name=name,
                time_label=chapter["time"],
                seconds=chapter["seconds"],
                chapter_title=name,
                review=review,
                source_review=f"描述欄章節列出「{name}」。",
            )
        )
    return dedupe_places(places)


def hurley_name_from_line(line: str) -> str:
    line = clean_line(line)
    line = re.sub(r"^\d+\s*[.．、]\s*", "", line)
    line = re.sub(r"^○\s*", "", line)
    if re.match(r"^[・･]\s*(?:OZmall|一休|食べログ|公式|予約)", line, re.I):
        return ""
    return clean_line(line)


def parse_hurley(description: str, video: dict[str, Any], config: ChannelConfig) -> list[dict[str, Any]]:
    lines = [line.rstrip() for line in description.splitlines()]
    places: list[dict[str, Any]] = []
    active = False
    pending_name = ""
    added_names: set[str] = set()

    def add_place(name: str, source_url: str = "") -> None:
        key = name.strip().lower()
        if not key or key in added_names or is_noise_name(name):
            return
        added_names.add(key)
        review = f"描述欄將「{name}」列為本集介紹店家；未提供 Google Maps 直連，改以店名搜尋地圖。"
        place = base_place(
            video=video,
            config=config,
            name=name,
            review=review,
            source_review=(
                f"描述欄介紹店家「{name}」，來源連結：{source_url}"
                if source_url
                else f"描述欄介紹店家「{name}」。"
            ),
        )
        if source_url:
            place["source_url"] = source_url
        places.append(place)

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if "紹介したお店" in line or "紹介させていただいたお店" in line:
            active = True
            pending_name = ""
            continue
        if active and re.match(r"^▼(?:おすすめ検索方法|関連動画|インスタグラム|サブチャンネル|よくある質問)", line):
            if pending_name:
                add_place(pending_name)
            active = False
            pending_name = ""
            continue
        if not active:
            continue

        source_url = extract_url(line)
        if source_url and is_source_url(source_url):
            if pending_name:
                add_place(pending_name, source_url)
            continue
        if source_url:
            continue

        name = hurley_name_from_line(line)
        if not name:
            continue
        if re.match(r"^(?:\d+\s*[.．、]|○)", line):
            if pending_name:
                add_place(pending_name)
            pending_name = name

    if pending_name:
        add_place(pending_name)

    return dedupe_places(places)


def parse_generic_map_blocks(
    description: str, video: dict[str, Any], config: ChannelConfig
) -> list[dict[str, Any]]:
    lines = [line.strip() for line in description.splitlines()]
    chapters = parse_chapters(description)
    places: list[dict[str, Any]] = []
    for idx, line in enumerate(lines):
        if not is_map_url(line):
            continue
        map_url = extract_map_url(line)
        name = ""
        for prev in range(idx - 1, max(-1, idx - 5), -1):
            candidate = clean_line(lines[prev])
            if candidate and not is_noise_name(candidate) and not is_map_url(candidate):
                name = candidate
                break
        if not name:
            continue
        chapter = best_chapter_for_name(name, chapters)
        review = f"描述欄將「{name}」列為本集出現的店家或地點。"
        places.append(
            base_place(
                video=video,
                config=config,
                name=name,
                map_url=map_url,
                time_label=chapter["time"] if chapter else "",
                seconds=chapter["seconds"] if chapter else None,
                chapter_title=chapter["title"] if chapter else "",
                review=review,
                source_review=review,
            )
        )
    return dedupe_places(places)


def dedupe_places(places: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    deduped: list[dict[str, Any]] = []
    for place in places:
        key = (place.get("name", "").strip().lower(), place.get("map_url", "").strip())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(place)
    return deduped


def parse_places(description: str, video: dict[str, Any], config: ChannelConfig) -> list[dict[str, Any]]:
    if config.slug == "feipo1998":
        places = parse_feipo(description, video, config)
    elif config.slug == "lotmainidea":
        places = parse_lotmainidea(description, video, config)
    elif config.slug == "solointokyolife":
        places = parse_solo(description, video, config)
    elif config.slug == "hinalifeinjapan":
        places = parse_hina(description, video, config)
    elif config.slug == "cellia1025":
        places = parse_celia(description, video, config)
    elif config.slug == "missliv":
        places = parse_missliv(description, video, config)
    elif config.slug == "hirodaysintokyo":
        places = parse_hiro(description, video, config)
    elif config.slug == "uniquejapantravel":
        places = parse_uniquejapantravel(description, video, config)
    elif config.slug == "hurleygourmet":
        places = parse_hurley(description, video, config)
    else:
        places = []
    if not places:
        places = parse_generic_map_blocks(description, video, config)
    return places


def old_video_maps(config: ChannelConfig) -> tuple[dict[str, dict[str, Any]], set[str]]:
    raw_path = ROOT / f"{config.slug}_all_places_raw.json"
    raw = load_json(raw_path, [] if config.raw_kind == "list" else {})
    by_id: dict[str, dict[str, Any]] = {}
    no_place_ids: set[str] = set()

    if isinstance(raw, list):
        for video in raw:
            if video.get("id"):
                by_id[video["id"]] = video
                if not video.get("places"):
                    no_place_ids.add(video["id"])
        return by_id, no_place_ids

    if "videos" in raw:
        for video in raw.get("videos", []):
            video_id = video.get("id") or video.get("video_id")
            if video_id:
                by_id[video_id] = video
                if not video.get("places"):
                    no_place_ids.add(video_id)
        return by_id, no_place_ids

    grouped_places: dict[str, list[dict[str, Any]]] = {}
    for place in raw.get("places", []):
        video_id = place.get("video_id") or place.get("id")
        if video_id:
            grouped_places.setdefault(video_id, []).append(place)
    for video_id, places in grouped_places.items():
        first = places[0]
        by_id[video_id] = {
            "id": video_id,
            "title": first.get("video_title", ""),
            "url": first.get("video_url", f"https://www.youtube.com/watch?v={video_id}"),
            "published": first.get("published", ""),
            "views": first.get("views", ""),
            "channel": config.name,
            "places": places,
        }
    for item in raw.get("no_places", []):
        video_id = item.get("id") or item.get("video_id")
        if video_id:
            no_place_ids.add(video_id)
            by_id.setdefault(
                video_id,
                {
                    "id": video_id,
                    "title": item.get("title") or item.get("video_title", ""),
                    "url": item.get("url")
                    or item.get("video_url", f"https://www.youtube.com/watch?v={video_id}"),
                    "published": item.get("published", ""),
                    "views": item.get("views", ""),
                    "channel": config.name,
                    "places": [],
                },
            )
    return by_id, no_place_ids


def refresh_place_metadata(
    places: list[dict[str, Any]], video: dict[str, Any], config: ChannelConfig
) -> list[dict[str, Any]]:
    refreshed: list[dict[str, Any]] = []
    for place in places:
        updated = dict(place)
        updated["video_id"] = video["id"]
        updated["video_title"] = video["title"]
        updated["video_url"] = video["url"]
        updated["published"] = video.get("published", updated.get("published", ""))
        updated["views"] = video.get("views", updated.get("views", ""))
        updated["channel_name"] = config.name
        if "youtube_review" not in updated and "youtube_review_zh" in updated:
            updated["youtube_review"] = updated["youtube_review_zh"]
        if "youtube_review_zh" not in updated and "youtube_review" in updated:
            updated["youtube_review_zh"] = updated["youtube_review"]
        refreshed.append(updated)
    return refreshed


def merge_channel(config: ChannelConfig) -> tuple[list[dict[str, Any]], list[str]]:
    print(f"Fetching channel: {config.name}", flush=True)
    fetched_videos = fetch_channel_videos(config)
    old_by_id, old_no_places = old_video_maps(config)
    updated: list[dict[str, Any]] = []
    new_video_ids: list[str] = []
    fetched_ids: set[str] = set()

    for video in fetched_videos:
        fetched_ids.add(video["id"])
        old = old_by_id.get(video["id"])
        merged = dict(old) if old else {}
        merged.update(
            {
                "index": video["index"],
                "id": video["id"],
                "title": video["title"],
                "duration": video.get("duration", merged.get("duration", "")),
                "views": video.get("views", merged.get("views", "")),
                "published": video.get("published", merged.get("published", "")),
                "url": video["url"],
                "channel": config.name,
                "ok": merged.get("ok", True),
                "error": merged.get("error", ""),
            }
        )
        if old and (old.get("places") or video["id"] in old_no_places):
            merged["places"] = refresh_place_metadata(old.get("places", []), video, config)
        else:
            try:
                description, _player = fetch_video_description(video["id"])
                merged["description_length"] = len(description)
                merged["places"] = parse_places(description, video, config)
                new_video_ids.append(video["id"])
                time.sleep(0.2)
            except Exception as exc:
                merged["ok"] = False
                merged["error"] = str(exc)
                merged["places"] = []
                new_video_ids.append(video["id"])
        updated.append(merged)

    preserved = sorted(
        (video for video_id, video in old_by_id.items() if video_id not in fetched_ids),
        key=lambda video: video.get("index", 10**9),
    )
    for old in preserved:
        video_id = old.get("id") or old.get("video_id")
        if not video_id:
            continue
        merged = dict(old)
        merged.update(
            {
                "id": video_id,
                "title": old.get("title") or old.get("video_title", ""),
                "url": old.get("url")
                or old.get("video_url", f"https://www.youtube.com/watch?v={video_id}"),
                "channel": config.name,
                "ok": old.get("ok", True),
                "error": old.get("error", ""),
            }
        )
        merged["places"] = refresh_place_metadata(old.get("places", []), merged, config)
        updated.append(merged)

    for index, video in enumerate(updated, 1):
        video["index"] = index
    return updated, new_video_ids


def place_timestamp(place: dict[str, Any]) -> tuple[str, int | None]:
    label = (
        place.get("time")
        or place.get("timestamp_label")
        or seconds_to_label(place.get("seconds") or place.get("timestamp_seconds"))
    )
    seconds = place.get("seconds")
    if seconds is None:
        seconds = place.get("timestamp_seconds")
    if seconds is None and label:
        seconds = time_to_seconds(label)
    return label or "", seconds


def video_timestamp_link(video_url: str, label: str, seconds: int | None) -> str:
    if not label and seconds is None:
        return f"[YouTube]({video_url})"
    if seconds is None:
        seconds = time_to_seconds(label)
    if seconds is None:
        return f"[{md_escape(label)}]({video_url})"
    return f"[{md_escape(label or seconds_to_label(seconds))}]({video_url}&t={seconds}s)"


def render_map_link(place: dict[str, Any], config: ChannelConfig) -> str:
    url = place.get("map_url", "")
    name = place.get("name", "")
    if not url:
        query = " ".join(part for part in [name, config.search_suffix] if part)
        url = google_search_url(query)
    return f"[{map_label(url)}]({url})"


def google_rating(place: dict[str, Any], rating_map: dict[str, str] | None = None) -> str:
    url = place.get("map_url", "")
    if rating_map and url in rating_map:
        return rating_map[url]
    return place.get("google_rating") or "Google Maps 未取得"


def youtube_review(place: dict[str, Any]) -> str:
    return (
        place.get("youtube_review")
        or place.get("youtube_review_zh")
        or place.get("source_review")
        or "影片僅列出店家，未提供明確心得。"
    )


def count_direct_maps(places: list[dict[str, Any]]) -> tuple[int, int, int]:
    direct = 0
    search = 0
    naver = 0
    for place in places:
        url = place.get("map_url", "")
        if "naver" in url.lower():
            naver += 1
        elif "google.com/maps/search" in url.lower() or not url:
            search += 1
        elif url:
            direct += 1
    return direct, search, naver


def load_rating_map(config: ChannelConfig) -> dict[str, str]:
    path = ROOT / f"{config.slug}_map_ratings.json"
    if not path.exists():
        return {}
    data = load_json(path, {})
    ratings: dict[str, str] = {}
    if not isinstance(data, dict):
        return ratings
    for url, entry in data.items():
        if not isinstance(entry, dict):
            continue
        rating = str(entry.get("rating", "") or "").strip()
        reviews = str(entry.get("reviews", "") or "").strip()
        if not rating:
            continue
        if reviews.isdigit():
            reviews = f"{int(reviews):,}"
        ratings[url] = (
            f"Google Maps {rating}（{reviews} 則評論）"
            if reviews
            else f"Google Maps {rating}"
        )
    return ratings


def render_all_places(config: ChannelConfig, videos: list[dict[str, Any]], new_ids: list[str]) -> str:
    all_places = [place for video in videos for place in video.get("places", [])]
    direct_maps, search_maps, naver_maps = count_direct_maps(all_places)
    no_place_count = sum(1 for video in videos if not video.get("places"))
    rating_map = load_rating_map(config)
    lines = [
        f"# {config.place_title}",
        "",
        f"- 頻道：[{config.name}]({config.source})",
        f"- 抓取日期：{TODAY}",
        "- 整理流程：本輪重新抓取 YouTube 頻道影片清單；舊影片地點沿用既有抽取資料，新增影片解析 YouTube 描述欄/章節。",
        f"- 本檔整理影片：{len(videos)} 部；本輪新增或補抓描述欄：{len(new_ids)} 部。",
        f"- 店家/地點總筆數：{len(all_places)} 筆；原始 Google/Share 地圖連結 {direct_maps} 筆，搜尋補足 {search_maps} 筆，Naver Map {naver_maps} 筆。",
        "- Google Maps 評分本輪未逐筆重查；既有評分保留，新增列標示未取得。",
        f"- 無店家資料影片清單：見 [{config.slug}_no_places.md](./{config.slug}_no_places.md)。",
        "",
    ]
    if new_ids:
        lines.append(f"- 本輪新增/補抓影片 ID：{', '.join(new_ids[:20])}" + (" ..." if len(new_ids) > 20 else ""))
        lines.append("")

    for video in videos:
        places = video.get("places", [])
        if not places:
            continue
        lines.extend(
            [
                f"## {video.get('index', '')}. {md_escape(video.get('title', ''))}",
                "",
                f"- 影片：[YouTube]({video.get('url', '')})",
                f"- 發布時間：{md_escape(video.get('published', ''))}；{md_escape(video.get('views', '') or '觀看次數：未取得')}",
                "",
                "| 店名 | 地圖連結 | Google Maps 評價 | YouTube 評價 | 影片連結 | 頻道名稱 |",
                "| --- | --- | --- | --- | --- | --- |",
            ]
        )
        for place in places:
            label, seconds = place_timestamp(place)
            lines.append(
                "| {name} | {map_link} | {rating} | {review} | {video_link} | {channel} |".format(
                    name=md_escape(place.get("name", "")),
                    map_link=render_map_link(place, config),
                    rating=md_escape(google_rating(place, rating_map)),
                    review=md_escape(youtube_review(place)),
                    video_link=video_timestamp_link(video.get("url", ""), label, seconds),
                    channel=md_escape(config.name),
                )
            )
        lines.append("")

    if no_place_count == len(videos):
        lines.append("本輪未抓到可整理的店家/地點資料。")
    return "\n".join(lines).rstrip() + "\n"


def render_all_videos(config: ChannelConfig, videos: list[dict[str, Any]]) -> str:
    include_place_count = config.raw_kind == "flat"
    lines = [
        f"# {config.name} 頻道影片清單" if config.raw_kind != "flat" else f"# {config.name} 全頻道影片清單",
        "",
        f"- 頻道：[{config.name}]({config.source})",
        f"- 分頁：[影片]({config.videos_url})",
        f"- 抓取日期：{TODAY}",
        f"- 本檔整理筆數：{len(videos)} 部",
        "",
    ]
    if include_place_count:
        lines.extend(
            [
                "| # | 影片標題 | 發布時間 | 觀看次數 | 店家/地點筆數 | 影片連結 |",
                "| --- | --- | --- | --- | ---: | --- |",
            ]
        )
        for video in videos:
            lines.append(
                f"| {video['index']} | {md_escape(video['title'])} | {md_escape(video.get('published', ''))} | "
                f"{md_escape(video.get('views', ''))} | {len(video.get('places', []))} | [YouTube]({video['url']}) |"
            )
    else:
        lines.extend(
            [
                "| # | 影片標題 | 長度 | 觀看次數 | 發布時間 | 影片連結 |",
                "| --- | --- | --- | --- | --- | --- |",
            ]
        )
        for video in videos:
            lines.append(
                f"| {video['index']} | {md_escape(video['title'])} | {md_escape(video.get('duration', ''))} | "
                f"{md_escape(video.get('views', ''))} | {md_escape(video.get('published', ''))} | [YouTube]({video['url']}) |"
            )
    return "\n".join(lines) + "\n"


def render_no_places(config: ChannelConfig, videos: list[dict[str, Any]]) -> str:
    no_places = [video for video in videos if not video.get("places")]
    lines = [
        f"# {config.no_places_title}",
        "",
        f"- 頻道：[{config.name}]({config.source})",
        f"- 抓取日期：{TODAY}",
        f"- 未抓到店家/地點資料：{len(no_places)} 部",
        "",
        "| # | 影片標題 | 發布時間 | 觀看次數 | 影片連結 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for video in no_places:
        lines.append(
            f"| {video.get('index', '')} | {md_escape(video.get('title', ''))} | "
            f"{md_escape(video.get('published', ''))} | {md_escape(video.get('views', ''))} | [YouTube]({video.get('url', '')}) |"
        )
    return "\n".join(lines) + "\n"


def write_raw(config: ChannelConfig, videos: list[dict[str, Any]]) -> None:
    raw_path = ROOT / f"{config.slug}_all_places_raw.json"
    if config.raw_kind == "list":
        write_json(raw_path, videos)
        return

    if config.raw_kind == "nested_dict":
        write_json(
            raw_path,
            {
                "channel": config.name,
                "handle": f"@{config.handle}",
                "source": config.source,
                "fetched_at": FETCHED_AT,
                "videos": videos,
            },
        )
        return

    flat_places: list[dict[str, Any]] = []
    no_places: list[dict[str, Any]] = []
    for video in videos:
        if video.get("places"):
            flat_places.extend(video["places"])
        else:
            no_places.append(
                {
                    "id": video["id"],
                    "title": video["title"],
                    "url": video["url"],
                    "published": video.get("published", ""),
                    "views": video.get("views", ""),
                }
            )
    write_json(
        raw_path,
        {
            "channel_name": config.name,
            "channel_url": config.source,
            "extracted_at": FETCHED_AT,
            "videos_count": len(videos),
            "places_count": len(flat_places),
            "places": flat_places,
            "no_places": no_places,
            "gemini_reviewed_places": len(flat_places),
        },
    )


def write_gemini_reviews(config: ChannelConfig, videos: list[dict[str, Any]]) -> None:
    path = ROOT / f"{config.slug}_gemini_reviews.json"
    if not path.exists() or config.slug not in {"feipo1998", "lotmainidea"}:
        return
    reviews: dict[str, str] = {}
    for video in videos:
        for idx, place in enumerate(video.get("places", []), 1):
            if config.slug == "feipo1998":
                key = f"{video.get('index', 0)}-{idx}"
            else:
                key = f"{video.get('id', '')}-{idx}"
            reviews[key] = youtube_review(place)
    write_json(path, reviews)


def write_reports(config: ChannelConfig, videos: list[dict[str, Any]], new_ids: list[str]) -> None:
    write_raw(config, videos)
    (ROOT / f"{config.slug}_all_places.md").write_text(
        render_all_places(config, videos, new_ids), encoding="utf-8"
    )
    (ROOT / f"{config.slug}_all_videos.md").write_text(
        render_all_videos(config, videos), encoding="utf-8"
    )
    (ROOT / f"{config.slug}_no_places.md").write_text(
        render_no_places(config, videos), encoding="utf-8"
    )
    write_gemini_reviews(config, videos)


def main(argv: list[str]) -> int:
    wanted = set(argv[1:])
    configs = [config for config in CHANNELS if not wanted or config.slug in wanted or config.handle in wanted]
    if not configs:
        print("No matching channel config", file=sys.stderr)
        return 2

    summary: list[tuple[str, int, int, int]] = []
    for config in configs:
        videos, new_ids = merge_channel(config)
        write_reports(config, videos, new_ids)
        places = sum(len(video.get("places", [])) for video in videos)
        summary.append((config.slug, len(videos), places, len(new_ids)))
        print(
            f"Updated {config.slug}: videos={len(videos)} places={places} new_or_refetched={len(new_ids)}",
            flush=True,
        )

    print("\nSummary")
    for slug, videos_count, places_count, new_count in summary:
        print(f"- {slug}: {videos_count} videos, {places_count} places, {new_count} new/refetched")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
