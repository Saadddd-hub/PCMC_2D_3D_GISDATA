import React, { useState, useEffect, useMemo, memo } from 'react';
import { StatsResponse, ZONE_COLORS, OSMStatsResponse } from '@/types/ward';
import { fetchOSMStats } from '@/lib/api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Table,
  Layers,
  Award,
  Building2,
  Route,
  Trees,
} from 'lucide-react';

interface StatsPanelProps {
  stats: StatsResponse | null;
  loading: boolean;
  onSelectZone?: (zone: string) => void;
  onSelectWard?: (wardId: string) => void;
}

export const StatsPanel: React.FC<StatsPanelProps> = memo(({
  stats,
  loading,
  onSelectZone,
  onSelectWard,
}) => {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('pcmc_panel_stats_collapsed');
      return saved === 'true';
    }
    return false;
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('pcmc_panel_stats_collapsed', String(next));
      }
      return next;
    });
  };
  const [activeTab, setActiveTab] = useState<'chart' | 'table'>('chart');
  const [osmStats, setOsmStats] = useState<OSMStatsResponse | null>(null);

  useEffect(() => {
    fetchOSMStats()
      .then((data) => setOsmStats(data))
      .catch((err) => console.warn('Failed to load OSM stats:', err));
  }, []);

  if (loading) {
    return (
      <div className="stats-panel glass-panel" id="stats-panel">
        <div className="panel-loading-state">
          <div className="spinner-sm" />
          <span>Loading city analytics...</span>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  // Chart data formatted (memoized)
  const chartData = useMemo(() => {
    if (!stats) return [];
    return stats.zones.map((z) => ({
      zone: `Zone ${z.zone}`,
      zoneKey: z.zone,
      area: z.total_area_km2,
      count: z.ward_count,
      share: z.share_of_total_area_pct,
      fill: ZONE_COLORS[z.zone]?.hex || '#3b82f6',
    }));
  }, [stats]);

  return (
    <div className={`stats-panel glass-panel ${collapsed ? 'is-collapsed' : ''}`} id="stats-panel">
      {/* Header */}
      <div
        className="stats-panel-header"
        onClick={toggleCollapsed}
        role="button"
        tabIndex={0}
      >
        <div className="header-left">
          <BarChart3 className="icon-sm text-primary" />
          <div className="title-group">
            <span className="panel-title">City GIS Analytics</span>
            <span className="panel-sub">PCMC Municipal Corporation</span>
          </div>
        </div>

        <button
          type="button"
          className="collapse-toggle-btn"
          aria-label={collapsed ? 'Expand Stats Panel' : 'Collapse Stats Panel'}
        >
          {collapsed ? <ChevronUp className="icon-xs" /> : <ChevronDown className="icon-xs" />}
        </button>
      </div>

      {!collapsed && (
        <div className="stats-panel-content animate-fade-in">
          {/* Top KPI Cards: Wards & Area */}
          <div className="stats-kpi-grid">
            <div className="kpi-card">
              <span className="kpi-num">{stats.total_wards}</span>
              <span className="kpi-label">Electoral Wards</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-num">{stats.total_area_km2.toFixed(1)}</span>
              <span className="kpi-label">Total Area (km²)</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-num">{stats.mean_area_km2.toFixed(2)}</span>
              <span className="kpi-label">Mean Ward Area</span>
            </div>
          </div>

          {/* OSM Citywide Infrastructure KPIs */}
          {osmStats && (
            <div className="osm-city-kpi-row">
              <div className="osm-mini-stat" title="Total OSM mapped buildings in PCMC">
                <Building2 className="icon-xs text-amber" />
                <div className="stat-text">
                  <span className="stat-val">{osmStats.total_buildings.toLocaleString()}</span>
                  <span className="stat-lbl">Buildings ({osmStats.total_built_area_km2.toFixed(1)} km²)</span>
                </div>
              </div>
              <div className="osm-mini-stat" title="Total OSM street network length">
                <Route className="icon-xs text-sky" />
                <div className="stat-text">
                  <span className="stat-val">{Math.round(osmStats.total_road_km).toLocaleString()} km</span>
                  <span className="stat-lbl">Road Network</span>
                </div>
              </div>
              <div className="osm-mini-stat" title="Total parks and recreational green area">
                <Trees className="icon-xs text-emerald" />
                <div className="stat-text">
                  <span className="stat-val">{osmStats.total_green_km2.toFixed(2)} km²</span>
                  <span className="stat-lbl">Green Space</span>
                </div>
              </div>
            </div>
          )}

          {/* Highlights: Largest & Smallest Wards */}
          <div className="ward-extremes-row">
            <div
              className="extreme-chip largest"
              onClick={() => onSelectWard?.(String(stats.largest_ward.wardnum))}
              role="button"
              tabIndex={0}
              title="Click to view largest ward"
            >
              <Award className="icon-xs text-amber" />
              <div className="extreme-info">
                <span className="extreme-tag">Largest: {stats.largest_ward.name}</span>
                <span className="extreme-val">{stats.largest_ward.area_km2.toFixed(2)} km²</span>
              </div>
            </div>

            <div
              className="extreme-chip smallest"
              onClick={() => onSelectWard?.(String(stats.smallest_ward.wardnum))}
              role="button"
              tabIndex={0}
              title="Click to view smallest ward"
            >
              <div className="extreme-info">
                <span className="extreme-tag">Smallest: {stats.smallest_ward.name}</span>
                <span className="extreme-val">{stats.smallest_ward.area_km2.toFixed(2)} km²</span>
              </div>
            </div>
          </div>

          {/* Zone Breakdown Tabs */}
          <div className="panel-tab-bar">
            <button
              type="button"
              className={`panel-tab ${activeTab === 'chart' ? 'active' : ''}`}
              onClick={() => setActiveTab('chart')}
            >
              <BarChart3 className="icon-xs" />
              <span>Zone Area Chart</span>
            </button>
            <button
              type="button"
              className={`panel-tab ${activeTab === 'table' ? 'active' : ''}`}
              onClick={() => setActiveTab('table')}
            >
              <Table className="icon-xs" />
              <span>Zone Table</span>
            </button>
          </div>

          {/* Chart View */}
          {activeTab === 'chart' && (
            <div className="chart-container-box">
              <ResponsiveContainer width="100%" height={175}>
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                  <XAxis
                    dataKey="zoneKey"
                    stroke="#94a3b8"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                    unit="km²"
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="custom-chart-tooltip glass-panel">
                            <span className="tooltip-zone">{data.zone}</span>
                            <div className="tooltip-row">
                              <span>Area:</span>
                              <strong>{data.area.toFixed(2)} km²</strong>
                            </div>
                            <div className="tooltip-row">
                              <span>Wards:</span>
                              <strong>{data.count}</strong>
                            </div>
                            <div className="tooltip-row">
                              <span>Share:</span>
                              <strong>{data.share}%</strong>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar
                    dataKey="area"
                    radius={[4, 4, 0, 0]}
                    onClick={(entry: any) => {
                      const key = entry?.zoneKey || entry?.payload?.zoneKey;
                      if (key) onSelectZone?.(key);
                    }}
                    cursor="pointer"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Table View */}
          {activeTab === 'table' && (
            <div className="zone-table-wrapper">
              <table className="zone-stats-table">
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th>Wards</th>
                    <th>Total Area</th>
                    <th>Mean Area</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.zones.map((z) => {
                    const color = ZONE_COLORS[z.zone]?.hex || '#3b82f6';
                    return (
                      <tr
                        key={z.zone}
                        onClick={() => onSelectZone?.(z.zone)}
                        className="zone-table-row"
                        title={`Filter map by Zone ${z.zone}`}
                      >
                        <td className="zone-cell">
                          <span
                            className="zone-dot-sm"
                            style={{ backgroundColor: color }}
                          />
                          <strong>Zone {z.zone}</strong>
                        </td>
                        <td>{z.ward_count}</td>
                        <td>{z.total_area_km2.toFixed(2)} km²</td>
                        <td>{z.mean_area_km2.toFixed(2)} km²</td>
                        <td>
                          <span className="share-pill">{z.share_of_total_area_pct}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

StatsPanel.displayName = 'StatsPanel';
