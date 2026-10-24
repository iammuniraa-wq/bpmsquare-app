# Texture credits

Every texture set in this folder is released under CC0 1.0 (public domain); no attribution is required, it is
recorded here for traceability. Files are the 1K JPG maps resized to at most 1024 px (JPEG, quality about 78);
`diffuse.jpg` is the colour map, `normal.jpg` the OpenGL-convention normal map, `rough.jpg` the roughness map as grey.
Where a set has no `normal.jpg` the surface is meant to read flat (polished stone, porcelain).

| Folder (material key) | Source id | Licence | Notes |
|---|---|---|---|
| concrete_precast | Poly Haven `concrete_wall_007` | CC0 | colour desaturated to 30 % |
| wood_oak | Poly Haven `oak_veneer_01` | CC0 | |
| roof_sheet | Poly Haven `corrugated_iron_02` | CC0 | |
| ground_grass | Poly Haven `grass_ground` | CC0 | tinted greener at render time |
| ground_paving | Poly Haven `concrete_pavement_02` | CC0 | |
| ground_sand | Poly Haven `sand_01` | CC0 | |
| marble_white | ambientCG `Marble021` | CC0 | no normal map |
| porcelain_white | ambientCG `Porcelain001` | CC0 | no normal map |
| porcelain_grey | ambientCG `Terrazzo001` | CC0 | no normal map |
| terrazzo | ambientCG `Terrazzo013` | CC0 | no normal map |
| ceramic_beige | ambientCG `Travertine009` | CC0 | no normal map |

Sources: https://polyhaven.com/textures and https://ambientcg.com. The catalogue (`src/lib/estimator/materialCatalog.ts`)
carries the same ids in each material's `source` field.
