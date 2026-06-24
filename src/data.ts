import type { BoundsLiteral, Place, PlacesData } from "./types";

export async function loadPlacesData(): Promise<PlacesData> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/places.json`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`無法讀取地點資料：${response.status}`);
  }
  return response.json() as Promise<PlacesData>;
}

export function placeInBounds(place: Place, bounds: BoundsLiteral | null): boolean {
  if (!bounds) return true;
  if (!place.location) return false;
  return (
    place.location.lat <= bounds.north &&
    place.location.lat >= bounds.south &&
    place.location.lng <= bounds.east &&
    place.location.lng >= bounds.west
  );
}

export function getPlaceMapsUrl(place: Place): string {
  return (
    place.google?.googleMapsLinks?.placeUri ||
    place.google?.googleMapsUri ||
    place.mapUrl ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.searchQuery || place.name)}`
  );
}

export function getDirectionsUrl(place: Place): string {
  if (place.google?.googleMapsLinks?.directionsUri) {
    return place.google.googleMapsLinks.directionsUri;
  }
  if (place.location) {
    return `https://www.google.com/maps/dir/?api=1&destination=${place.location.lat},${place.location.lng}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    place.searchQuery || place.name,
  )}`;
}

export function uniqueMentionChannels(place: Place): string {
  const names = Array.from(new Set(place.mentions.map((mention) => mention.channelName)));
  return names.join("、");
}
