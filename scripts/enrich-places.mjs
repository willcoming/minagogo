import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const cacheFile = path.join(__dirname, "data", "google-place-cache.json");

const placesTextSearchEndpoint = "https://places.googleapis.com/v1/places:searchText";
const geocodingEndpoint = "https://maps.googleapis.com/maps/api/geocode/json";
const fieldMask = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.googleMapsUri",
  "places.googleMapsLinks",
].join(",");

function parseArgs(argv) {
  const args = {
    limit: 100,
    force: false,
    dryRun: false,
    allowApi: false,
    retryMissing: false,
    rebuild: true,
    delayMs: 120,
    provider: "both",
    channel: "",
  };
  for (const arg of argv) {
    if (arg === "--force") args.force = true;
    if (arg === "--dry-run") args.dryRun = true;
    if (arg === "--allow-api") args.allowApi = true;
    if (arg === "--retry-missing") args.retryMissing = true;
    if (arg === "--no-rebuild") args.rebuild = false;
    if (arg.startsWith("--limit=")) {
      const value = arg.split("=")[1];
      args.limit = value === "all" ? Infinity : Number(value);
    }
    if (arg.startsWith("--delay-ms=")) args.delayMs = Number(arg.split("=")[1]);
    if (arg.startsWith("--provider=")) args.provider = arg.split("=")[1];
    if (arg.startsWith("--channel=")) args.channel = arg.split("=").slice(1).join("=");
  }
  return args;
}

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function loadLocalEnv() {
  loadDotEnvFile(path.join(rootDir, ".env"));
  loadDotEnvFile(path.join(rootDir, ".env.local"));
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

function buildCandidatePlacesData() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "minagogo-places-"));
  const candidateFile = path.join(tempDir, "places.json");
  const result = spawnSync(process.execPath, [
    "scripts/build-places-data.mjs",
    "--include-unlocated",
    `--output=${candidateFile}`,
  ], {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Failed to build candidate places data.");
  }
  return readJson(candidateFile, { places: [] });
}

function sourceKeysForPlace(place) {
  return Array.isArray(place.sourceKeys) && place.sourceKeys.length
    ? place.sourceKeys
    : [place.id];
}

function displayNameText(place) {
  if (!place?.displayName) return "";
  return typeof place.displayName === "string"
    ? place.displayName
    : place.displayName.text || "";
}

function primaryTypeDisplayName(place) {
  if (!place?.primaryTypeDisplayName) return null;
  if (typeof place.primaryTypeDisplayName === "string") {
    return { text: place.primaryTypeDisplayName };
  }
  return place.primaryTypeDisplayName;
}

