import osmnx as ox
from shapely.geometry import Point

ox.settings.overpass_url = "https://overpass.openstreetmap.fr/api"
ox.settings.overpass_rate_limit = False
ox.settings.http_user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
ox.settings.http_referer = "https://overpass-turbo.eu/"
ox.settings.requests_timeout = 60
ox.settings.log_console = True

p = Point(73.805, 18.648).buffer(0.005)
try:
    gdf = ox.features_from_polygon(p, tags={"highway": True})
    print("SUCCESS with osmnx on openstreetmap.fr! Roads found:", len(gdf))
except Exception as e:
    print("Failed:", type(e), e)
