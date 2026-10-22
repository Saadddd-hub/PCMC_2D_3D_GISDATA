import React, { useState, memo } from 'react';
import { ZONE_COLORS, ZoneStat } from '@/types/ward';
import { ChevronDown, ChevronUp, MapPin } from 'lucide-react';

interface LegendProps {
  zoneStats?: ZoneStat[];
  activeZoneFilter?: string | null;
  onSelectZoneFilter?: (zone: string | null) => void;
}

export const Legend: React.FC<LegendProps> = memo(({
  zoneStats,
  activeZoneFilter,
  onSelectZoneFilter,
}) => {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pcmc_panel_legend_collapsed');
      return saved === 'true';
    }
    return false;
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('pcmc_panel_legend_collapsed', String(next));
      }
      return next;
    });
  };

  const statsMap = (zoneStats || []).reduce((acc, z) => {
    acc[z.zone] = z;
    return acc;
  }, {} as Record<string, ZoneStat>);

  return (
    <div className={`legend-card glass-panel ${collapsed ? 'collapsed' : ''}`} id="map-legend">
      <div
        className="legend-header"
        onClick={toggleCollapsed}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
      >
        <div className="legend-title">
          <MapPin className="icon-xs" />
          <span>Electoral Zones (A-F)</span>
        </div>
        <button
          type="button"
          className="collapse-btn"
          aria-label={collapsed ? 'Expand Legend' : 'Collapse Legend'}
        >
          {collapsed ? <ChevronUp className="icon-xs" /> : <ChevronDown className="icon-xs" />}
        </button>
      </div>

      {!collapsed && (
        <div className="legend-content animate-fade-in">
          <div className="legend-items-list">
            {Object.entries(ZONE_COLORS).map(([zoneKey, config]) => {
              const stat = statsMap[zoneKey];
              const isSelected = activeZoneFilter === zoneKey;

              return (
                <div
                  key={zoneKey}
                  className={`legend-item ${isSelected ? 'active-filter' : ''}`}
                  onClick={() => onSelectZoneFilter?.(isSelected ? null : zoneKey)}
                  title={`Filter by Zone ${zoneKey} (${config.name})`}
                  role="button"
                  tabIndex={0}
                >
                  <span
                    className="legend-color-dot"
                    style={{ backgroundColor: config.hex }}
                  />
                  <div className="legend-item-info">
                    <span className="legend-zone-label">Zone {zoneKey}</span>
                    <span className="legend-zone-sub">{config.name.split('(')[1]?.replace(')', '') || ''}</span>
                  </div>
                  {stat && (
                    <div className="legend-item-badge">
                      <span className="badge-wards">{stat.ward_count} wards</span>
                      <span className="badge-pct">{stat.share_of_total_area_pct}%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {activeZoneFilter && (
            <button
              type="button"
              className="clear-filter-btn"
              onClick={() => onSelectZoneFilter?.(null)}
            >
              Reset Zone Filter
            </button>
          )}
        </div>
      )}
    </div>
  );
});

Legend.displayName = 'Legend';
