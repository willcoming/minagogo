import { useMemo, useState } from "react";
import { ChevronDown, Filter, LocateFixed } from "lucide-react";
import type {
  BoundsLiteral,
  Channel,
  GroupMode,
  Place,
  PlacesData,
} from "../types";
import { FilterPanel } from "./FilterPanel";
import { PlaceDetails } from "./PlaceDetails";
import { PlaceList } from "./PlaceList";

type SidebarProps = {
  data: PlacesData;
  groupMode: GroupMode;
  selectedChannels: Set<string>;
  selectedCategories: Set<string>;
  visiblePlaces: Place[];
  unlocatedPlaces: Place[];
  selectedPlace: Place | null;
  bounds: BoundsLiteral | null;
  onGroupModeChange: (mode: GroupMode) => void;
  onSelectedChannelsChange: (value: Set<string>) => void;
  onSelectedCategoriesChange: (value: Set<string>) => void;
  onSelectPlace: (placeId: string) => void;
};

export type CategoryOption = {
  key: string;
  label: string;
  count: number;
  source: "google" | "heuristic";
};

function buildCategoryOptions(places: Place[]): CategoryOption[] {
  const categories = new Map<string, CategoryOption>();
  for (const place of places) {
    const current = categories.get(place.category.key);
    if (current) {
      current.count += 1;
    } else {
      categories.set(place.category.key, {
        ...place.category,
        count: 1,
      });
    }
  }
  return Array.from(categories.values()).sort((a, b) => b.count - a.count);
}

function channelsWithCounts(channels: Channel[], places: Place[]): Channel[] {
  const counts = new Map<string, number>();
  for (const place of places) {
    for (const channelId of new Set(place.mentions.map((mention) => mention.channelId))) {
      counts.set(channelId, (counts.get(channelId) || 0) + 1);
    }
  }
  return channels
    .map((channel) => ({ ...channel, mentions: counts.get(channel.id) || 0 }))
    .sort((a, b) => b.mentions - a.mentions);
}

export function Sidebar({
  data,
  groupMode,
  selectedChannels,
  selectedCategories,
  visiblePlaces,
  unlocatedPlaces,
  selectedPlace,
  bounds,
  onGroupModeChange,
  onSelectedChannelsChange,
  onSelectedCategoriesChange,
  onSelectPlace,
}: SidebarProps) {
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const categoryOptions = useMemo(() => buildCategoryOptions(data.places), [data.places]);
  const channelOptions = useMemo(
    () => channelsWithCounts(data.channels, data.places),
    [data.channels, data.places],
  );
  const locatedRatio = `${data.stats.locatedPlaces.toLocaleString("zh-TW")} / ${data.stats.places.toLocaleString("zh-TW")}`;

  return (
    <aside className="sidebar">
      <header className="app-header">
        <div>
          <p className="eyebrow">YouTube Places</p>
          <h1>Minagogo 地圖</h1>
        </div>
        <div className="header-badge" title="已定位 / 全部地點">
          <LocateFixed size={16} />
          <span>{locatedRatio}</span>
        </div>
      </header>

      <section
        className={`control-surface ${filtersCollapsed ? "collapsed" : ""}`}
        aria-label="篩選"
      >
        <div className="section-heading filter-heading">
          <Filter size={16} />
          <h2>篩選</h2>
          <button
            type="button"
            className="collapse-button"
            onClick={() => setFiltersCollapsed((value) => !value)}
            aria-expanded={!filtersCollapsed}
            aria-controls="filter-panel"
            aria-label={filtersCollapsed ? "展開篩選" : "收合篩選"}
            title={filtersCollapsed ? "展開篩選" : "收合篩選"}
          >
            <ChevronDown
              size={17}
              className={filtersCollapsed ? "collapse-icon collapsed" : "collapse-icon"}
            />
          </button>
        </div>
        {!filtersCollapsed ? (
          <div id="filter-panel">
            <FilterPanel
              mode={groupMode}
              channels={channelOptions}
              categories={categoryOptions}
              selectedChannels={selectedChannels}
              selectedCategories={selectedCategories}
              onModeChange={onGroupModeChange}
              onSelectedChannelsChange={onSelectedChannelsChange}
              onSelectedCategoriesChange={onSelectedCategoriesChange}
            />
          </div>
        ) : null}
      </section>

      <PlaceList
        places={visiblePlaces}
        unlocatedPlaces={unlocatedPlaces}
        hasBounds={Boolean(bounds)}
        mode={groupMode}
        selectedChannels={selectedChannels}
        selectedCategories={selectedCategories}
        selectedPlaceId={selectedPlace?.id || null}
        onSelectPlace={onSelectPlace}
      />

      <PlaceDetails place={selectedPlace} />
    </aside>
  );
}
