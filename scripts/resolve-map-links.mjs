import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const placesFile = path.join(rootDir, "public", "data", "places.json");
const cacheFile = path.join(__dirname, "data", "map-link-cache.json");

const userAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

function parseArgs(argv) {
  const args = {
    limit: 250,
    force: false,
    dryRun: false,
    rebuild: true,
  };
  for (const arg of argv) {
    if (arg === "--force") args.force = true;
    if (arg === "--dry-run") args.dryRun = true;
    if (arg === "--no-rebuild") args.rebuild = false;
    if (arg.startsWith("--limit=")) {
      const value = arg.split("=")[1];
      args.limit = value === "all" ? Infinity : Number(value);
    }
  }
  return args;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function parseLocationFromUrl(url) {
  const text = String(url || "");
  const dataMatch = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const atMatch = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const centerMatch = text.match(/[?&](?:ll|center)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const match = dataMatch || atMatch || centerMatch;
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function isResolvableMapUrl(url) {
  const lowered = String(url || "").toLowerCase();
  if (!lowered.startsWith("http")) return false;
  if (lowered.includes("naver.")) return false;
  if (lowered.includes("google.com/maps/search")) return false;
  return [
    "maps.app.goo.gl",
    "goo.gl/maps",
    "share.google/",
    "google.com/maps",
    "google.com.tw/maps",
  ].some((marker) => lowered.includes(marker));
}

function isSearchOnlyMapUrl(url) {
  const lowered = String(url || "").toLowerCase();
  return lowered.includes("google.com/maps/search");
}

function normalizeUrl(url) {
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

async function resolveMapUrl(url) {
  const normalizedUrl = normalizeUrl(url);
  const existingLocation = parseLocationFromUrl(normalizedUrl);
  if (existingLocation) {
    return {
      status: "ok",
      source: "url",
      url: normalizedUrl,
      finalUrl: normalizedUrl,
      location: existingLocation,
    };
  }

  if (!isResolvableMapUrl(normalizedUrl)) {
    return {
      status: isSearchOnlyMapUrl(normalizedUrl) ? "search_url_no_coordinates" : "unsupported_url",
      source: "url",
      url: normalizedUrl,
    };
  }

  const response = await fetch(normalizedUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": userAgent,
      "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8,ja;q=0.7",
    },
    signal: AbortSignal.timeout(18000),
  });

  const finalUrl = normalizeUrl(response.url || normalizedUrl);
  let location = parseLocationFromUrl(finalUrl);
  let bodySnippet = "";

  if (!location) {
    const body = await response.text();
    bodySnippet = body.slice(0, 2_000_000);
    location = parseLocationFromUrl(bodySnippet);
  }

  if (!location) {
    return {
      status: "no_coordinates",
      source: "redirect",
      url: normalizedUrl,
      finalUrl,
      httpStatus: response.status,
    };
  }

  return {
    status: "ok",
    source: "redirect",
    url: normalizedUrl,
    finalUrl,
    httpStatus: response.status,
    location,
  };
}

function ensurePlacesData() {
  if (fs.existsSync(placesFile)) return;
  const result = spawnSync(process.execPath, ["scripts/build-places-data.mjs"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Failed to build initial places data.");
  }
}

function sourceKeysForPlace(place) {
  return Array.isArray(place.sourceKeys) && place.sourceKeys.length
    ? place.sourceKeys
    : [place.id];
}

function cacheResultForPlace(records, place, result) {
  for (const key of sourceKeysForPlace(place)) {
    records[key] = {
      ...result,
      fetchedAt: new Date().toISOString(),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  ensurePlacesData();

  const placesData = readJson(placesFile, { places: [] });
  const cache = readJson(cacheFile, { generatedAt: "", records: {} });
  const records = cache.records || {};

  const candidates = placesData.places.filter((place) => {
    if (place.location && !args.force) return false;
    if (!place.mapUrl) return false;
    if (!args.force && sourceKeysForPlace(place).some((key) => records[key])) return false;
    return true;
  });
  const limited = candidates.slice(0, args.limit);

  console.log(
    `Resolving ${limited.length} of ${candidates.length} pending map links without Google Places API.`,
  );

  let resolved = 0;
  let skipped = 0;
  let failed = 0;

  for (const place of limited) {
    if (args.dryRun) {
      console.log(`[dry-run] ${place.name}: ${place.mapUrl}`);
      continue;
    }

    try {
      const result = await resolveMapUrl(place.mapUrl);
      cacheResultForPlace(records, place, result);
      if (result.status === "ok") {
        resolved += 1;
        console.log(`ok: ${place.name}`);
      } else {
        skipped += 1;
        console.log(`${result.status}: ${place.name}`);
      }
    } catch (error) {
      failed += 1;
      cacheResultForPlace(records, place, {
        status: "error",
        source: "redirect",
        url: normalizeUrl(place.mapUrl),
        message: error instanceof Error ? error.message : String(error),
      });
      console.error(`error: ${place.name}: ${error instanceof Error ? error.message : error}`);
    }

    if ((resolved + skipped + failed) % 20 === 0) {
      writeJson(cacheFile, {
        generatedAt: new Date().toISOString(),
        records,
      });
    }
  }

  writeJson(cacheFile, {
    generatedAt: new Date().toISOString(),
    records,
  });

  if (args.rebuild) {
    const rebuild = spawnSync(process.execPath, ["scripts/build-places-data.mjs"], {
      cwd: rootDir,
      stdio: "inherit",
    });
    if (rebuild.status !== 0) {
      throw new Error("Map-link cache was written, but rebuilding places data failed.");
    }
  }

  console.log(
    `Map-link resolve complete: ${resolved} resolved, ${skipped} skipped, ${failed} failed.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
