import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, MapPin } from "lucide-react";
import { loadPlacesData, placeInBounds } from "./data";
import { MapView } from "./components/MapView";
import { Sidebar } from "./components/Sidebar";
import type { BoundsLiteral, GroupMode, Place, PlacesData } from "./types";

const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

function isExternalLink(href: string): boolean {
  try {
    return new URL(href, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

function enforceExternalLinkTarget(anchor: HTMLAnchorElement): void {
  if (!isExternalLink(anchor.href)) return;
  anchor.target = "_blank";
  const relValues = new Set(anchor.rel.split(/\s+/).filter(Boolean));
  relValues.add("noopener");
  relValues.add("noreferrer");
  anchor.rel = Array.from(relValues).join(" ");
}

function enforceExternalLinks(root: ParentNode): void {
  root.querySelectorAll("a[href]").forEach((anchor) => {
    if (anchor instanceof HTMLAnchorElement) {
      enforceExternalLinkTarget(anchor);
    }
  });
}

function placeMatchesMode(place: Place, mode: GroupMode, selected: Set<string>): boolean {
  if (mode === "category") return selected.has(place.category.key);
  return place.mentions.some((mention) => selected.has(mention.channelId));
}

function sortPlaces(places: Place[]): Place[] {
  return [...places].sort((a, b) => {
    const ratingDiff = (b.rating || 0) - (a.rating || 0);
    if (ratingDiff !== 0) return ratingDiff;
    const mentionDiff = b.mentions.length - a.mentions.length;
    if (mentionDiff !== 0) return mentionDiff;
    return a.name.localeCompare(b.name, "zh-Hant");
  });
}

export function App() {
  const [data, setData] = useState<PlacesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState<GroupMode>("channel");
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [bounds, setBounds] = useState<BoundsLiteral | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);

  useEffect(() => {
    enforceExternalLinks(document);

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (target instanceof HTMLAnchorElement) {
        enforceExternalLinkTarget(target);
      }
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLAnchorElement) {
            enforceExternalLinkTarget(node);
          } else if (node instanceof HTMLElement) {
            enforceExternalLinks(node);
          }
        });
      }
    });

    document.addEventListener("click", handleClick, true);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener("click", handleClick, true);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    loadPlacesData()
      .then((placesData) => {
        if (ignore) return;
        setData(placesData);
        setSelectedChannels(new Set(placesData.channels.map((channel) => channel.id)));
        setSelectedCategories(
          new Set(placesData.places.map((place) => place.category.key)),
        );
      })
      .catch((loadError: unknown) => {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const activeSelection = groupMode === "channel" ? selectedChannels : selectedCategories;

  const filteredPlaces = useMemo(() => {
    if (!data) return [];
    return data.places.filter((place) =>
      placeMatchesMode(place, groupMode, activeSelection),
    );
  }, [activeSelection, data, groupMode]);

  const visiblePlaces = useMemo(() => {
    return sortPlaces(filteredPlaces.filter((place) => placeInBounds(place, bounds)));
  }, [bounds, filteredPlaces]);

  const unlocatedPlaces = useMemo(() => {
    return sortPlaces(filteredPlaces.filter((place) => !place.location));
  }, [filteredPlaces]);

  const selectedPlace = useMemo(() => {
    if (!data || !selectedPlaceId) return null;
    return data.places.find((place) => place.id === selectedPlaceId) || null;
  }, [data, selectedPlaceId]);

  const mapPlaces = useMemo(() => filteredPlaces.filter((place) => place.location), [
    filteredPlaces,
  ]);

  if (loading) {
    return (
      <main className="loading-shell" aria-live="polite">
        <MapPin size={28} />
        <span>正在載入地圖資料...</span>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="loading-shell error-shell" role="alert">
        <AlertTriangle size={28} />
        <span>{error || "沒有可用的地點資料，請先執行 npm run build:places。"}</span>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Sidebar
        data={data}
        groupMode={groupMode}
        selectedChannels={selectedChannels}
        selectedCategories={selectedCategories}
        visiblePlaces={visiblePlaces}
        unlocatedPlaces={unlocatedPlaces}
        selectedPlace={selectedPlace}
        bounds={bounds}
        onGroupModeChange={setGroupMode}
        onSelectedChannelsChange={setSelectedChannels}
        onSelectedCategoriesChange={setSelectedCategories}
        onSelectPlace={setSelectedPlaceId}
      />
      <MapView
        apiKey={googleMapsApiKey}
        places={mapPlaces}
        selectedPlaceId={selectedPlaceId}
        onBoundsChange={setBounds}
        onSelectPlace={setSelectedPlaceId}
      />
    </main>
  );
}
