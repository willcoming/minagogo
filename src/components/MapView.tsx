import { useEffect, useMemo, useRef, useState } from "react";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { AlertTriangle, KeyRound, Map as MapIcon } from "lucide-react";
import { hasGoogleMapsKey, loadGoogleMaps } from "../googleMaps";
import type { BoundsLiteral, Place } from "../types";

type MapViewProps = {
  apiKey: string | undefined;
  places: Place[];
  selectedPlaceId: string | null;
  onBoundsChange: (bounds: BoundsLiteral | null) => void;
  onSelectPlace: (placeId: string) => void;
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

export function MapView({
  apiKey,
  places,
  selectedPlaceId,
  onBoundsChange,
  onSelectPlace,
}: MapViewProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clusterRef = useRef<MarkerClusterer | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const fittedRef = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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
          clickableIcons: true,
          gestureHandling: "greedy",
        });
        mapRef.current = map;
        map.addListener("idle", () => {
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
    };
  }, [apiKey, onBoundsChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker) => marker.setMap(null));
    clusterRef.current?.clearMarkers();

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
        allMarkers.push(marker);
        if (isSelected) {
          marker.setMap(map);
        } else {
          clusteredMarkers.push(marker);
        }
      });

    markersRef.current = allMarkers;
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
  }, [onSelectPlace, places, selectedPlaceId]);

  useEffect(() => {
    const selected = selectedPlaceId ? placeById.get(selectedPlaceId) : null;
    if (!selected?.location || !mapRef.current) return;
    mapRef.current.panTo(selected.location);
    if ((mapRef.current.getZoom() || 0) < 14) {
      mapRef.current.setZoom(14);
    }
  }, [placeById, selectedPlaceId]);

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

  return (
    <section className="map-region" aria-label="地圖">
      <div ref={mapElementRef} className="map-canvas" />
      <div className="map-status">
        <MapIcon size={16} />
        <span>{places.length.toLocaleString("zh-TW")} 個可定位地點</span>
      </div>
    </section>
  );
}
