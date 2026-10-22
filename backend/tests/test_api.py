import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.geo import processor


@pytest.fixture(scope="session")
def client():
    # Trigger startup lifespan processing
    with TestClient(app) as test_client:
        yield test_client


def test_health_endpoint(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["wards_loaded"] == 66
    assert "EPSG:32643" in data["projected_crs"]


def test_ward_feature_count_and_positive_areas(client):
    response = client.get("/api/wards")
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "FeatureCollection"
    features = data["features"]
    
    # Requirement: Exactly 66 features
    assert len(features) == 66, f"Expected 66 wards, found {len(features)}"

    for f in features:
        props = f["properties"]
        geom = f["geometry"]
        assert geom["type"] in ("Polygon", "MultiPolygon")
        assert len(geom["coordinates"]) > 0

        # Requirement: All areas positive
        assert props["area_km2"] > 0, f"Ward {props.get('name')} area is not positive: {props['area_km2']}"
        assert props["perimeter_km"] > 0, f"Ward {props.get('name')} perimeter is not positive"
        assert 0 < props["compactness"] <= 1.0, f"Ward {props.get('name')} compactness out of range: {props['compactness']}"
        assert props["zone"] in ["A", "B", "C", "D", "E", "F"]
        assert 73.0 < props["centroid_lon"] < 74.5, "Centroid lon out of range"
        assert 18.0 < props["centroid_lat"] < 19.5, "Centroid lat out of range"


def test_total_area_approximately_177_sqkm(client):
    response = client.get("/api/stats")
    assert response.status_code == 200
    stats = response.json()
    total_area = stats["total_area_km2"]
    
    # Requirement: Total area is ~177 km² within 5% (168.15 to 185.85)
    lower_bound = 177.0 * 0.95  # 168.15 km²
    upper_bound = 177.0 * 1.05  # 185.85 km²
    assert lower_bound <= total_area <= upper_bound, (
        f"Total area {total_area} km² is outside 5% of 177 km² ({lower_bound:.2f} - {upper_bound:.2f})"
    )


def test_zones_breakdown_and_largest_smallest(client):
    response = client.get("/api/stats")
    assert response.status_code == 200
    stats = response.json()
    
    assert stats["total_wards"] == 66
    zones = stats["zones"]
    assert len(zones) == 6  # Zones A, B, C, D, E, F
    zone_letters = [z["zone"] for z in zones]
    assert sorted(zone_letters) == ["A", "B", "C", "D", "E", "F"]

    # Verify sum of shares is ~100%
    total_share = sum(z["share_of_total_area_pct"] for z in zones)
    assert 99.0 <= total_share <= 101.0

    # Verify largest and smallest wards
    largest = stats["largest_ward"]
    smallest = stats["smallest_ward"]
    assert largest["area_km2"] > smallest["area_km2"]
    assert largest["area_km2"] > 15.0  # Largest ward in PCMC is ~25 km²
    assert smallest["area_km2"] < 1.0   # Smallest ward in PCMC is ~0.12 km²


def test_single_ward_lookup(client):
    # Lookup by integer-like string
    res1 = client.get("/api/wards/1")
    assert res1.status_code == 200
    w1 = res1.json()
    assert w1["properties"]["wardnum"] == 1
    assert "Zone F" in w1["properties"]["name"]

    # Lookup by string wardnum e.g. "64_1"
    res64_1 = client.get("/api/wards/64_1")
    assert res64_1.status_code == 200
    w64_1 = res64_1.json()
    assert str(w64_1["properties"]["wardnum"]) == "64_1"

    # Non-existent ward returns 404
    res_missing = client.get("/api/wards/non_existent_ward_999")
    assert res_missing.status_code == 404


def test_data_quality_report(client):
    response = client.get("/api/quality")
    assert response.status_code == 200
    report = response.json()
    assert report["total_features"] == 66
    assert report["union_area_km2"] > 0
    assert report["gap_percentage"] < 1.0  # Gap between union and sum is well below 1%
