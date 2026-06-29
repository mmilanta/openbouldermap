# Idea
the idea is to create a map for bouldering. We do not want to store data, cause all the data is stored on openstreatmap anyway. In particular a boulders are areas flagged by 
```
climbing=boulder
natural=bare_rock
sport=climbing
```
and boulder lines are points with metadata
```
climbing=route_bottom
climbing:boulder=yes
climbing:grade:font=7C+
climbing:start=sit
description=Wonderful. Stand 7C, FA Simon Wandeler
name=Trieste Gottardo
sport=climbing
```

The idea is to create a map where you can see the boulders highlighted and you can click on the routes. We think about how to store images later.

There are 2 ways to do this? overpass api and rerender the tiles. 

what are pros and cons?