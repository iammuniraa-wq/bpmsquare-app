# Estimates: scoping by template, real-looking 3D, and design attributes — plan

> Owner asks, 2026-10-24. Not built. Complements `docs/design/estimator-unification-and-inbox.md`.

## 1. Templates as a scoping choice (yes)

Templates are already per-workspace rows, so a workspace sees only the templates it has. Make that deliberate:
- Scoping (Tenant Studio and the tenant editor) gets **"Estimating: product lines"**, a multi-select of starter packs (fence, precast, floor tiles,
  porta cabin, later others). Choosing "porta cabin" installs only that locked starter and the picker shows only it; with one template the picker
  is skipped and the workspace opens straight on it.
- An admin can also switch a template off for the workspace (`is_active`); nav labels, the Inbox "Create estimate" choices, AI pick candidates and
  the customer request page all read the same active list, so nothing else needs configuring.
- Starter packs are data (`starterTemplates*.ts`), so a new product line is a new pack, not a code branch.

## 2. Real-looking 3D: options

| Option | What it is | Looks | Cost and effort | Fits |
|---|---|---|---|---|
| **A. Keep three.js, make it physically based** | Same renderer; add PBR materials (metal, concrete, glazing, tile, wood) from free CC0 texture sets (Poly Haven, ambientCG), image-based lighting from a CC0 HDRI sky, soft shadows, ambient occlusion, tone mapping, a ground and sky | Photo-real enough for a sales preview | No licences; small to medium | Parametric geometry (our counts drive the model) |
| **B. glTF component library** | Real modelled parts (gates, doors, windows, hinges, tiles, furniture) loaded into the scene and placed by our rules; sourced from CC0 libraries (Poly Haven, Kenney) or modelled by us | Detailed hero parts | Per-model licences if from Sketchfab (API available, licence varies); medium | Standard components that repeat |
| **C. Configurator platforms with an API** (Threekit, Vectary, Zakeke, Autodesk Platform Services Viewer) | Hosted 3D, material and variant engines | Very polished; APS reads real DWG, DXF and RVT | Subscription, vendor lock-in, harder to tie to our parametric counts | Product configurators with fixed models; **APS** is useful to show a customer's own CAD drawing |
| **D. Pixel streaming (Unreal)** | Server-rendered cinematic | Best | Heavy infrastructure | Not now |

**Recommendation: A plus B.** It stays on the stack we have, costs nothing in licences, and our geometry (posts, tiles, units) stays the single
source of truth for both the picture and the bill of materials. Add APS later only if clients want to view their own DWG or DXF inside BPMSquare.

## 3. Design attributes (flexible: yes, it makes sense)

A template declares **design attributes** as ordinary inputs (colour, finish, mesh type, cladding, roof style, tile pattern) and a small
**attribute to visual map** as data: each option points to a material (colour and texture set), a glTF part, or a visibility switch. The renderer
reads the map; the BOM rules read the same input, so one choice changes both the picture and the parts. A client adds an attribute by adding an
input and map rows in Settings > Estimate templates (copy of a locked starter), with no code. Custom textures are uploaded to a private storage
folder per workspace. Limits: the geometry module decides what can be drawn (a fence can show mesh type and coating, not a new building shape);
a new shape still needs a layout module.

## 4. Build slice to prove it (first)

Floor tiles in 3D with real porcelain, marble and wood textures and a lit room; the chain-link fence with galvanised mesh, concrete bases and a
grass and sky environment; a porta cabin with cladding, window glass and roof materials; the attribute map editor for colour and finish; a
shareable view for the customer request page later. Quality gates: a frame-rate floor on a mid phone, lazy loading of textures, reduced-motion
respected, light and dark themes.
