import { useEffect, useMemo, useRef, useState } from "react";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { AlertTriangle, KeyRound, LocateFixed } from "lucide-react";
import {
  getDirectionsUrl,
  getPlaceMapsUrl,
  uniqueMentionChannels,
} from "../data";
import { hasGoogleMapsKey, loadGoogleMaps } from "../googleMaps";
import type { BoundsLiteral, Place } from "../types";

type MapViewProps = {
  apiKey: string | undefined;
  places: Place[];
  selectedPlaceId: string | null;
  onBoundsChange: (bounds: BoundsLiteral | null) => void;
  onSelectPlace: (placeId: string) => void;
  onClearSelection: () => void;
};

function boundsToLiteral(bounds: google.maps.LatLngBounds): BoundsLiteral {
  const northEast = bounds.getNorthEast();
  const southWest = bounds.getSouthWest();
  return {
    north: northEast.lat(),
    east: northEast.lng(),
    south: southWest.lat(),
    west: southWest.lng(),
  };
}

function createPinIcon(isSelected: boolean): google.maps.Icon {
  const width = isSelected ? 38 : 30;
  const height = isSelected ? 48 : 38;
  const fill = isSelected ? "#f59e0b" : "#0e7c66";
  const stroke = isSelected ? "#7c4a03" : "#075f4e";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 32 44">
      <path d="M16 1.5C8 1.5 1.5 8 1.5 16c0 10.9 14.5 26.5 14.5 26.5S30.5 26.9 30.5 16C30.5 8 24 1.5 16 1.5Z" fill="${fill}" stroke="${stroke}" stroke-width="3"/>
      <circle cx="16" cy="16" r="6.5" fill="#ffffff"/>
      ${isSelected ? '<circle cx="16" cy="16" r="3.2" fill="#7c4a03"/>' : ""}
    </svg>
  `;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(width, height),
    anchor: new google.maps.Point(width / 2, height),
  };
}

function createUserLocationIcon(): google.maps.Icon {
  const size = 26;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 26 26">
      <circle cx="13" cy="13" r="10" fill="#2563eb" fill-opacity="0.22"/>
      <circle cx="13" cy="13" r="6.5" fill="#2563eb" stroke="#ffffff" stroke-width="3"/>
    </svg>
  `;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2),
  };
}

function locationErrorMessage(error: { code: number }): string {
  if (error.code === 1) return "瀏覽器未允許位置權限";
  if (error.code === 2) return "目前無法取得位置";
  if (error.code === 3) return "定位逾時，請再試一次";
  return "定位失敗，請再試一次";
}

function reviewsUrl(place: Place): string {
  return place.google?.googleMapsLinks?.reviewsUri || getPlaceMapsUrl(place);
}

