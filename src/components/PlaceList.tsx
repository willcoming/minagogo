import { MapPin } from "lucide-react";
import { uniqueMentionChannels } from "../data";
import type { GroupMode, Place } from "../types";

type PlaceListProps = {
  places: Place[];
  hasBounds: boolean;
  mode: GroupMode;
  selectedChannels: Set<string>;
  selectedCategories: Set<string>;
  selectedPlaceId: string | null;
  onSelectPlace: (placeId: string) => void;
};

type GroupedPlaces = {
  key: string;
  label: string;
  places: Place[];
};

function groupPlaces(
  places: Place[],
  mode: GroupMode,
  selectedChannels: Set<string>,
  selectedCategories: Set<string>,
): GroupedPlaces[] {
  const groups = new Map<string, GroupedPlaces>();

  for (const place of places) {
    if (mode === "category") {
      if (!selectedCategories.has(place.category.key)) continue;
      const key = place.category.key;
      if (!groups.has(key)) groups.set(key, { key, label: place.category.label, places: [] });
      groups.get(key)!.places.push(place);
      continue;
    }

    const channelEntries = new Map<string, string>();
    for (const mention of place.mentions) {
      if (selectedChannels.has(mention.channelId)) {
        channelEntries.set(mention.channelId, mention.channelName);
      }
    }
    for (const [key, label] of channelEntries) {
      if (!groups.has(key)) groups.set(key, { key, label, places: [] });
      groups.get(key)!.places.push(place);
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.places.length - a.places.length);
}

export function PlaceList({
  places,
  hasBounds,
  mode,
  selectedChannels,
  selectedCategories,
  selectedPlaceId,
  onSelectPlace,
}: PlaceListProps) {
  const groups = groupPlaces(places, mode, selectedChannels, selectedCategories);

  return (
    <section
      className="place-list-region"
      aria-label={hasBounds ? "目前範圍內的地點" : "全部地點"}
    >
      <div className="section-heading sticky-heading">
        <MapPin size={16} />
        <h2>{hasBounds ? "目前範圍" : "全部清單"}</h2>
        <span>{places.length.toLocaleString("zh-TW")}</span>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">
          <strong>目前沒有符合條件的地點</strong>
          <span>調整地圖範圍或重新勾選分類。</span>
        </div>
      ) : (
        <div className="place-groups">
          {groups.map((group) => (
            <section key={group.key} className="place-group">
              <h3>
                <span>{group.label}</span>
                <small>{group.places.length}</small>
              </h3>
              <div className="place-rows">
                {group.places.map((place) => (
                  <button
                    type="button"
                    key={`${group.key}-${place.id}`}
                    className={`place-row ${selectedPlaceId === place.id ? "selected" : ""}`}
                    onClick={() => onSelectPlace(place.id)}
                  >
                    <span className="place-row-main">
                      <span className="place-name">{place.name}</span>
                      <span className="place-meta">{uniqueMentionChannels(place)}</span>
                    </span>
                    <span className="place-row-side">
                      <span className="category-pill">{place.category.label}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
