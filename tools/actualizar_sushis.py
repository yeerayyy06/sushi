#!/usr/bin/env python3
"""
Actualiza data/sushis-es.json: los restaurantes de sushi, japoneses y asiáticos de España,
sacados de Overture Maps (datos abiertos de lugares de Meta, Microsoft, Foursquare y otros).

Uso (una vez cada pocos meses, si queréis datos frescos):
    python3 -m venv .venv && .venv/bin/pip install duckdb
    .venv/bin/python tools/actualizar_sushis.py            # usa la última versión publicada
    .venv/bin/python tools/actualizar_sushis.py 2026-10-21.0

Licencia de los datos: CDLA Permissive 2.0 / ODbL según la fuente (© Overture Maps Foundation).
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

import re

import duckdb

# Los que entran solo por el nombre tienen que tenerlo como palabra entera
# (si no, "ramen" encaja en "assessorament" o "subministraments").
NAME_RE = re.compile(r"\b(sushi\w*|jap[oó]n\w*|japo|nikkei|izakaya|ramen|temaki|maki)\b", re.IGNORECASE)

OUT = Path(__file__).resolve().parent.parent / "data" / "sushis-es.json"

# Categorías de Overture que cuentan como "sushi o parecido" y su código corto en el archivo.
CATEGORIES = {
    "sushi_restaurant": "s",
    "japanese_restaurant": "j",
    "ramen_restaurant": "j",
    "asian_restaurant": "a",
    "asian_fusion_restaurant": "a",
    "wok_restaurant": "a",
    "poke_restaurant": "a",
}
NAME_PATTERNS = ["%sushi%", "%japon%", "%japo %", "%nikkei%", "%izakaya%", "%ramen%"]
BOXES = [  # (xmin, xmax, ymin, ymax): península y Baleares; Canarias
    (-9.6, 4.6, 35.8, 44.0),
    (-18.4, -13.2, 27.5, 29.5),
]


def latest_release():
    with urllib.request.urlopen("https://stac.overturemaps.org/catalog.json", timeout=30) as res:
        return json.load(res)["latest"]


def main():
    release = sys.argv[1] if len(sys.argv) > 1 else latest_release()
    src = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    cats = ", ".join(f"'{c}'" for c in CATEGORIES)
    names = " OR ".join(f"lower(names.\"primary\") LIKE '{p}'" for p in NAME_PATTERNS)
    boxes = " OR ".join(
        f"(bbox.xmin BETWEEN {x0} AND {x1} AND bbox.ymin BETWEEN {y0} AND {y1})" for x0, x1, y0, y1 in BOXES
    )
    t = time.time()
    rows = con.execute(f"""
        SELECT names."primary" AS name,
               round((bbox.ymin + bbox.ymax) / 2, 5) AS lat,
               round((bbox.xmin + bbox.xmax) / 2, 5) AS lng,
               coalesce(addresses[1].freeform, '') AS street,
               coalesce(addresses[1].locality, '') AS city,
               taxonomy."primary" AS cat,
               round(confidence, 2) AS conf,
               coalesce(websites[1], '') AS web,
               id
        FROM read_parquet('{src}', hive_partitioning=1)
        WHERE ({boxes})
          AND coalesce(addresses[1].country, 'ES') = 'ES'
          AND coalesce(operating_status, 'open') NOT IN ('permanently_closed', 'temporarily_closed')
          AND confidence >= 0.35
          AND names."primary" IS NOT NULL
          AND (taxonomy."primary" IN ({cats}) OR {names})
    """).fetchall()
    print(f"{len(rows)} sitios en {time.time() - t:.0f} s (versión {release})")

    places = []
    seen = set()
    for name, lat, lng, street, city, cat, conf, web, oid in rows:
        key = (name.strip().lower(), round(lat, 3), round(lng, 3))
        if key in seen:
            continue
        seen.add(key)
        code = CATEGORIES.get(cat or "", "o")
        if code == "o" and not NAME_RE.search(name):
            continue
        address = ", ".join(x for x in (street.strip(), city.strip()) if x)
        places.append([name.strip(), lat, lng, address, code, conf, web.strip()])
    places.sort(key=lambda p: (p[1], p[2]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "Overture Maps Foundation",
        "release": release,
        "fields": ["name", "lat", "lng", "address", "type(s=sushi,j=japonés,a=asiático,o=otro)", "confidence", "web"],
        "places": places,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Guardado {OUT} ({OUT.stat().st_size / 1024:.0f} KB, {len(places)} sitios)")


if __name__ == "__main__":
    main()
