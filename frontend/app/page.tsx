'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { WardFeatureCollection, StatsResponse, OSMLayerId, OSMLayerState } from '@/types/ward';
import { fetchWards, fetchStats } from '@/lib/api';
import { ModeToggle } from '@/components/ModeToggle';
import { Legend } from '@/components/Legend';
import {
  Globe2,
  ShieldCheck,
  Search,
  RefreshCw,
  AlertCircle,
  MapPin,
} from 'lucide-react';

// Dynamic import with ssr: false for Deck.gl & MapLibre WebGL viewport
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="map-loading-placeholder">
      <div className="spinner-large" />
      <p className="loading-map-label">Initializing Deck.GL & MapLibre WebGL Viewport...</p>
      <span className="loading-map-sub">Rendering PCMC boundary & OSM vector layers...</span>
    </div>
  ),
});

// Lazy-load heavy UI (Recharts charts, modal dialogs)
const StatsPanel = dynamic(() => import('@/components/StatsPanel').then((m) => m.StatsPanel), {
  ssr: false,
  loading: () => (
    <div className="stats-panel glass-panel" style={{ width: 340, minHeight: 280 }}>
      <div className="panel-loading-state">
        <div className="spinner-sm" />
        <span>Loading analytics...</span>
      </div>
    </div>
  ),
});

const QualityModal = dynamic(() => import('@/components/QualityModal').then((m) => m.QualityModal), {
  ssr: false,
});

const WardDetail = dynamic(() => import('@/components/WardDetail').then((m) => m.WardDetail), {
  ssr: false,
});

import staticWards from '../public/data/wards.json';
import staticStats from '../public/data/stats.json';

