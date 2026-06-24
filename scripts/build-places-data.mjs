import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.join(rootDir, "public", "data");
const outputFile = path.join(dataDir, "places.json");
const mapLinkCacheFile = path.join(dataDir, "map-link-cache.json");
const googlePlaceCacheFile = path.join(dataDir, "google-place-cache.json");

const rawPlaceFilePattern = /_all_places_raw\.json$/;
const ratingFilePattern = /_(map_ratings|map_resolved)\.json$/;

const categoryFallbacks = [
  {
    key: "cafe",
    label: "咖啡",
    pattern:
      /coffee|cafe|café|珈琲|咖啡|喫茶|茶房|roastery|espresso|latte/i,
  },
  {
    key: "dessert",
    label: "甜點",
    pattern:
      /bakery|bake|bread|patisserie|pastry|dessert|gelato|ice cream|パン|麵包|甜點|菓|蛋糕|ベーカリー/i,
  },
  {
    key: "food",
    label: "餐廳",
    pattern:
      /restaurant|ramen|sushi|izakaya|grill|bar|dining|kitchen|food|curry|市場|食堂|料理|餐|飯|拉麵|壽司|焼|居酒屋|カレー|餃子|そば|うどん|グルメ/i,
  },
  {
    key: "shopping",
    label: "購物",
    pattern:
      /shop|store|mall|market|outlet|select|beams|uniqlo|loft|百貨|商場|商店|購物|選物|店|市場|服飾|書店/i,
  },
  {
    key: "sight",
    label: "景點",
    pattern:
      /park|garden|temple|shrine|museum|gallery|tower|observatory|aquarium|castle|公園|庭園|神社|寺|美術館|博物館|展望|城|水族館|景點|散策/i,
  },
  {
    key: "transit",
    label: "交通",
    pattern:
      /station|airport|terminal|jr |metro|train|bus|駅|空港|機場|車站|站|巴士|電車|鉄道|港/i,
  },
  {
    key: "stay",
    label: "住宿",
    pattern: /hotel|hostel|ryokan|inn|resort|ホテル|旅館|住宿|民宿/i,
  },
];

const googleTypeLabels = new Map([
  ["cafe", "咖啡"],
  ["coffee_shop", "咖啡"],
  ["bakery", "甜點"],
  ["dessert_shop", "甜點"],
  ["restaurant", "餐廳"],
  ["japanese_restaurant", "餐廳"],
  ["ramen_restaurant", "餐廳"],
  ["sushi_restaurant", "餐廳"],
  ["meal_takeaway", "餐廳"],
  ["food", "餐廳"],
  ["store", "購物"],
  ["shopping_mall", "購物"],
  ["department_store", "購物"],
  ["book_store", "購物"],
  ["clothing_store", "購物"],
  ["tourist_attraction", "景點"],
  ["park", "景點"],
  ["museum", "景點"],
  ["art_gallery", "景點"],
  ["place_of_worship", "景點"],
  ["train_station", "交通"],
  ["subway_station", "交通"],
  ["transit_station", "交通"],
  ["airport", "交通"],
  ["lodging", "住宿"],
]);

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function sha(value, length = 12) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, length);
}

function slug(value) {
  return String(value || "unknown")
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(value) {
  const text = cleanText(value)
    .replace(/^\d{1,2}:\d{2}(?::\d{2})?\s*/, "")
    .replace(/^[^\p{Letter}\p{Number}]+/u, "")
    .trim();
  return text || cleanText(value) || "未命名地點";
}

function extractFirstUrl(value) {
  const match = String(value || "").match(/https?:\/\/[^\s)\]]+/);
  return match ? match[0].replace(/[，。]+$/u, "") : "";
}

