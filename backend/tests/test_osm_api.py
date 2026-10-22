import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.geo import processor


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_osm_status(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["wards_loaded"] == 66
    assert "osm_loaded" in data


def test_layer_invalid_name_returns_400(client):
    response = client.get("/api/layers/non_existent_layer")
    assert response.status_code == 400
    assert "Invalid layer" in response.json()["detail"]


def test_layer_invalid_bbox_returns_400(client):
    # Not enough coordinates
    res1 = client.get("/api/layers/roads?bbox=73.8,18.6")
    assert res1.status_code == 400

    # Non-numeric coordinate
    res2 = client.get("/api/layers/roads?bbox=abc,18.6,73.9,18.7")
    assert res2.status_code == 400

    # minx > maxx
    res3 = client.get("/api/layers/roads?bbox=73.9,18.6,73.8,18.7")
    assert res3.status_code == 400

    # miny > maxy
    res4 = client.get("/api/layers/roads?bbox=73.8,18.7,73.9,18.6")
    assert res4.status_code == 400


def test_layer_bbox_filtering_and_caps(client):
    # Test roads with small limit to verify cap and truncated flag
    response = client.get("/api/layers/roads?bbox=73.75,18.60,73.85,18.70&limit=5")
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert "features" in data
    assert len(data["features"]) <= 5
    assert data["limit"] == 5
    if data["total_matching"] > 5:
        assert data["truncated"] is True

    # Test boundary layer
    res_b = client.get("/api/layers/boundary")
    assert res_b.status_code == 200
    b_data = res_b.json()
    assert b_data["type"] == "FeatureCollection"

    # Test buildings layer
    res_bldg = client.get("/api/layers/buildings?bbox=73.78,18.62,73.82,18.66&limit=10")
    assert res_bldg.status_code == 200
    assert len(res_bldg.json()["features"]) <= 10

    # Test parks layer
    res_parks = client.get("/api/layers/parks?bbox=73.78,18.62,73.82,18.66&limit=10")
    assert res_parks.status_code == 200


def test_osm_stats_endpoint(client):
    response = client.get("/api/osm/stats")
    assert response.status_code == 200
    stats = response.json()
    
    assert "total_road_km" in stats
    assert stats["total_road_km"] >= 0
    assert stats["total_buildings"] >= 0
    assert stats["total_built_area_km2"] >= 0
    assert stats["total_green_km2"] >= 0
    assert "roads_by_class" in stats
    assert isinstance(stats["roads_by_class"], dict)
    
    zones = stats["zones"]
    assert len(zones) == 6
    zone_names = [z["zone"] for z in zones]
    assert sorted(zone_names) == ["A", "B", "C", "D", "E", "F"]
    for z in zones:
        assert z["road_km"] >= 0
        assert z["building_count"] >= 0
        assert z["built_area_km2"] >= 0
        assert z["green_km2"] >= 0
        assert z["building_density"] >= 0


def test_ward_osm_endpoint(client):
    # Lookup by ward number
    res1 = client.get("/api/wards/1/osm")
    assert res1.status_code == 200
    w1 = res1.json()
    assert w1["wardnum"] == 1
    assert "building_count" in w1
    assert w1["building_count"] >= 0
    assert "road_km" in w1
    assert w1["road_km"] >= 0
    assert "built_area_km2" in w1
    assert "green_km2" in w1
    assert "building_density" in w1

    # Lookup by string wardnum e.g. "64_1"
    res64_1 = client.get("/api/wards/64_1/osm")
    assert res64_1.status_code == 200
    assert str(res64_1.json()["wardnum"]) == "64_1"

    # Non-existent ward returns 404
    res_none = client.get("/api/wards/non_existent_ward_99999/osm")
    assert res_none.status_code == 404


def test_ward_features_extended_osm_metrics(client):
    response = client.get("/api/wards")
    assert response.status_code == 200
    features = response.json()["features"]
    assert len(features) == 66

    for f in features:
        props = f["properties"]
        assert "building_count" in props
        assert "built_area_km2" in props
        assert "road_km" in props
        assert "green_km2" in props
        assert "building_density" in props
        assert props["building_count"] >= 0
        assert props["road_km"] >= 0