function placeLocation(place) {
  const location = place?.location || null;
  if (!location) return null;
  const lat = Number(location.latitude ?? location.lat);
  const lng = Number(location.longitude ?? location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function inferRegionCode(place) {
  const addressText = [
    place.address,
  ].join(" ");
  if (/法國|巴黎|France|Paris|Versailles/i.test(addressText)) return "FR";
  if (/英國|倫敦|London|United Kingdom|\bUK\b|U\.K\.|Big Ben|British Museum/i.test(addressText)) return "GB";
  if (/荷蘭|阿姆斯特丹|Netherlands|Amsterdam/i.test(addressText)) return "NL";
  if (/比利時|布魯塞爾|Belgium|Brussels/i.test(addressText)) return "BE";
  if (/杜拜|Dubai|UAE|United Arab Emirates/i.test(addressText)) return "AE";
  if (/韓國|首爾|釜山|Korea|Seoul|Busan|naver/i.test(addressText)) return "KR";
  if (
    /日本|Japan|〒|Tokyo|Osaka|Kyoto|東京|大阪|京都|沖繩|沖縄|Okinawa|北海道|Hokkaido|札幌|Sapporo|新潟|Niigata|名古屋|Nagoya|福岡|Fukuoka|神戶|神戸|Kobe|橫濱|横浜|Yokohama|鎌倉|Kamakura|奈良|Nara|金澤|金沢|Kanazawa|長崎|Nagasaki|青森|Aomori|仙台|Sendai|廣島|広島|Hiroshima|熊本|Kumamoto|鹿兒島|鹿児島|Kagoshima/i.test(
      addressText,
    )
  ) {
    return "JP";
  }
  if (
    /台灣|臺灣|Taiwan|台北|臺北|Taipei|新北|桃園|基隆|新竹|苗栗|台中|臺中|Taichung|彰化|南投|日月潭|雲林|嘉義|台南|臺南|Tainan|高雄|Kaohsiung|屏東|宜蘭|花蓮|台東|臺東|澎湖|阿里山|三重|士林|淡水|板橋|萬華|万華|永和|中永和|天母|大同區|林口|新店|全台|環台/i.test(
      addressText,
    )
  ) {
    return "TW";
  }
  if (/香港|Hong Kong/i.test(addressText)) return "HK";

  const nameText = String(place.name || "");
  if (/哈利波特|Harry Potter|Big Ben|大笨鐘|西敏寺|威斯敏斯特|倫敦塔|倫敦|London/i.test(nameText)) {
    return "GB";
  }
  if (
    /[\u3040-\u30ff]|東京|大阪|京都|沖繩|沖縄|北海道|札幌|新潟|名古屋|福岡|神戶|神戸|橫濱|横浜|鎌倉|奈良|金澤|金沢|長崎|青森|仙台|廣島|広島|熊本|鹿兒島|鹿児島|池袋|新宿|渋谷|澀谷|銀座|上野|飯田橋|浅草|吉祥寺|下北沢|中目黑|中目黒|六本木|原宿|丸の内|丸之內/i.test(
      nameText,
    )
  ) {
    return "JP";
  }
  if (
    /台灣|臺灣|Taiwan|台北|臺北|Taipei|新北|桃園|基隆|新竹|苗栗|台中|臺中|Taichung|彰化|南投|日月潭|雲林|嘉義|台南|臺南|Tainan|高雄|Kaohsiung|屏東|宜蘭|花蓮|台東|臺東|澎湖|阿里山|三重|士林|淡水|板橋|萬華|万華|永和|中永和|天母|大同區|林口|新店|全台|環台/i.test(
      nameText,
    )
  ) {
    return "TW";
  }

  const text = [
    place.name,
    place.address,
    ...place.mentions.map((mention) => `${mention.videoTitle} ${mention.youtubeReview}`),
  ].join(" ");
  if (/巴黎|France|Paris|Versailles/i.test(text)) return "FR";
  if (/英國|倫敦|London|United Kingdom|\bUK\b|U\.K\.|Big Ben|British Museum/i.test(text)) return "GB";
  if (/荷蘭|阿姆斯特丹|Netherlands|Amsterdam/i.test(text)) return "NL";
  if (/比利時|布魯塞爾|Belgium|Brussels/i.test(text)) return "BE";
  if (/杜拜|Dubai|UAE|United Arab Emirates/i.test(text)) return "AE";
  if (/韓國|首爾|釜山|Korea|Seoul|Busan|naver/i.test(text)) return "KR";
  if (
    /日本|Japan|東京|Tokyo|大阪|Osaka|京都|Kyoto|沖繩|沖縄|Okinawa|北海道|Hokkaido|札幌|Sapporo|新潟|Niigata|名古屋|Nagoya|福岡|Fukuoka|神戶|神戸|Kobe|橫濱|横浜|Yokohama|鎌倉|Kamakura|奈良|Nara|金澤|金沢|Kanazawa|長崎|Nagasaki|青森|Aomori|仙台|Sendai|廣島|広島|Hiroshima|熊本|Kumamoto|鹿兒島|鹿児島|Kagoshima/i.test(
      text,
    )
  ) {
    return "JP";
  }
  if (
    /台灣|臺灣|Taiwan|台北|臺北|Taipei|新北|桃園|基隆|新竹|苗栗|台中|臺中|Taichung|彰化|南投|日月潭|雲林|嘉義|台南|臺南|Tainan|高雄|Kaohsiung|屏東|宜蘭|花蓮|台東|臺東|澎湖|阿里山|三重|士林|淡水|板橋|萬華|万華|永和|中永和|天母|大同區|林口|新店|全台|環台/i.test(
      text,
    )
  ) {
    return "TW";
  }
  if (/香港|Hong Kong/i.test(text)) return "HK";
  return "JP";
}

function cleanQueryPart(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function regionSearchTerm(regionCode) {
  switch (regionCode) {
    case "FR":
      return "France";
    case "GB":
      return "United Kingdom";
    case "NL":
      return "Netherlands";
    case "BE":
      return "Belgium";
    case "AE":
      return "United Arab Emirates";
    case "KR":
      return "Korea";
    case "TW":
      return "Taiwan";
    case "HK":
      return "Hong Kong";
    case "JP":
    default:
      return "Japan";
  }
}

function queryForPlace(place) {
  const name = cleanQueryPart(place.name);
  const address = cleanQueryPart(place.address);
  const searchQuery = cleanQueryPart(place.searchQuery);
  if (name && address) return `${name} ${address}`;
  if (searchQuery && searchQuery.length <= 180) return searchQuery;
  if (name) return `${name} ${regionSearchTerm(inferRegionCode(place))}`;
  return searchQuery;
}

function isLowQualityName(name) {
  const text = cleanQueryPart(name);
  if (!text) return true;
  if (/^\d+(?:\.\d+)?折/.test(text) || /^[¥$₩]\s?\d/.test(text)) return true;
  if (/\$|NT\$|₩\s?\d/.test(text)) return true;
  if (text.length > 30 && /[，。！？,]|只要|如果|希望|安排|分享|景點踩點|有沒有|慢慢/.test(text)) {
    return true;
  }
  return /片尾|出門散步|外出採買|必備單品|今天我請假|下午茶點心|牛排丼飯晚餐|油封鴨午餐|冬天泡湯|夏天避暑|泡湯.*散策|日本最大級|正規代購平台|水の京都|海の京都|行前準備|買單日卷|按讚|訂閱|最大動力|希望下支影片|一定要去到哪一個景點|國際通夜晚|周圍街景|拍攝日|街頭櫻花|隱藏景點|美食藝術新景點|質感好店|好店\\d+選|東北PASS|東京各種地標|東東京$|大陸$|有沒有一個地方|一日遊|喜歡上|最後一Cut|快速急行|跟客戶見面開會|意麵的由來|蜂炮注意事項|購物分享|購買方式分享|DIY手作課程|FASBEE介紹|Making Onsen egg|營火晚會|Open場勘日|取票位置|預約指定席|超市購物|賞櫻午餐|黑糖珍珠鮮奶茶PK|貓咪踏踏晚安|櫻花季限定戶外店|櫻花餅乾下午茶|蒲燒鰻魚飯兩吃|草仔粿與甜甜圈|冰淇淋三明治|胡桃焙茶冰淇淋|蚵仔粥|深川飯|盛岡冷面|最中|高速巴士訂票網站|唯一授權|臺灣總代理|台灣總代理|專屬折扣碼|帳篷介紹|從車站搜尋|掛繩夾片|推薦時間|第三代海芙音波|納豆烏龍麵|冷拌豬肉片|沖繩炒苦瓜|長崎強棒麵|長崎ちゃんぽん|星巴克櫻花|ピスタチオクリーム|シナモンロール|たまごのハニートースト|レモンパイ|お洒落|おうち|プレビュー|^Cafe$|^カフェ$|^購買$|^Reservation$|^梯子$|^刀削麵$|^外帶$|^內用$|^Recipe:?$/i.test(
    text,
  );
}

function shouldSkipPlace(place) {
  const query = queryForPlace(place);
  if (!query || query.length < 2) {
    return { skip: true, reason: "empty_query" };
  }
  if (isLowQualityName(place.name)) {
    return { skip: true, reason: "low_quality_name" };
  }
  return { skip: false, reason: "" };
}

function isOverBroadResult(result) {
  const text = [
    result.displayName,
    result.formattedAddress,
  ].join(" ");
  return /^(日本|日本東京都|東京都|Japan|Tokyo|大阪|Osaka|京都|Kyoto|서울|Seoul|韓國|Korea|台灣|臺灣|Taiwan|台北|Taipei|香港|Hong Kong|英國|United Kingdom|\bUK\b|U\.K\.|Great Britain|倫敦|London|法國|France|巴黎|Paris|荷蘭|Netherlands|阿姆斯特丹|Amsterdam|比利時|Belgium|布魯塞爾|Brussels|杜拜|Dubai)$/.test(
    cleanQueryPart(result.displayName),
  ) || /^(日本|Japan|東京都|Tokyo)$/i.test(cleanQueryPart(text));
}

function resultCountryCode(result) {
  const text = cleanQueryPart([
    result.displayName,
    result.formattedAddress,
  ].join(" "));
  const matches = [
    ["TW", /台灣|臺灣|Taiwan|台北|臺北|新北|桃園|台中|臺中|台南|臺南|高雄/],
    ["JP", /日本|Japan|〒|Tokyo|Osaka|Kyoto|東京都|大阪|京都府|沖縄|北海道/],
    ["HK", /香港|Hong Kong/],
    ["KR", /韓國|首爾|釜山|Korea|Seoul|Busan/],
    ["GB", /英國|United Kingdom|London|倫敦/],
    ["FR", /法國|France|Paris|巴黎/],
    ["NL", /荷蘭|Netherlands|Amsterdam|阿姆斯特丹/],
    ["BE", /比利時|Belgium|Brussels|布魯塞爾/],
    ["AE", /阿拉伯聯合大公國|United Arab Emirates|Dubai|杜拜/],
  ].filter(([, pattern]) => pattern.test(text));
  return matches.length === 1 ? matches[0][0] : "";
}

function hasClearCountryMismatch(regionCode, result) {
  const code = resultCountryCode(result);
  return Boolean(code && code !== regionCode);
}

function expectedAliasesForName(name) {
  const text = cleanQueryPart(name);
  if (/艾菲爾鐵塔|巴黎鐵塔/.test(text)) return [/艾菲爾/i, /Eiffel/i];
  if (/西敏寺|威斯敏斯特/.test(text)) return [/西敏/i, /Westminster/i];
  if (/大笨鐘|Big Ben/i.test(text)) return [/大笨鐘/i, /Big Ben/i, /Elizabeth Tower/i];
  if (/中國城|中華街|Chinatown/i.test(text)) return [/中國城/i, /中華街/i, /Chinatown/i];
  if (/倫敦塔橋|Tower Bridge/i.test(text)) return [/倫敦塔橋/i, /Tower Bridge/i];
  if (/倫敦塔|Tower of London/i.test(text)) return [/倫敦塔/i, /Tower of London/i];
  if (/國王畫廊|King'?s Gallery/i.test(text)) return [/國王畫廊/i, /King'?s Gallery/i];
  if (/拿破崙之墓/.test(text)) return [/拿破崙/i, /Napoleon/i, /Invalides/i, /榮軍院/i];
  if (/泰晤士河/.test(text)) return [/泰晤士/i, /Thames/i];
  if (/桑斯安斯風車村|贊瑟斯漢斯|Zaanse/i.test(text)) return [/桑斯安斯/i, /贊瑟斯漢斯/i, /Zaanse/i];
  if (/科芬園|Covent Garden/i.test(text)) return [/科芬園/i, /Covent Garden/i];
  if (/哈利波特月台|9¾|9 3\/4/.test(text)) return [/哈利波特/i, /9¾/i, /9 3\/4/i, /Platform/i];
  if (/海軍府|Admiralty/i.test(text)) return [/海軍府/i, /Admiralty/i];
  if (/深大寺老街|深大寺|Jindaiji/i.test(text)) return [/深大寺/i, /Jindaiji/i];
  if (/那霸國際通/.test(text)) return [/國際通/i, /Kokusai/i];
  return [];
}

function failsExpectedAlias(place, result) {
  const aliases = expectedAliasesForName(place.name);
  if (!aliases.length) return false;
  const target = [
    result.displayName,
    result.formattedAddress,
    result.googleMapsUri,
  ].join(" ");
  return !aliases.some((pattern) => pattern.test(target));
}

function normalizePlaceResult(place, queryUsed, regionCode) {
  return {
    status: "ok",
    provider: "places_text_search",
    fetchedAt: new Date().toISOString(),
    queryUsed,
    regionCode,
    placeId: place.id || "",
    displayName: displayNameText(place),
    formattedAddress: place.formattedAddress || "",
    location: placeLocation(place),
    primaryType: place.primaryType || "",
    primaryTypeDisplayName: primaryTypeDisplayName(place),
    types: place.types || [],
    googleMapsUri: place.googleMapsUri || "",
    googleMapsLinks: place.googleMapsLinks || {},
  };
}

function normalizeGeocodeResult(result, queryUsed, regionCode) {
  const location = result?.geometry?.location || null;
  return {
    status: "ok",
    provider: "geocoding",
    fetchedAt: new Date().toISOString(),
    queryUsed,
    regionCode,
    placeId: result.place_id || "",
    displayName: result.formatted_address || queryUsed,
    formattedAddress: result.formatted_address || "",
    location:
      location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))
        ? { lat: Number(location.lat), lng: Number(location.lng) }
        : null,
    primaryType: result.types?.[0] || "",
    primaryTypeDisplayName: null,
    types: result.types || [],
    googleMapsUri: result.place_id
      ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(result.place_id)}&query=${encodeURIComponent(queryUsed)}`
      : "",
    googleMapsLinks: {},
  };
}

async function searchPlace(apiKey, query, regionCode) {
  const response = await fetch(placesTextSearchEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: "zh-TW",
      regionCode,
      maxResultCount: 1,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Places API ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.places?.[0] || null;
}

async function geocodePlace(apiKey, query, regionCode) {
  const url = new URL(geocodingEndpoint);
  url.searchParams.set("address", query);
  url.searchParams.set("language", "zh-TW");
  url.searchParams.set("region", regionCode.toLowerCase());
  url.searchParams.set("key", apiKey);
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Geocoding API ${response.status}: ${body}`);
  }
  const data = await response.json();
  if (data.status !== "OK") {
    return {
      status: data.status === "ZERO_RESULTS" ? "no_result" : "error",
      message: data.error_message || data.status,
    };
  }
  return data.results?.[0] || null;
}

