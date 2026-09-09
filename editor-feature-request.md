# Edit mode expansion — Feature request

## Status and purpose

This document captures the agreed product requirements for expanding OpenBoulderMap's edit mode. It describes user-visible behaviour and scope, not implementation details.

**Status:** agreed scope, with recoverable drafts explicitly marked as a nice-to-have.

This extends the existing editor and supersedes the original `requirements.md` non-goal of in-app editing for the capabilities described here.

## 1. Goal

Allow contributors to create, correct, organise, and delete bouldering features, including mapping a previously unmapped location, while keeping OpenStreetMap as the source of truth.

The editor is **desktop-first**. All edits remain local until exported as an OSM changefile (`.osc`) for review and upload through JOSM. The app does not publish directly to OpenStreetMap.

## 2. Terminology and feature model

### 2.1 Boulders

- A boulder is a physical rock represented by an area with a closed perimeter.
- Its perimeter consists of vertices that users can move, add, or remove.
- A perimeter vertex may also represent a climbing route.
- Boulders do **not** have sector membership.
- New boulders are created as areas, not points.

### 2.2 Routes

- A route is a point representing the climbing route's starting location on the map.
- It may be independent or attached to a boulder perimeter.
- An attached route and its perimeter vertex are **one shared node**, not two points that merely occupy the same coordinates.
- A route belongs to **at most one sector**, or none.
- Attachment to a boulder and membership in a sector are independent.
- Routes attached to the same boulder are not required to belong to the same sector.
- A route's map point is separate from its route line drawn over a photograph.

### 2.3 Sectors

- A sector is a relationship grouping routes.
- A sector belongs to **at most one area**, or none.
- Its editable details are name and description.
- It has no editable map geometry: users do not place a sector point or draw a sector boundary.

### 2.4 Areas

- An area is a relationship grouping sectors.
- Its editable details are name and description.
- It has no editable map geometry: users do not place an area point or draw an area boundary.

### 2.5 Relationships at a glance

```text
Area
  └── Sector
        └── Route

Boulder perimeter ← optional shared-node attachment → Route
```

The organisational hierarchy is **area → sector → route**, not area → sector → boulder → route.

Missing parents are allowed. A route may have no sector, and a sector may have no area.

### 2.6 Reference example