export default function HomePage() {
  // Use SWR with preloaded static fallbackData for instant zero-wait first paint
  const {
    data: wardData,
    error: wardsError,
    mutate: mutateWards,
    isLoading: wardsLoading,
  } = useSWR<WardFeatureCollection>('/api/wards', fetchWards, {
    fallbackData: staticWards as unknown as WardFeatureCollection,
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  });

  const {
    data: stats,
    error: statsError,
    mutate: mutateStats,
    isLoading: statsLoading,
  } = useSWR<StatsResponse>('/api/stats', fetchStats, {
    fallbackData: staticStats as unknown as StatsResponse,
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  });

  const loading = (wardsLoading && !wardData) || (statsLoading && !stats);
  const error = wardsError?.message || statsError?.message || null;

  // Map state
  const [is3D, setIs3D] = useState<boolean>(false);
  const [selectedMetricId, setSelectedMetricId] = useState<string>('area_km2');
  const [selectedWardId, setSelectedWardId] = useState<string | null>(null);
  const [activeZoneFilter, setActiveZoneFilter] = useState<string | null>(null);
  const [flyToCentroid, setFlyToCentroid] = useState<[number, number] | null>(null);
  const [resetCameraTrigger, setResetCameraTrigger] = useState<number>(0);
  const [zoomInTrigger, setZoomInTrigger] = useState<number>(0);
  const [currentZoom, setCurrentZoom] = useState<number>(11.4);

  // OSM Layer Toggles State (Optimistic instant toggles)
  const [layerState, setLayerState] = useState<OSMLayerState>({
    boundary: true,
    roads: true,
    buildings: true,
    parks: true,
  });

  const handleToggleLayer = useCallback((layerId: OSMLayerId) => {
    setLayerState((prev) => ({
      ...prev,
      [layerId]: !prev[layerId],
    }));
  }, []);

  // Modals & Search
  const [isQualityModalOpen, setIsQualityModalOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const reloadData = useCallback(() => {
    mutateWards();
    mutateStats();
  }, [mutateWards, mutateStats]);

  // Filtered wards for instant search bar autocomplete from client data
  const filteredSearchWards = useMemo(() => {
    if (!wardData || !searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return wardData.features
      .filter(
        (f) =>
          f.properties.name.toLowerCase().includes(q) ||
          String(f.properties.wardnum).toLowerCase().includes(q) ||
          `zone ${f.properties.zone.toLowerCase()}`.includes(q)
      )
      .slice(0, 8);
  }, [wardData, searchQuery]);

  const handleSelectWardFromSearch = useCallback(
    (wardId: string) => {
      setSelectedWardId(wardId);
      setSearchQuery('');
      const found = wardData?.features.find((f) => String(f.properties.wardnum) === wardId);
      if (found) {
        setFlyToCentroid([found.properties.centroid_lon, found.properties.centroid_lat]);
      }
    },
    [wardData]
  );

  return (
    <main className="app-shell" id="app-root">
      {/* Top Navbar */}
      <header className="app-header glass-panel">
        <div className="header-brand">
          <div className="brand-logo">
            <Globe2 className="icon-md text-primary animate-pulse-slow" />
          </div>
          <div className="brand-titles">
            <h1 className="brand-title">PCMC GIS Explorer</h1>
            <span className="brand-subtitle">
              Pimpri-Chinchwad Electoral Wards • OpenStreetMap Roads, Buildings & Parks
            </span>
          </div>
        </div>

        {/* Search Ward */}
        <div className="header-search-wrap">
          <div className="search-input-box">
            <Search className="icon-xs text-muted" />
            <input
              type="text"
              id="search-ward-input"
              placeholder="Search ward or zone (e.g. 01, Zone F, 64_1)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearchQuery('')}
              >
                ×
              </button>
            )}
          </div>

          {filteredSearchWards.length > 0 && (
            <div className="search-dropdown-results glass-panel animate-fade-in">
              {filteredSearchWards.map((w) => (
                <div
                  key={w.id}
                  className="search-result-item"
                  onClick={() => handleSelectWardFromSearch(String(w.properties.wardnum))}
                  role="button"
                  tabIndex={0}
                >
                  <MapPin className="icon-xs text-primary" />
                  <span className="result-name">{w.properties.name}</span>
                  <span className="result-meta">
                    Zone {w.properties.zone} • {w.properties.area_km2.toFixed(2)} km²
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right header actions */}
        <div className="header-actions">
          <button
            type="button"
            id="btn-quality-audit"
            className="header-btn quality-btn"
            onClick={() => setIsQualityModalOpen(true)}
            title="View Topological Data Quality Report"
          >
            <ShieldCheck className="icon-sm text-emerald" />
            <span className="hide-on-mobile">Data Quality</span>
          </button>

          <button
            type="button"
            className="header-btn icon-only"
            onClick={reloadData}
            title="Reload dataset from backend"
            disabled={loading}
          >
            <RefreshCw className={`icon-sm ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Main Map Container */}
      <section className="map-stage">
        {loading && !wardData && (
          <div className="global-loader-overlay">
            <div className="spinner-large" />
            <p className="loading-map-label">Loading PCMC Municipal Boundary Data...</p>
            <span className="loading-map-sub">Querying /api/wards and /api/stats</span>
          </div>
        )}

        {error && !wardData && (
          <div className="global-error-banner glass-panel animate-fade-in">
            <AlertCircle className="icon-md text-rose" />
            <div className="error-content">
              <h3>Cannot Connect to PCMC GIS Backend</h3>
              <p>{error}</p>
              <div className="error-actions">
                <button type="button" className="btn-retry" onClick={reloadData}>
                  <RefreshCw className="icon-xs" /> Try Again
                </button>
                <span className="error-hint">
                  Ensure FastAPI is running: <code>uvicorn app.main:app --port 8000</code>
                </span>
              </div>
            </div>
          </div>
        )}

        {wardData && (
          <MapView
            wardData={wardData}
            is3D={is3D}
            selectedMetricId={selectedMetricId}
            selectedWardId={selectedWardId}
            activeZoneFilter={activeZoneFilter}
            onSelectWard={(id) => setSelectedWardId(id)}
            flyToCentroid={flyToCentroid}
            resetCameraTrigger={resetCameraTrigger}
            zoomInTrigger={zoomInTrigger}
            layerState={layerState}
            onZoomChange={setCurrentZoom}
          />
        )}

        {/* Floating Top Left: Mode Toggle & Layer Controls */}
        <div className="floating-top-left">
          <ModeToggle
            is3D={is3D}
            onToggleMode={(val) => setIs3D(val)}
            selectedMetricId={selectedMetricId}
            onChangeMetric={(id) => setSelectedMetricId(id)}
            onResetCamera={() => setResetCameraTrigger((t) => t + 1)}
            onZoomIn={() => setZoomInTrigger((z) => z + 1)}
            layerState={layerState}
            onToggleLayer={handleToggleLayer}
            currentZoom={currentZoom}
          />
        </div>

        {/* Floating Bottom Left: Zone Legend */}
        <div className="floating-bottom-left">
          <Legend
            zoneStats={stats?.zones}
            activeZoneFilter={activeZoneFilter}
            onSelectZoneFilter={(z) => setActiveZoneFilter(z)}
          />
        </div>

        {/* Floating Top Right: Stats Panel */}
        <div className="floating-top-right">
          <StatsPanel
            stats={stats || null}
            loading={!stats && loading}
            onSelectZone={(z) => setActiveZoneFilter(z === activeZoneFilter ? null : z)}
            onSelectWard={(wId) => {
              setSelectedWardId(wId);
              const found = wardData?.features.find((f) => String(f.properties.wardnum) === wId);
              if (found) {
                setFlyToCentroid([found.properties.centroid_lon, found.properties.centroid_lat]);
              }
            }}
          />
        </div>

        {/* Selected Ward Side Detail Panel */}
        <WardDetail
          wardId={selectedWardId}
          onClose={() => setSelectedWardId(null)}
          onFocusWard={(centroid) => setFlyToCentroid(centroid)}
          cityMeanArea={stats?.mean_area_km2}
        />
      </section>

      {/* Quality Audit Modal */}
      {isQualityModalOpen && (
        <QualityModal
          isOpen={isQualityModalOpen}
          onClose={() => setIsQualityModalOpen(false)}
        />
      )}
    </main>
  );
}
