export type GroupMode = "channel" | "category";

export type LatLng = {
  lat: number;
  lng: number;
};

export type BoundsLiteral = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type Channel = {
  id: string;
  name: string;
  url: string;
  mentions: number;
};

export type PlaceMention = {
  id: string;
  sourceKey: string;
  channelId: string;
  channelName: string;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  published: string;
  views: string;
  time: string;
  seconds: number | null;
  mapUrl: string;
  sourceReview: string;
  youtubeReview: string;
};

export type PlaceCategory = {
  key: string;
  label: string;
  source: "google" | "heuristic";
};

export type GooglePlaceLinks = {
  directionsUri?: string;
  placeUri?: string;
  reviewsUri?: string;
  photosUri?: string;
  writeAReviewUri?: string;
};

export type GooglePlaceData = {
  placeId: string;
  displayName: string;
  formattedAddress: string;
  primaryType: string;
  primaryTypeDisplayName?: { text?: string } | null;
  types: string[];
  googleMapsUri: string;
  googleMapsLinks: GooglePlaceLinks;
  fetchedAt: string;
};

export type Place = {
  id: string;
  name: string;
  normalizedName: string;
  address: string;
  mapUrl: string;
  searchQuery: string;
  sourceKeys: string[];
  location: LatLng | null;
  google: GooglePlaceData | null;
  category: PlaceCategory;
  mentions: PlaceMention[];
};

export type PlacesData = {
  generatedAt: string;
  sourceFiles: string[];
  stats: {
    rawMentions: number;
    places: number;
    locatedPlaces: number;
    unresolvedPlaces: number;
    channels: number;
  };
  channels: Channel[];
  places: Place[];
};
