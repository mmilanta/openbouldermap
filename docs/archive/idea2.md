# Directly pushing changes to OSM

I would like the edit mode to not export an osc file, but instead directly pushing to osm.

For this we need to things:

1. Data in edit mode shuold be "live" from osm apis, not based on our dump. This prevents making edits on already modified data.
2. The auth part and so on.