function createInfoWindowLink(href: string, label: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

function createPlaceInfoWindowContent(place: Place): HTMLElement {
  const container = document.createElement("div");
  container.className = "place-info-window";

  const category = document.createElement("p");
  category.className = "place-info-category";
  category.textContent = place.category.label;

  const title = document.createElement("h2");
  title.className = "place-info-title";
  title.textContent = place.name;

  const channel = document.createElement("p");
  channel.className = "place-info-meta";
  channel.textContent = `頻道：${uniqueMentionChannels(place)}`;

  const actions = document.createElement("div");
  actions.className = "place-info-actions";
  actions.append(
    createInfoWindowLink(getPlaceMapsUrl(place), "Google Maps"),
    createInfoWindowLink(getDirectionsUrl(place), "路線"),
    createInfoWindowLink(reviewsUrl(place), "評論"),
  );

  container.append(category, title, channel, actions);
  return container;
}

export function MapView({
  apiKey,
  places,
  selectedPlaceId,
  onBoundsChange,
  onSelectPlace,
  onClearSelection,
}: MapViewProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clusterRef = useRef<MarkerClusterer | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const markerByIdRef = useRef<Map<string, google.maps.Marker>>(new globalThis.Map());
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const infoWindowCloseListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const userAccuracyRef = useRef<google.maps.Circle | null>(null);
  const fittedRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [locationState, setLocationState] = useState<
    "idle" | "locating" | "ready" | "error"
  >("idle");
  const [locationMessage, setLocationMessage] = useState<string | null>(null);

  const placeById = useMemo(() => {
    return new globalThis.Map(places.map((place) => [place.id, place]));
  }, [places]);

  useEffect(() => {
    if (!hasGoogleMapsKey(apiKey) || !mapElementRef.current || mapRef.current) return;
    let disposed = false;
    loadGoogleMaps(apiKey)
      .then(() => {
        if (disposed || !mapElementRef.current) return;
        const map = new google.maps.Map(mapElementRef.current, {
          center: { lat: 36.2048, lng: 138.2529 },
          zoom: 5,
          mapTypeControl: false,
          fullscreenControl: true,
          streetViewControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        mapRef.current = map;
        setMapReady(true);
        map.addListener("idle", () => {
          if (!fittedRef.current) return;
          const bounds = map.getBounds();
          onBoundsChange(bounds ? boundsToLiteral(bounds) : null);
        });
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      disposed = true;
      infoWindowCloseListenerRef.current?.remove();
      infoWindowRef.current?.close();
      userMarkerRef.current?.setMap(null);
      userAccuracyRef.current?.setMap(null);
    };
  }, [apiKey, onBoundsChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    clusterRef.current?.clearMarkers();

    const markerById = new globalThis.Map<string, google.maps.Marker>();
    const clusteredMarkers: google.maps.Marker[] = [];
    const allMarkers: google.maps.Marker[] = [];

    places
      .filter((place) => place.location)
      .forEach((place) => {
        const isSelected = place.id === selectedPlaceId;
        const marker = new google.maps.Marker({
          icon: createPinIcon(isSelected),
          position: place.location!,
          title: place.name,
          zIndex: isSelected ? 1000 : 1,
        });
        marker.addListener("click", () => onSelectPlace(place.id));
        markerById.set(place.id, marker);
        allMarkers.push(marker);
        if (isSelected) {
          marker.setMap(map);
        } else {
          clusteredMarkers.push(marker);
        }
      });

    markersRef.current = allMarkers;
    markerByIdRef.current = markerById;
    clusterRef.current = new MarkerClusterer({ map, markers: clusteredMarkers });

    if (!fittedRef.current && allMarkers.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      allMarkers.forEach((marker) => {
        const position = marker.getPosition();
        if (position) bounds.extend(position);
      });
      map.fitBounds(bounds, 48);
      fittedRef.current = true;
    }
  }, [mapReady, onSelectPlace, places, selectedPlaceId]);

  useEffect(() => {
    const selected = selectedPlaceId ? placeById.get(selectedPlaceId) : null;
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!selected?.location) {
      infoWindowRef.current?.close();
      return;
    }

    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow({
        maxWidth: 320,
        pixelOffset: new google.maps.Size(0, -6),
      });
    }

    const infoWindow = infoWindowRef.current;
    infoWindowCloseListenerRef.current?.remove();
    infoWindow.setContent(createPlaceInfoWindowContent(selected));

    const selectedMarker = markerByIdRef.current.get(selected.id);
    if (selectedMarker) {
      infoWindow.open({ map, anchor: selectedMarker });
    } else {
      infoWindow.setPosition(selected.location);
      infoWindow.open({ map });
    }

    infoWindowCloseListenerRef.current = infoWindow.addListener(
      "closeclick",
      onClearSelection,
    );

    map.panTo(selected.location);
    if ((map.getZoom() || 0) < 14) {
      map.setZoom(14);
    }

    return () => {
      infoWindowCloseListenerRef.current?.remove();
      infoWindowCloseListenerRef.current = null;
    };
  }, [mapReady, onClearSelection, placeById, selectedPlaceId]);

  const handleLocateUser = () => {
    const map = mapRef.current;
    if (!map || locationState === "locating") return;

    if (!navigator.geolocation) {
      setLocationState("error");
      setLocationMessage("這個瀏覽器不支援定位");
      return;
    }

    setLocationState("locating");
    setLocationMessage("正在取得你的目前位置...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        if (userMarkerRef.current) {
          userMarkerRef.current.setPosition(location);
          userMarkerRef.current.setMap(map);
        } else {
          userMarkerRef.current = new google.maps.Marker({
            icon: createUserLocationIcon(),
            map,
            position: location,
            title: "現在位置",
            zIndex: 2000,
          });
        }

        const accuracy = Math.max(position.coords.accuracy || 0, 20);
        if (userAccuracyRef.current) {
          userAccuracyRef.current.setCenter(location);
          userAccuracyRef.current.setRadius(accuracy);
          userAccuracyRef.current.setMap(map);
        } else {
          userAccuracyRef.current = new google.maps.Circle({
            center: location,
            radius: accuracy,
            map,
            strokeColor: "#2563eb",
            strokeOpacity: 0.55,
            strokeWeight: 1,
            fillColor: "#2563eb",
            fillOpacity: 0.12,
          });
        }

        map.panTo(location);
        if ((map.getZoom() || 0) < 15) {
          map.setZoom(15);
        }
        setLocationState("ready");
        setLocationMessage("已加入現在位置");
      },
      (error) => {
        setLocationState("error");
        setLocationMessage(locationErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 10_000,
      },
    );
  };

  if (!hasGoogleMapsKey(apiKey)) {
    return (
      <section className="map-fallback" aria-label="Google Maps 尚未啟用">
        <div className="map-fallback-panel">
          <KeyRound size={28} />
          <h2>需要 Google Maps API key</h2>
          <p>
            設定 <code>VITE_GOOGLE_MAPS_API_KEY</code> 後重新啟動 dev server，
            右側會載入 Google Maps 與 marker。
          </p>
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="map-fallback" aria-label="Google Maps 載入失敗">
        <div className="map-fallback-panel error-panel">
          <AlertTriangle size={28} />
          <h2>Google Maps 載入失敗</h2>
          <p>{loadError}</p>
        </div>
      </section>
    );
  }

  const locationButtonLabel = locationState === "locating" ? "定位中" : "現在位置";
  const locationButtonActionLabel =
    locationState === "ready" ? "更新現在位置" : "顯示現在位置";

  return (
    <section className="map-region" aria-label="地圖">
      <div ref={mapElementRef} className="map-canvas" />
      {!mapReady ? <div className="map-loading-note">正在載入 Google Maps...</div> : null}
      <div className="map-location-control">
        <button
          type="button"
          className={`map-location-button ${locationState === "ready" ? "ready" : ""}`}
          onClick={handleLocateUser}
          disabled={!mapReady || locationState === "locating"}
          aria-live="polite"
          aria-label={locationButtonActionLabel}
          title={locationButtonActionLabel}
        >
          <LocateFixed size={16} />
          <span>{locationButtonLabel}</span>
        </button>
        {locationMessage ? (
          <div
            className={`map-location-message ${
              locationState === "error" ? "error" : ""
            }`}
          >
            {locationMessage}
          </div>
        ) : null}
      </div>
    </section>
  );
}
