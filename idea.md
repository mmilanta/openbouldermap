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

## Idea for editor

I would like this website to have an editor, under openbouldermap/edit. Add a small pencil button on the bottom right. For a v0 edit can only be used to modify existing nodes. In particular:
* When Clicking on a climbing route I should have a menu on the right where:
    * I should be able to set image with a wikimedia link (and see the image loading).
    * I can set if a route is sit or not
    * I can set the grade
    * I can set the name
    * the description
I can do many changes, finally there should be a button that downloads an openstreetmap changefile that i can then use to modify the real map.