function writeResult(records, place, result) {
  for (const key of sourceKeysForPlace(place)) {
    records[key] = result;
  }
}

function matchesFilter(value, filter) {
  if (!filter) return true;
  return cleanQueryPart(value).toLocaleLowerCase("zh-Hant").includes(
    cleanQueryPart(filter).toLocaleLowerCase("zh-Hant"),
  );
}

function placeMatchesScope(place, args) {
  if (!args.channel) return true;
  const mentions = Array.isArray(place.mentions) ? place.mentions : [];
  return mentions.some((mention) =>
    [mention.channelId, mention.channelName].some((value) =>
      matchesFilter(value, args.channel),
    ),
  );
}

async function enrichPlace(apiKey, place, args) {
  const query = queryForPlace(place);
  const regionCode = inferRegionCode(place);

  if (args.provider === "places" || args.provider === "both") {
    const result = await searchPlace(apiKey, query, regionCode);
    if (result) {
      const normalized = normalizePlaceResult(result, query, regionCode);
      if (
        isOverBroadResult(normalized) ||
        hasClearCountryMismatch(regionCode, normalized) ||
        failsExpectedAlias(place, normalized)
      ) {
        return {
          status: "skipped_low_confidence",
          provider: "places_text_search",
          fetchedAt: new Date().toISOString(),
          queryUsed: query,
          regionCode,
          message: `Low-confidence result: ${normalized.displayName}`,
        };
      }
      return normalized;
    }
  }

  if (args.provider === "geocoding" || args.provider === "both") {
    const result = await geocodePlace(apiKey, query, regionCode);
    if (result?.status) {
      return {
        status: result.status,
        provider: "geocoding",
        fetchedAt: new Date().toISOString(),
        queryUsed: query,
        regionCode,
        message: result.message || "",
      };
    }
    if (result) {
      const normalized = normalizeGeocodeResult(result, query, regionCode);
      if (
        isOverBroadResult(normalized) ||
        hasClearCountryMismatch(regionCode, normalized) ||
        failsExpectedAlias(place, normalized)
      ) {
        return {
          status: "skipped_low_confidence",
          provider: "geocoding",
          fetchedAt: new Date().toISOString(),
          queryUsed: query,
          regionCode,
          message: `Low-confidence result: ${normalized.displayName}`,
        };
      }
      return normalized;
    }
  }

  return {
    status: "no_result",
    provider: args.provider,
    fetchedAt: new Date().toISOString(),
    queryUsed: query,
    regionCode,
  };
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.allowApi) {
    throw new Error(
      "This command calls Google Maps APIs. Pass `-- --allow-api` after confirming billing, budget, and API quota limits.",
    );
  }
  if (!["places", "geocoding", "both"].includes(args.provider)) {
    throw new Error("--provider must be one of: places, geocoding, both.");
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey && !args.dryRun) {
    throw new Error("GOOGLE_MAPS_API_KEY is required. Put it in .env or .env.local.");
  }

  const placesData = buildCandidatePlacesData();
  const cache = readJson(cacheFile, { generatedAt: "", records: {} });
  const records = cache.records || {};

  const candidates = placesData.places.filter((place) => {
    if (!placeMatchesScope(place, args)) return false;
    if (place.location && !args.force) return false;
    const skip = shouldSkipPlace(place);
    if (skip.skip) return false;
    if (args.force) return true;
    return sourceKeysForPlace(place).some((key) => {
      const cached = records[key];
      if (!cached || cached.status === "error") return true;
      return args.retryMissing && ["no_result", "skipped_low_confidence"].includes(cached.status);
    });
  });
  const limited = candidates.slice(0, args.limit);

  console.log(
    `Enriching ${limited.length} of ${candidates.length} unresolved places with Google Maps API. Provider=${args.provider}.`,
  );

  let ok = 0;
  let noResult = 0;
  let failed = 0;

  for (const place of limited) {
    const skip = shouldSkipPlace(place);
    const query = queryForPlace(place);
    if (args.dryRun) {
      console.log(`[dry-run] ${place.name}: ${query}`);
      continue;
    }
    if (skip.skip) {
      writeResult(records, place, {
        status: "skipped",
        provider: args.provider,
        fetchedAt: new Date().toISOString(),
        queryUsed: query,
        message: skip.reason,
      });
      continue;
    }

    try {
      const result = await enrichPlace(apiKey, place, args);
      writeResult(records, place, result);
      if (result.status === "ok" && result.location) {
        ok += 1;
        console.log(`ok: ${place.name} -> ${result.displayName || result.formattedAddress}`);
      } else {
        noResult += 1;
        console.log(`${result.status}: ${place.name}`);
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      writeResult(records, place, {
        status: "error",
        provider: args.provider,
        fetchedAt: new Date().toISOString(),
        queryUsed: query,
        message,
      });
      console.error(`error: ${place.name}: ${message}`);
    }

    if ((ok + noResult + failed) % 20 === 0) {
      writeJson(cacheFile, {
        generatedAt: new Date().toISOString(),
        records,
      });
    }
    if (args.delayMs > 0) await sleep(args.delayMs);
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
      throw new Error("API cache was written, but rebuilding places data failed.");
    }
  }

  console.log(`API enrichment complete: ${ok} ok, ${noResult} no result/skipped, ${failed} failed.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
