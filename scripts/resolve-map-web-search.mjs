/* global WebSocket */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const cacheFile = path.join(__dirname, "data", "map-link-cache.json");

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function parseArgs(argv) {
  const args = {
    limit: 100,
    force: false,
    dryRun: false,
    channel: "",
    delayMs: 2200,
    port: 9333,
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
    if (arg.startsWith("--channel=")) args.channel = arg.split("=").slice(1).join("=");
    if (arg.startsWith("--delay-ms=")) args.delayMs = Number(arg.split("=")[1]);
    if (arg.startsWith("--port=")) args.port = Number(arg.split("=")[1]);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLocationFromUrl(url) {
  const text = String(url || "");
  const dataMatch = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const atMatch = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const plainMatch = text.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
  const match = dataMatch || atMatch || plainMatch;
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanNameForSearch(value) {
  return cleanText(value)
    .replace(/】.*$/u, "")
    .replace(/←.*$/u, "")
    .replace(/（.*?予約.*?）/u, "")
    .replace(/：.*$/u, "")
    .replace(/\([^)]*(?:楽天|一休|Tripadvisor|トリップアドバイザー)[^)]*\)/iu, "")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function inferRegion(place) {
  const text = [
    place.name,
    place.address,
    place.searchQuery,
    ...(place.mentions || []).flatMap((mention) => [
      mention.videoTitle,
      mention.sourceReview,
      mention.youtubeReview,
    ]),
  ].join(" ");
  const rules = [
    [/曼谷|Bangkok/i, "Bangkok Thailand"],
    [/首爾|Seoul|서울/i, "Seoul South Korea"],
    [/釜山|Busan|南浦洞/i, "Busan South Korea"],
    [/新加坡|Singapore/i, "Singapore"],
    [/峴港|Da Nang/i, "Da Nang Vietnam"],
    [/台北|臺北|中山區|松山區|信義|公館|Roosevelt|Taipei/i, "Taipei Taiwan"],
    [/新北|樹林/i, "New Taipei Taiwan"],
    [/桃園|Taoyuan/i, "Taoyuan Taiwan"],
    [/新竹|Hsinchu/i, "Hsinchu Taiwan"],
    [/倫敦|London|大笨鐘|科芬園|中國城/i, "London UK"],
    [/阿姆斯特丹|Amsterdam|運河區/i, "Amsterdam Netherlands"],
    [/香港|維多莉亞港|Hong Kong/i, "Hong Kong"],
    [/雪梨|Sydney|Bondi|Kirribilli|Barangaroo/i, "Sydney Australia"],
    [/蒙馬特|Paris|巴黎/i, "Paris France"],
    [/東京站|東京駅|Tokyo Station|丸之內|丸の内|Marunouchi|有樂町|有楽町/i, "Tokyo Station Tokyo Japan"],
    [/銀座|Ginza/i, "Ginza Tokyo Japan"],
    [/新宿|Shinjuku/i, "Shinjuku Tokyo Japan"],
    [/池袋|Ikebukuro/i, "Ikebukuro Tokyo Japan"],
    [/上野|Ueno/i, "Ueno Tokyo Japan"],
    [/浅草|淺草|Asakusa/i, "Asakusa Tokyo Japan"],
    [/神田|Kanda/i, "Kanda Tokyo Japan"],
    [/渋谷|澀谷|Shibuya/i, "Shibuya Tokyo Japan"],
    [/代官山|Daikanyama/i, "Daikanyama Tokyo Japan"],
    [/下北沢|Shimokitazawa/i, "Shimokitazawa Tokyo Japan"],
    [/日本橋|Nihonbashi/i, "Nihonbashi Tokyo Japan"],
    [/蔵前|藏前|Kuramae/i, "Kuramae Tokyo Japan"],
    [/青山|Aoyama/i, "Aoyama Tokyo Japan"],
    [/沖繩|那霸|Naha|Okinawa/i, "Naha Okinawa Japan"],
    [/京都|Kyoto/i, "Kyoto Japan"],
    [/鎌倉|Kamakura/i, "Kamakura Japan"],
    [/富士|河口湖|下吉田|Yamanashi|山中湖/i, "Yamanashi Japan"],
    [/草津|高崎|Gunma/i, "Gunma Japan"],
    [/横浜|橫濱|Yokohama/i, "Yokohama Japan"],
    [/東京|Tokyo/i, "Tokyo Japan"],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || "Japan";
}

function buildQuerySearchUrl(place) {
  const name = cleanNameForSearch(place.name);
  const address = cleanText(place.address);
  const region = inferRegion(place);
  const query = [name, address, region].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function buildSearchUrl(place) {
  const mapUrl = cleanText(place.mapUrl);
  if (mapUrl && !mapUrl.includes("google.com/maps/search")) return mapUrl;
  return buildQuerySearchUrl(place);
}

function displayNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const match = decodeURIComponent(parsed.pathname).match(/\/maps\/place\/([^/]+)/);
    if (!match) return "";
    return cleanText(match[1].replace(/\+/g, " "));
  } catch {
    return "";
  }
}

function sourceKeysForPlace(place) {
  return Array.isArray(place.sourceKeys) && place.sourceKeys.length ? place.sourceKeys : [place.id];
}

function placeMatchesChannel(place, channel) {
  if (!channel) return true;
  const lowered = channel.toLocaleLowerCase("zh-Hant");
  return (place.mentions || []).some((mention) =>
    [mention.channelId, mention.channelName].some((value) =>
      cleanText(value).toLocaleLowerCase("zh-Hant").includes(lowered),
    ),
  );
}

function buildCandidatePlacesData() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minagogo-web-places-"));
  const candidateFile = path.join(tempDir, "places.json");
  const result = spawnSync(process.execPath, [
    "scripts/build-places-data.mjs",
    "--include-unlocated",
    `--output=${candidateFile}`,
  ], {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("Failed to build candidate places data.");
  return readJson(candidateFile, { places: [] });
}

async function waitForChrome(port) {
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(endpoint);
      if (response.ok) return response.json();
    } catch {
      // Chrome is still starting.
    }
    await sleep(250);
  }
  throw new Error("Chrome remote debugging endpoint did not start.");
}

async function createPage(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: "PUT",
  });
  if (!response.ok) throw new Error(`Unable to create Chrome page: ${response.status}`);
  return response.json();
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method) this.events.push(message);
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async close() {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.close();
  }
}

