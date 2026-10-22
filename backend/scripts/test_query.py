import requests

q = """[out:json][timeout:25];
(
  way["highway"](18.64,73.80,18.65,73.81);
);
out geom 5;
"""

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://overpass-turbo.eu/",
}

for s in [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]:
    try:
        r = requests.post(s, data={"data": q}, headers=headers, timeout=15)
        print(s, "--> Status:", r.status_code, "Length:", len(r.content))
        if r.status_code == 200:
            print("SUCCESS from", s, "elements:", len(r.json().get("elements", [])))
            break
    except Exception as e:
        print(s, "--> Error:", type(e).__name__)
