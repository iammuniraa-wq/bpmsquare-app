# Estimates in real-looking 3D: build plan (2026-10-24)

Owner: build real-looking 3D for fences, tiles, porta cabins (rooms with equipment) and precast, using outside CC0 textures and parts, with
design attributes a client can add. Decisions are in `estimator-3d-and-scoping.md`. Piece geometry stays the single source of truth for
picture and BOM.

## Contract (already in the code)

- `src/lib/estimator/materialCatalog.ts`: the materials (colour, roughness, metalness, texture set under `public/textures/<key>/`).
- `src/components/estimator/viewer/materialLibrary.ts`: one library per scene, lazy textures, flat colour fallback.
- `Piece.slot` + `GeometryModule.slots` (`DesignSlot`): the parts a design attribute can repaint. `Piece.kind = "equip"` with `item`, `room`.
- `TemplateInput.paints` + `TemplateInputOption.visual`: a select input repaints a slot; `resolveVisuals()` gives slot to material.
- `visuals` prop on `GeometryView`, `VillaCard`, `BuildingViewer`, `FloorPreview`.
- `viewer/equipmentMeshes.ts`: `buildEquipment(piece, lib)`, called by `pieceMeshes.ts` for `equip` pieces.

## Work split (disjoint files)

1. **Renderer, precast, fence:** PBR scene (sky, soft shadows, environment, tone mapping), textures, `ViewerScene`, `pieceMeshes`,
   `BuildingViewer`, `precastVilla`, `chainlinkFence`.
2. **Tiles:** `tilesFloor` + a lit 3D room with real tile textures, 2D/3D toggle in `FloorPreview`.
3. **Porta cabin:** rooms and equipment in `portaCabin`, its starter template and the BOM, `equipmentMeshes`.
4. **Design attributes:** `visuals`, the template editor (attribute to slot and option to material), the input form swatches, the workspace
   wiring, attributes added to every starter template.

Deferred (stated): uploading a workspace's own texture images (colours and the catalogue are in); loading Autodesk Platform Services for a
client's own DWG.