async function launchChrome(port) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "minagogo-chrome-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  chrome.stderr.on("data", () => {});
  await waitForChrome(port);
  return { chrome, profileDir };
}

async function inspectCurrentPage(cdp) {
  const result = await cdp.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const links = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'))
        .map((anchor) => ({
          href: anchor.href,
          text: clean(anchor.getAttribute('aria-label') || anchor.textContent || ''),
        }))
        .filter((link, index, arr) =>
          link.href && arr.findIndex((item) => item.href === link.href) === index,
        )
        .slice(0, 8);
      return {
        href: location.href,
        title: clean(document.title),
        heading: clean(document.querySelector('h1')?.textContent || ''),
        links,
        bodyText: clean(document.body?.innerText || '').slice(0, 500),
      };
    })()`,
  });
  return result.result?.value || {};
}

async function resolvePlace(cdp, place, args) {
  const coordinateLocation = parseLocationFromUrl(`${place.name} ${place.searchQuery}`);
  if (coordinateLocation) {
    return {
      status: "ok",
      source: "manual_coordinates",
      url: buildQuerySearchUrl(place),
      finalUrl: `https://www.google.com/maps/search/?api=1&query=${coordinateLocation.lat},${coordinateLocation.lng}`,
      displayName: cleanNameForSearch(place.name) || place.name,
      location: coordinateLocation,
    };
  }

  async function inspectUrl(url) {
    await cdp.send("Page.navigate", { url });
    await sleep(args.delayMs);
    let page = await inspectCurrentPage(cdp);
    let finalUrl = page.href || url;
    let location = finalUrl.includes("/maps/place/") ? parseLocationFromUrl(finalUrl) : null;
    let displayName = page.heading || displayNameFromUrl(finalUrl);

    if (!location && page.links?.length) {
      const firstPlaceUrl = page.links[0].href;
      const firstPlaceText = page.links[0].text;
      await cdp.send("Page.navigate", { url: firstPlaceUrl });
      await sleep(Math.max(1200, Math.floor(args.delayMs * 0.7)));
      page = await inspectCurrentPage(cdp);
      finalUrl = page.href || firstPlaceUrl;
      location = parseLocationFromUrl(finalUrl) || parseLocationFromUrl(firstPlaceUrl);
      displayName = page.heading || firstPlaceText || displayNameFromUrl(finalUrl);
    }

    if (!location && finalUrl.includes("/maps/place/")) {
      location = parseLocationFromUrl(finalUrl);
    }

    return { url, finalUrl, location, displayName, page };
  }

  const url = buildSearchUrl(place);
  let result = await inspectUrl(url);
  const fallbackUrl = buildQuerySearchUrl(place);
  if (!result.location && fallbackUrl !== url) {
    result = await inspectUrl(fallbackUrl);
  }

  if (!result.location) {
    return {
      status: "no_coordinates",
      source: "google_maps_web_search",
      url: result.url,
      finalUrl: result.finalUrl,
      message: result.page.title || result.page.bodyText || "No Google Maps place coordinates found.",
    };
  }

  return {
    status: "ok",
    source: "google_maps_web_search",
    url: result.url,
    finalUrl: result.finalUrl,
    displayName: cleanText(result.displayName) || displayNameFromUrl(result.finalUrl) || place.name,
    location: result.location,
  };
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
  const placesData = buildCandidatePlacesData();
  const cache = readJson(cacheFile, { generatedAt: "", records: {} });
  const records = cache.records || {};
  const candidates = placesData.places.filter((place) => {
    if (place.location && !args.force) return false;
    if (!placeMatchesChannel(place, args.channel)) return false;
    if (!args.force && sourceKeysForPlace(place).some((key) =>
      records[key]?.status === "ok" || records[key]?.status === "rejected_mismatch",
    )) {
      return false;
    }
    return true;
  });
  const limited = candidates.slice(0, args.limit);

  console.log(`Resolving ${limited.length} of ${candidates.length} places using Google Maps web.`);
  if (args.dryRun) {
    for (const place of limited) console.log(`[dry-run] ${place.name}: ${buildSearchUrl(place)}`);
    return;
  }

  const { chrome, profileDir } = await launchChrome(args.port);
  let cdp = null;
  let resolved = 0;
  let failed = 0;
  try {
    const pageTarget = await createPage(args.port);
    cdp = new CdpClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    for (const place of limited) {
      try {
        const result = await resolvePlace(cdp, place, args);
        cacheResultForPlace(records, place, result);
        if (result.status === "ok") {
          resolved += 1;
          console.log(`ok: ${place.name} -> ${result.displayName}`);
        } else {
          failed += 1;
          console.log(`${result.status}: ${place.name}`);
        }
      } catch (error) {
        failed += 1;
        cacheResultForPlace(records, place, {
          status: "error",
          source: "google_maps_web_search",
          url: buildSearchUrl(place),
          message: error instanceof Error ? error.message : String(error),
        });
        console.error(`error: ${place.name}: ${error instanceof Error ? error.message : error}`);
      }

      if ((resolved + failed) % 20 === 0) {
        writeJson(cacheFile, {
          generatedAt: new Date().toISOString(),
          records,
        });
      }
    }
  } finally {
    writeJson(cacheFile, {
      generatedAt: new Date().toISOString(),
      records,
    });
    await cdp?.close();
    chrome.kill("SIGTERM");
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
    } catch {
      // Chrome may still be releasing cache files; the OS temp cleaner can remove them later.
    }
  }

  if (args.rebuild) {
    const rebuild = spawnSync(process.execPath, ["scripts/build-places-data.mjs"], {
      cwd: rootDir,
      stdio: "inherit",
    });
    if (rebuild.status !== 0) throw new Error("Cache was written, but rebuilding failed.");
  }

  console.log(`Web resolve complete: ${resolved} resolved, ${failed} unresolved.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
