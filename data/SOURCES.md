# Data sources

| File | Source | Licence | Level | Built by |
| --- | --- | --- | --- | --- |
| `app/data/pins.json` | All India Pincode Directory, Department of Posts, published on data.gov.in; taken from its repackaging in the npm package `india-pincode@2.5.9` (`data/pincodes.json.gz`, 165,627 post offices) | Government Open Data Licence – India (attribution) | PIN (centroid of its post offices) | `node data/build-pins.mjs <pincodes.json.gz>` |
| `app/data/census.json` | Census of India 2011, Primary Census Abstract, India & States/UTs, state and district level: `DDW_PCA0000_2011_Indiastatedist.xlsx`, censusindia.gov.in/nada catalogue 6191 (downloaded 26 October 2026) | Office of the Registrar General & Census Commissioner, India; government open data (attribution) | District, 2011 boundaries; split to PINs as an estimate | `python3 data/build_census.py <xlsx>` |

Attribution: "Contains data from the All India Pincode Directory, Department of Posts, Government of India, published under the Government Open Data Licence – India."

Coordinates are the post offices' published positions, cleaned as described in `docs/DESIGN.md`. They are open data, not Google data, so Google Maps caching terms don't apply to them.

To refresh: download the directory from data.gov.in (or a newer package release), run the build script, and check the counts it prints.
