import { CheckSquare, Square } from "lucide-react";
import type { Channel, GroupMode } from "../types";
import type { CategoryOption } from "./Sidebar";

type FilterPanelProps = {
  mode: GroupMode;
  channels: Channel[];
  categories: CategoryOption[];
  selectedChannels: Set<string>;
  selectedCategories: Set<string>;
  onModeChange: (mode: GroupMode) => void;
  onSelectedChannelsChange: (value: Set<string>) => void;
  onSelectedCategoriesChange: (value: Set<string>) => void;
};

function toggleInSet(source: Set<string>, key: string): Set<string> {
  const next = new Set(source);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function FilterPanel({
  mode,
  channels,
  categories,
  selectedChannels,
  selectedCategories,
  onModeChange,
  onSelectedChannelsChange,
  onSelectedCategoriesChange,
}: FilterPanelProps) {
  const options =
    mode === "channel"
      ? channels.map((channel) => ({
          key: channel.id,
          label: channel.name,
          count: channel.mentions,
          checked: selectedChannels.has(channel.id),
        }))
      : categories.map((category) => ({
          key: category.key,
          label: category.label,
          count: category.count,
          checked: selectedCategories.has(category.key),
        }));
  const selected = mode === "channel" ? selectedChannels : selectedCategories;
  const allKeys = options.map((option) => option.key);

  const setSelected =
    mode === "channel" ? onSelectedChannelsChange : onSelectedCategoriesChange;

  return (
    <div className="filter-panel">
      <div className="segmented-control" role="tablist" aria-label="分組方式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "channel"}
          className={mode === "channel" ? "active" : ""}
          onClick={() => onModeChange("channel")}
        >
          依頻道
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "category"}
          className={mode === "category" ? "active" : ""}
          onClick={() => onModeChange("category")}
        >
          依類型
        </button>
      </div>

      <div className="bulk-actions">
        <button type="button" onClick={() => setSelected(new Set(allKeys))}>
          <CheckSquare size={15} />
          全選
        </button>
        <button type="button" onClick={() => setSelected(new Set())}>
          <Square size={15} />
          清除
        </button>
      </div>

      <div className="filter-options">
        {options.map((option) => (
          <label key={option.key} className="filter-option">
            <input
              type="checkbox"
              checked={selected.has(option.key)}
              onChange={() => setSelected(toggleInSet(selected, option.key))}
            />
            <span className="option-label">{option.label}</span>
            <span className="option-count">{option.count.toLocaleString("zh-TW")}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