function stripTracking(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    for (const key of ["g_st", "entry", "g_ep", "skid"]) {
      parsed.searchParams.delete(key);
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function getQueryParam(url, key) {
  try {
    return new URL(url).searchParams.get(key) || "";
  } catch {
    return "";
  }
}

function decodeMapSearch(url) {
  if (!url) return "";
  const query = getQueryParam(url, "query");
  return query ? cleanText(query) : "";
}

function parseLocationFromUrl(url) {
  const text = String(url || "");
  const atMatch = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const dataMatch = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const match = dataMatch || atMatch;
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function parseRating(value) {
  if (typeof value === "number") return value;
  const match = String(value || "").match(/([0-5](?:\.\d)?)/);
  return match ? Number(match[1]) : null;
}

function parseReviewCount(value) {
  const text = String(value || "").replace(/,/g, "");
  const match = text.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function normalizeChannelId(channelName, channelUrlOrHandle) {
  const handle = cleanText(channelUrlOrHandle)
    .replace(/^https?:\/\/(?:www\.)?youtube\.com\//, "")
    .replace(/^@/, "");
  return slug(handle || channelName || "channel") || `channel-${sha(channelName)}`;
}

function buildSearchQuery(place) {
  const decodedMapQuery = decodeMapSearch(place.mapUrl);
  const address = cleanText(place.address);
  const name = cleanName(place.name);
  if (decodedMapQuery) return decodedMapQuery;
  if (address) return `${name} ${address}`;
  return `${name} Japan`;
}

function categoryFromGoogle(google) {
  if (!google) return null;
  const candidates = [
    google.primaryType,
    ...(Array.isArray(google.types) ? google.types : []),
  ].filter(Boolean);
  for (const type of candidates) {
    if (googleTypeLabels.has(type)) {
      const label = googleTypeLabels.get(type);
      return {
        key: slug(label),
        label,
        source: "google",
      };
    }
  }
  if (google.primaryTypeDisplayName?.text) {
    const label = google.primaryTypeDisplayName.text;
    return { key: slug(label) || "google-type", label, source: "google" };
  }
  return null;
}

function inferCategory(record) {
  const text = [
    record.name,
    record.address,
    record.sourceReview,
    record.youtubeReview,
    record.videoTitle,
  ].join(" ");
  for (const category of categoryFallbacks) {
    if (category.pattern.test(text)) {
      return { key: category.key, label: category.label, source: "heuristic" };
    }
  }
  return { key: "other", label: "其他", source: "heuristic" };
}

function loadRatings() {
  const ratings = new Map();
  const resolved = new Map();
  for (const file of fs.readdirSync(rootDir).filter((name) => ratingFilePattern.test(name))) {
    const content = readJson(path.join(rootDir, file), {});
    for (const [rawUrl, value] of Object.entries(content)) {
      const mapUrl = stripTracking(extractFirstUrl(rawUrl) || rawUrl);
      if (!mapUrl || typeof value !== "object" || !value) continue;
      if ("rating" in value || "reviews" in value || "resolved_url" in value) {
        ratings.set(mapUrl, {
          name: value.name || "",
          rating: parseRating(value.rating),
          userRatingCount: parseReviewCount(value.reviews),
          googleMapsUri: value.resolved_url || "",
        });
      }
      if ("final_url" in value || "resolved_url" in value) {
        resolved.set(mapUrl, value.final_url || value.resolved_url || "");
      }
    }
  }
  return { ratings, resolved };
}

function loadCache(filePath) {
  const cache = readJson(filePath, { records: {} });
  return new Map(Object.entries(cache.records || {}));
}

function getRawPlaceEntries(raw, fileName) {
  if (Array.isArray(raw)) {
    return raw.flatMap((video, videoIndex) =>
      (video.places || []).map((place, placeIndex) => ({
        place,
        video,
        placeIndex,
        videoIndex,
        channelName: video.channel || video.channel_name || "SoloInTokyoLife",
        channelUrlOrHandle: video.channel_url || "@solointokyolife",
        fileName,
      })),
    );
  }

  if (raw?.videos) {
    return raw.videos.flatMap((video, videoIndex) =>
      (video.places || []).map((place, placeIndex) => ({
        place,
        video,
        placeIndex,
        videoIndex,
        channelName: raw.channel || video.channel || place.channel_name,
        channelUrlOrHandle: raw.handle || raw.channel_url || "",
        fileName,
      })),
    );
  }

  if (raw?.places) {
    return raw.places.map((place, placeIndex) => ({
      place,
      video: place,
      placeIndex,
      videoIndex: 0,
      channelName: raw.channel_name || place.channel_name,
      channelUrlOrHandle: raw.channel_url || "",
      fileName,
    }));
  }

  return [];
}

function normalizeMention(entry, ratings, resolved) {
  const { place, video, placeIndex, videoIndex, channelName, channelUrlOrHandle, fileName } =
    entry;
  const channelId = normalizeChannelId(channelName, channelUrlOrHandle);
  const rawMapValue = place.map_url || place.source_url || "";
  const mapUrl = stripTracking(extractFirstUrl(rawMapValue) || rawMapValue);
  const sourceKeyBase = mapUrl || `${fileName}:${video.id || place.video_id}:${placeIndex}:${place.name}`;
  const sourceKey = `src_${sha(sourceKeyBase, 18)}`;
  const ratingRecord = ratings.get(mapUrl);
  const resolvedUrl = resolved.get(mapUrl) || ratingRecord?.googleMapsUri || "";
  const name = cleanName(place.name || ratingRecord?.name);
  const googleRatingText = place.google_rating || "";
  const rating = ratingRecord?.rating ?? parseRating(googleRatingText);
  const userRatingCount =
    ratingRecord?.userRatingCount ?? parseReviewCount(googleRatingText);
  const explicitLocation =
    place.location && typeof place.location === "object"
      ? parseLocationFromUrl(`@${place.location.lat},${place.location.lng}`)
      : null;
  const lat = place.lat ?? place.latitude;
  const lng = place.lng ?? place.longitude;
  const fieldLocation =
    Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
      ? { lat: Number(lat), lng: Number(lng) }
      : null;
  const location = explicitLocation || fieldLocation || parseLocationFromUrl(resolvedUrl || mapUrl);
  const videoId = place.video_id || video.id || "";
  const seconds =
    typeof place.seconds === "number"
      ? place.seconds
      : typeof place.timestamp_seconds === "number"
        ? place.timestamp_seconds
        : null;
  const time = cleanText(place.time || place.timestamp_label || "");
  const videoUrl =
    place.video_url || video.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");
  const youtubeUrl =
    videoUrl && seconds !== null && seconds > 0
      ? `${videoUrl}${videoUrl.includes("?") ? "&" : "?"}t=${seconds}s`
      : videoUrl;

  return {
    sourceKey,
    name,
    normalizedName: name.toLocaleLowerCase("zh-Hant"),
    mapUrl,
    resolvedUrl,
    address: cleanText(place.address),
    searchQuery: buildSearchQuery({ ...place, name, mapUrl }),
    rating,
    userRatingCount,
    location,
    channel: {
      id: channelId,
      name: cleanText(channelName || place.channel_name || "未命名頻道"),
      url: channelUrlOrHandle?.startsWith("http")
        ? channelUrlOrHandle
        : channelUrlOrHandle
          ? `https://www.youtube.com/${channelUrlOrHandle.startsWith("@") ? channelUrlOrHandle : `@${channelUrlOrHandle}`}`
          : "",
    },
    mention: {
      id: `${channelId}:${videoId || `video-${videoIndex}`}:${placeIndex}`,
      sourceKey,
      channelId,
      channelName: cleanText(channelName || place.channel_name || "未命名頻道"),
      videoId,
      videoTitle: cleanText(place.video_title || video.title),
      videoUrl: youtubeUrl,
      published: cleanText(place.published || video.published),
      views: cleanText(place.views || video.views),
      time,
      seconds,
      mapUrl,
      sourceReview: cleanText(place.source_review || place.source_line),
      youtubeReview: cleanText(place.youtube_review_zh || place.youtube_review),
    },
  };
}

function mergeMapLinkFromCache(record, cacheEntry) {
  if (!cacheEntry || cacheEntry.status !== "ok") return null;
  return {
    location: cacheEntry.location || record.location,
    resolvedUrl: cacheEntry.finalUrl || record.resolvedUrl,
  };
}

function mergeGoogleFromCache(record, cacheEntry) {
  if (!cacheEntry || cacheEntry.status !== "ok") return null;
  const google = {
    placeId: cacheEntry.placeId || "",
    displayName: cacheEntry.displayName || "",
    formattedAddress: cacheEntry.formattedAddress || "",
    primaryType: cacheEntry.primaryType || "",
    primaryTypeDisplayName: cacheEntry.primaryTypeDisplayName || null,
    types: cacheEntry.types || [],
    rating: cacheEntry.rating ?? record.rating,
    userRatingCount: cacheEntry.userRatingCount ?? record.userRatingCount,
    googleMapsUri: cacheEntry.googleMapsUri || record.resolvedUrl || record.mapUrl,
    googleMapsLinks: cacheEntry.googleMapsLinks || {},
    fetchedAt: cacheEntry.fetchedAt || "",
  };
  return {
    google,
    location: cacheEntry.location || record.location,
  };
}

function groupRecords(records, mapLinkCache, googleCache) {
  const groups = new Map();

  for (const record of records) {
    const mapLinkEntry = mapLinkCache.get(record.sourceKey);
    const mapLink = mergeMapLinkFromCache(record, mapLinkEntry);
    const googleEntry = googleCache.get(record.sourceKey);
    const googleMerge = mergeGoogleFromCache(record, googleEntry);
    const google = googleMerge?.google || null;
    const resolvedUrl = mapLink?.resolvedUrl || record.resolvedUrl;
    const location = googleMerge?.location || mapLink?.location || record.location;
    const groupKey = google?.placeId
      ? `place:${google.placeId}`
      : resolvedUrl
        ? `resolved:${sha(resolvedUrl, 18)}`
        : record.mapUrl
          ? `url:${sha(record.mapUrl, 18)}`
          : `query:${sha(`${record.normalizedName}:${record.address}`, 18)}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        id: `p_${sha(groupKey, 16)}`,
        name: google?.displayName || record.name,
        normalizedName: record.normalizedName,
        address: google?.formattedAddress || record.address,
        mapUrl: google?.googleMapsUri || resolvedUrl || record.mapUrl,
        searchQuery: record.searchQuery,
        sourceKeys: [],
        location,
        rating: google?.rating ?? record.rating,
        userRatingCount: google?.userRatingCount ?? record.userRatingCount,
        google,
        category: categoryFromGoogle(google) || inferCategory(record),
        mentions: [],
      });
    }

    const group = groups.get(groupKey);
    if (!group.sourceKeys.includes(record.sourceKey)) group.sourceKeys.push(record.sourceKey);
    group.mentions.push(record.mention);
    if (!group.location && location) group.location = location;
    if (!group.google && google) group.google = google;
    if (!group.rating && record.rating) group.rating = record.rating;
    if (!group.userRatingCount && record.userRatingCount) {
      group.userRatingCount = record.userRatingCount;
    }
  }

  return Array.from(groups.values())
    .map((place) => ({
      ...place,
      mentions: place.mentions.sort((a, b) =>
        `${a.channelName}${a.videoTitle}`.localeCompare(`${b.channelName}${b.videoTitle}`, "zh-Hant"),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
}

function buildChannels(records) {
  const channels = new Map();
  for (const record of records) {
    if (!channels.has(record.channel.id)) {
      channels.set(record.channel.id, {
        ...record.channel,
        mentions: 0,
      });
    }
    channels.get(record.channel.id).mentions += 1;
  }
  return Array.from(channels.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "zh-Hant"),
  );
}

function main() {
  const files = fs.readdirSync(rootDir).filter((file) => rawPlaceFilePattern.test(file));
  const { ratings, resolved } = loadRatings();
  const mapLinkCache = loadCache(mapLinkCacheFile);
  const googleCache = loadCache(googlePlaceCacheFile);
  const records = [];

  for (const file of files) {
    const raw = readJson(path.join(rootDir, file));
    const entries = getRawPlaceEntries(raw, file);
    for (const entry of entries) {
      records.push(normalizeMention(entry, ratings, resolved));
    }
  }

  const places = groupRecords(records, mapLinkCache, googleCache);
  const locatedPlaces = places.filter((place) => place.location);
  const locatedSourceKeys = new Set(locatedPlaces.flatMap((place) => place.sourceKeys));
  const locatedRecords = records.filter((record) => locatedSourceKeys.has(record.sourceKey));
  const output = {
    generatedAt: new Date().toISOString(),
    sourceFiles: files,
    stats: {
      rawMentions: locatedRecords.length,
      places: locatedPlaces.length,
      locatedPlaces: locatedPlaces.length,
      unresolvedPlaces: 0,
      channels: new Set(locatedRecords.map((record) => record.channel.id)).size,
    },
    channels: buildChannels(locatedRecords),
    places: locatedPlaces,
  };

  writeJson(outputFile, output);
  console.log(
    `Built ${path.relative(rootDir, outputFile)}: ${locatedPlaces.length} located places, ${locatedRecords.length} mentions, ${places.length - locatedPlaces.length} skipped without coordinates.`,
  );
}

main();
