import { Loader } from "@googlemaps/js-api-loader";

let loaderPromise: Promise<typeof google> | null = null;

export function hasGoogleMapsKey(apiKey: string | undefined): apiKey is string {
  return Boolean(apiKey && apiKey.trim().length > 0);
}

export function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (!loaderPromise) {
    const loader = new Loader({
      apiKey,
      version: "weekly",
      language: "zh-TW",
      region: "JP",
    });
    loaderPromise = loader.load();
  }
  return loaderPromise;
}