[OSM way 1532729078, Suworow at Gotthardpass](https://www.openstreetmap.org/way/1532729078), illustrates the shared-node model: several nodes defining the boulder perimeter also carry climbing route details.

The editor must preserve and correctly edit this existing relationship rather than treating those routes as unrelated nearby points.

## 3. General editing experience

- Edit mode clearly distinguishes selecting features, moving geometry, and creating features.
- Local changes appear immediately on the map and in relevant details and membership lists.
- Existing features and features created in the current session can be edited and linked together.
- An unfinished action can be cancelled without discarding earlier edits.
- Selecting a route clearly indicates whether it is attached to a boulder and identifies that boulder.
- Route-bearing perimeter vertices are distinguishable from ordinary perimeter vertices.
- Names and grades may be unknown. Users must not be required to invent missing information.
- Existing information outside the supported editing fields must be preserved.

## 4. Create and edit boulders

### 4.1 Creation

Users can:

- Draw and complete a new closed boulder outline.
- Enter its name and description.
- Cancel an unfinished outline without leaving a partial boulder.
- Add routes to the new boulder before exporting.

### 4.2 Reshape an outline

Users can:

- Drag individual perimeter vertices.
- Insert a new vertex along an edge.
- Delete an ordinary perimeter vertex, connecting its neighbouring vertices.

The updated outline is visible while dragging. The editor must prevent completion of changes that leave an invalid outline, including insufficient distinct vertices or a self-intersecting perimeter.

Deleting a route-bearing perimeter vertex is subject to the safeguards in section 6.5.

### 4.3 Move an entire boulder

- Users can move a whole boulder without changing its shape.
- All attached route nodes move with it.
- Nearby independent routes do not move merely because they are close to the boulder.
- Route details and sector memberships remain unchanged.

## 5. Create and edit routes

### 5.1 Creation

Users can create a route:

- As an independent map point.
- On a boulder edge, where it becomes a shared perimeter node.
- On an existing, unoccupied perimeter vertex, where it joins that vertex.

Users can create multiple routes on an existing or newly created boulder within one editing session.

Cancelling route creation must not leave an unintended route or geometry change.

### 5.2 Editable details

The editor supports:

- Name.
- Fontainebleau grade.
- Start type, including sit-start information.
- Description.
- Wikimedia Commons photograph reference and preview.
- Route line drawn over the photograph.
- Sector membership, as described in section 7.

Existing photograph and photo-route-line editing remains available. New photograph uploading is outside this scope.

### 5.3 Independent routes

- Independent routes can be moved freely.
- They do not require a mapped boulder.
- They may be assigned directly to a sector.
- Proximity to a boulder alone does not constitute attachment.

## 6. Route attachment and shared geometry

### 6.1 Move an attached route

- Dragging an attached route moves its shared perimeter node.
- **Both the route location and the boulder outline change together.**
- The changing outline is visible during the drag.
- The editor does not implicitly slide the route along an unchanged outline or detach it.

### 6.2 Attach by snapping to an edge

- While moving an independent route near a boulder boundary, the editor previews the intended snap location and target boulder.
- Dropping onto an edge attaches the route by making its node part of the perimeter.
- Dropping between existing vertices adds a perimeter vertex at the route location.
- Subsequent movement of the route changes the boulder outline as well.
- Snapping works on existing, newly created, and locally reshaped boulders.
- Users must also be able to deliberately leave a route independent rather than attach it.

### 6.3 Attach to an existing vertex

- Dropping a route onto an ordinary existing perimeter vertex joins the points.
- Do not create duplicate vertices at that location.
- Preserve the route's details and sector membership.
- If the target vertex already represents another route, prevent joining and explain why.
- Never silently merge distinct routes, overwrite another route's details, or destroy unrelated information.

### 6.4 Detach from a boulder

Selecting an attached route offers **Detach from boulder**.

Detaching separates the shared node into two independent points at the same initial location:

1. An ordinary perimeter vertex, preserving the boulder outline.
2. A route point, preserving all route details and sector membership.

The detached route can then be moved freely without altering the boulder. The interaction must allow dragging it away without immediately snapping it back to the point from which it was detached.

### 6.5 Remove a route-bearing perimeter vertex

- Removing a perimeter vertex must not silently delete a route.
- If the vertex represents a route, users must first detach the route or delete its route identity.
- Afterward, the remaining ordinary perimeter vertex can be deleted if the resulting outline remains valid.

## 7. Manage sectors and areas

### 7.1 Route-to-sector membership

Users can:

- See a route's current sector, or that it has none.
- Search for an existing sector by name.
- Assign the route to a sector.
- Change its sector, replacing the previous assignment.
- Remove its sector assignment without deleting the route or sector.

Changing sector membership does not move the route, affect its boulder attachment, or alter other routes on the same boulder.

### 7.2 Sector-to-area membership

Users can:

- See a sector's current area, or that it has none.
- Search for an existing area by name.
- Assign the sector to an area.
- Change its area, replacing the previous assignment.
- Remove its area assignment without deleting the sector or area.

Changing a sector's area preserves its route memberships and all map geometry.

### 7.3 Edit and inspect groupings

Users can:

- Open and edit a sector's name and description.
- Inspect the routes belonging to a sector.
- Open and edit an area's name and description.
- Inspect the sectors belonging to an area.
- Add, change, or remove the memberships described above.

Search results must provide enough context to distinguish similarly named sectors or areas. Existing conflicting memberships must be surfaced for review, not silently discarded or normalised.

## 8. Create missing parents during linking

### 8.1 Entry points

- A missing sector can be created while assigning a route to a sector.
- A missing area can be created while assigning a sector to an area.
- Sectors and areas are not created through standalone creation actions.
- Parent selection supports name search and inline creation; map-based parent selection is not required.

### 8.2 Complete workflow

A contributor can complete this sequence without abandoning the original route:

> Create or edit a route → assign a sector → create a missing sector → assign its area → create a missing area → return to the route with the completed relationships.

### 8.3 Requirements

- Preserve all information already entered on the route, sector, and area while moving through the workflow.
- Offer existing matches to help avoid duplicate sectors or areas.
- Allow entry of name and description for each new parent.
- Establish the intended memberships when the workflow is completed.
- Make newly created parents available for reuse elsewhere in the current session.
- Allow cancellation at each level without losing earlier edits to the original feature.
- Cancellation must not silently leave unwanted partially created parents or relationships; make any retained work explicit.
- Creating a sector does not require assigning it to an area.

## 9. Delete and unlink safely

Deletion and unlinking are distinct actions. Before deletion, explain its effects on geometry and relationships.

| Action | Required result |
| --- | --- |
| Delete an independent route | Remove the route point, without deleting its sector. |
| Delete an attached route | Remove its climbing route identity and sector membership, retaining an ordinary perimeter vertex so the boulder outline is unchanged. |
| Delete the remaining ordinary perimeter vertex | Remove that vertex and connect its neighbours, provided the resulting outline remains valid. |
| Delete a boulder | Remove the boulder while preserving its routes as independent points, with their details and sector memberships unchanged. |
| Delete a sector | Delete only the grouping relationship. Preserve its routes, which become unassigned to a sector, and remove its membership in any area. |
| Delete an area | Delete only the grouping relationship. Preserve its sectors, which become unassigned to an area, and preserve all route memberships within those sectors. |
| Unlink a route from a sector | Remove only that membership; preserve both objects. |
| Unlink a sector from an area | Remove only that membership; preserve both objects and the sector's routes. |
| Delete a feature created during the session | Remove the local creation and handle any dependent local edits explicitly; do not export it as deletion of an existing OSM feature. |

Additional safeguards:

- Never cascade deletion from a parent to its contents.
- Preserve unrelated OSM information and geometry shared with other features.
- If deletion cannot safely preserve affected objects, explain the issue instead of silently damaging them.
- Deleting a climbing route must preserve unrelated information that may exist on a retained node.
- Deleting a boulder means removing the mapped boulder, not merely hiding it from this application; the confirmation must make that consequence clear.
- Deletion remains undoable within the local session.

## 10. Local editing session

### 10.1 Undo and redo

Support undo and redo for:

- Geometry movement and reshaping.
- Detail edits.
- Feature creation and deletion.
- Route attachment and detachment.
- Sector and area membership changes.
- Inline creation of missing parents.

Undoing dependent actions must leave a coherent local state. For example, undoing a new boulder must not leave routes referring to nonexistent geometry.

### 10.2 Review changes

Provide a session summary showing:

- Created features.
- Modified features.
- Deleted features.
- Geometry and attachment changes.
- Sector and area membership changes.
- Validation issues requiring attention.

The contributor must be able to inspect what will be exported before downloading the changefile.

### 10.3 Discard changes

- Users can explicitly discard all local changes.
- Require confirmation before discarding a nonempty session.
- Discarding restores the unedited state and removes pending creations, deletions, and relationship changes.
- Discarded work must not unexpectedly reappear from draft recovery.
- Cancelling one unfinished action is separate from discarding the whole session.

### 10.4 Recoverable drafts — nice-to-have

If draft recovery is provided:

- Preserve local work across browser refreshes or restarts.
- Clearly offer restoration or discarding of a recovered draft.
- Preserve geometry, details, creations, deletions, and relationships together.
- Restoring a draft must not imply that its underlying OSM data is still current; changes may require review before export.

If work is not recoverable, warn before leaving an editing session where work would be lost.

### 10.5 Local versus published state

- Clearly identify edits as local and not yet published to OSM.
- Exporting a changefile must not be presented as successful publication.
- Exporting must not silently discard the editing session.

## 11. Validation and data preservation

- Prevent completion or export of invalid boulder outlines.
- Prevent silent merging or overwriting of distinct routes.
- Do not silently create conflicting sector or area memberships.
- Preserve data outside the fields and relationships intentionally edited.
- Explain likely duplicates and ambiguous or unsafe actions so the contributor can review them.
- Load the current OSM information needed to edit existing features safely.
- If required data cannot be loaded, explain which actions or export are blocked.
- If changes in OSM are detected that conflict with the local work, identify the need for review rather than silently overwriting them.
- Never silently omit intended changes from the export.
- Existing representations outside this editing scope must not be silently converted or damaged. Clearly explain unsupported operations.

## 12. Export and publication

- Export the complete local session as one `.osc` changefile.
- Include creation, detail edits, geometry edits, shared-node attachment changes, relationship changes, and deletions.
- Include the necessary related changes so the exported result represents the reviewed local state coherently.
- Clearly explain validation issues that prevent export.
- The intended publication workflow remains:

  1. Edit locally in OpenBoulderMap.
  2. Review the local change summary.
  3. Download the `.osc` file.
  4. Open it in JOSM for validation, conflict review, and upload to OpenStreetMap.

- Nothing is uploaded to OpenStreetMap automatically.

## 13. Acceptance scenarios

### A. Map a new boulder and routes

1. Draw a new boulder and edit its details.
2. Create one route on an edge and another on an existing ordinary vertex.
3. Confirm that each route is a shared perimeter node and no duplicate vertex is created by joining.
4. Enter route details and see all local changes immediately.

### B. Move, detach, and reattach a route

1. Drag an attached route.
2. Confirm that its location and the boulder outline change together.
3. Detach it and confirm that the outline remains unchanged at the moment of detachment.
4. Move the route freely without it immediately snapping back.
5. Drop it onto another edge and confirm attachment.
6. Undo and redo these actions without losing route details or membership.

### C. Protect an occupied vertex

1. Drag an independent route toward a vertex that already represents another route.
2. Confirm that joining is prevented with an explanation.
3. Confirm that neither route is overwritten or merged.

### D. Reshape and move a boulder

1. Add, move, and remove ordinary perimeter vertices.
2. Confirm that invalid outlines cannot be completed.
3. Move the whole boulder.
4. Confirm that attached routes move with it and nearby independent routes do not.
5. Confirm that route sector assignments remain unchanged.

### E. Create a hierarchy inline

1. Create a standalone route.
2. Search for its sector and create a missing sector from the linking workflow.
3. Search for that sector's area and create a missing area inline.
4. Return to the route without losing edits.
5. Confirm route → sector and sector → area membership.
6. Assign another route to the newly created sector within the same session.

### F. Reassign and unlink

1. Change a route's sector and confirm it no longer belongs to its previous sector.
2. Confirm that its geometry and boulder attachment do not change.
3. Change a sector's area and confirm that its routes remain members of that sector.
4. Unlink either membership without deleting any feature.

### G. Delete safely

1. Delete an attached route and confirm that an ordinary perimeter vertex remains.
2. Delete that vertex separately, if the resulting outline is valid.
3. Delete a boulder and confirm its remaining routes survive independently with their sector assignments.
4. Delete a sector and confirm its routes survive without sector membership.
5. Delete an area and confirm its sectors and routes survive, with only sector-to-area links removed.
6. Undo the deletions and restore a coherent state.

### H. Review, discard, and export

1. Make a mixture of geometry, detail, creation, deletion, and relationship edits.
2. Review the complete change summary.
3. Export a changefile representing all reviewed edits for JOSM.
4. Confirm the app does not claim the changes have been published.
5. Discard the local session and confirm no pending edits remain.

### I. Recover a draft — if included

1. Make edits and refresh or reopen the browser.
2. Restore the complete draft or explicitly discard it.
3. Confirm discarded edits do not reappear.

## 14. Scope boundaries

The following are not required by this feature request:

- Direct publishing to OpenStreetMap or OSM account authentication.
- Creating point boulders or a dedicated point-to-area conversion workflow.
- Drawing or editing sector and area geometries.
- Assigning boulders to sectors.
- Standalone creation of sectors or areas.
- Selecting parents by clicking the map.
- Automatically assigning all routes on a boulder to the same sector.
- Automatically sliding an attached route along an unchanged outline; users detach it when independent movement is needed.
- Merging distinct climbing routes.
- New photograph-upload functionality.
- Mobile-first or touch-optimised editing.
- General-purpose editing of unrelated OSM features.

Recoverable drafts are desirable but are not a blocker for the core release. Explicitly discarding local changes, undo/redo, safe deletion, and review before export are part of the core scope.
