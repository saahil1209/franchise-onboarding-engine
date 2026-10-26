# Data sources

| File | Source | Licence | Level | Built by |
| --- | --- | --- | --- | --- |
| `app/data/pins.json` | All India Pincode Directory, Department of Posts, published on data.gov.in; taken from its repackaging in the npm package `india-pincode@2.5.9` (`data/pincodes.json.gz`, 165,627 post offices) | Government Open Data Licence – India (attribution) | PIN (centroid of its post offices) | `node data/build-pins.mjs <pincodes.json.gz>` |

Attribution: "Contains data from the All India Pincode Directory, Department of Posts, Government of India, published under the Government Open Data Licence – India."

Coordinates are the post offices' published positions, cleaned as described in `docs/DESIGN.md`. They are open data, not Google data, so Google Maps caching terms don't apply to them.

To refresh: download the directory from data.gov.in (or a newer package release), run the build script, and check the counts it prints.
