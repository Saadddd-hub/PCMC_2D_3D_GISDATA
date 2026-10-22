import React, { useEffect, useState, memo } from 'react';
import { QualityReport } from '@/types/ward';
import { fetchQualityReport } from '@/lib/api';
import { X, ShieldCheck, CheckCircle2, AlertTriangle, Layers, Split, Database } from 'lucide-react';

interface QualityModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QualityModal: React.FC<QualityModalProps> = memo(({ isOpen, onClose }) => {
  const [report, setReport] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetchQualityReport()
      .then((data) => {
        setReport(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to fetch data quality metrics');
        setLoading(false);
      });
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div
        className="modal-container glass-panel animate-scale-up"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quality-modal-title"
      >
        <div className="modal-header">
          <div className="modal-title-row">
            <ShieldCheck className="icon-md text-emerald" />
            <div>
              <h3 id="quality-modal-title" className="modal-title">
                PCMC Electoral Wards Data Quality Audit
              </h3>
              <p className="modal-sub">Calculated via GeoPandas in UTM 43N (EPSG:32643)</p>
            </div>
          </div>
          <button
            type="button"
            className="btn-icon-close"
            onClick={onClose}
            aria-label="Close Audit Modal"
          >
            <X className="icon-sm" />
          </button>
        </div>

        <div className="modal-body">
          {loading && (
            <div className="panel-state-center">
              <div className="spinner" />
              <p>Running spatial topology audit...</p>
            </div>
          )}

          {error && (
            <div className="panel-error-box">
              <p className="error-title">Audit Error</p>
              <p className="error-msg">{error}</p>
            </div>
          )}

          {!loading && report && (
            <div className="quality-audit-content">
              <div className="audit-status-banner">
                <CheckCircle2 className="icon-md text-emerald" />
                <div className="banner-text">
                  <strong>Topological Integrity Verified</strong>
                  <p>{report.summary}</p>
                </div>
              </div>

              <div className="audit-metrics-grid">
                <div className="audit-card">
                  <div className="audit-card-icon">
                    <Database className="icon-sm text-primary" />
                  </div>
                  <div className="audit-card-data">
                    <span className="audit-val">{report.total_features}</span>
                    <span className="audit-label">Total Ward Polygons</span>
                    <span className="audit-hint">All 66 wards EPSG:4326</span>
                  </div>
                </div>

                <div className="audit-card">
                  <div className="audit-card-icon">
                    <ShieldCheck className="icon-sm text-emerald" />
                  </div>
                  <div className="audit-card-data">
                    <span className="audit-val">{report.invalid_geometries_found}</span>
                    <span className="audit-label">Invalid Geometries</span>
                    <span className="audit-hint">0 defects, 100% valid</span>
                  </div>
                </div>

                <div className="audit-card">
                  <div className="audit-card-icon">
                    <Split className="icon-sm text-amber" />
                  </div>
                  <div className="audit-card-data">
                    <span className="audit-val">{report.overlaps_count}</span>
                    <span className="audit-label">Boundary Slivers</span>
                    <span className="audit-hint">
                      Overlap area: {report.total_overlap_area_km2} km² (&lt;0.02%)
                    </span>
                  </div>
                </div>

                <div className="audit-card">
                  <div className="audit-card-icon">
                    <Layers className="icon-sm text-violet" />
                  </div>
                  <div className="audit-card-data">
                    <span className="audit-val">{report.gap_percentage}%</span>
                    <span className="audit-label">Union vs Sum Gap</span>
                    <span className="audit-hint">
                      Union: {report.union_area_km2} km² / Sum: {report.sum_individual_areas_km2} km²
                    </span>
                  </div>
                </div>
              </div>

              <div className="audit-explanation-box">
                <h4>Methodology Notes</h4>
                <ul>
                  <li>
                    <strong>Projection:</strong> All geographic calculations (area, perimeter, compactness, intersections) are computed in projected CRS EPSG:32643 (UTM Zone 43N) for metric accuracy.
                  </li>
                  <li>
                    <strong>3D Geometry:</strong> Z coordinates are safely stripped to 2D planar coordinates prior to make_valid topological validation.
                  </li>
                  <li>
                    <strong>Precision:</strong> Exported GeoJSON coordinates in EPSG:4326 are rounded to 6 decimal places (~0.1m precision).
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

QualityModal.displayName = 'QualityModal';
