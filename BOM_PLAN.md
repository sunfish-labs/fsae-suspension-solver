# Bill of materials with costs: plan

Goal: the team sees what the car costs to build, explores cheaper options against the design checks, and tracks
what is planned, ordered and received, in the same tool and the same car file as the design.

## Data: in the car file
`"bom": [ {system, part, pn, qty, unit_cost, source, status, note, auto?} ]` at the car level (not per corner), so it
versions with the design and stays private with it (`private/`, never committed). Systems follow the FSAE cost
report's: Brakes, Engine & drivetrain, Frame & body, Electrical, Steering, Suspension, Wheels & tires,
Miscellaneous. Status: planned → ordered → received. Older files without `bom` open unchanged; the Python side
ignores the block until phase 4.

## Phases
1. **Manual BOM (done, 1.35.0).** Car view → Bill of materials: rows typed by the team, quantity × unit cost,
   totals overall, by status and by system, CSV download, undo, saved in the car file. `ui/src/69_bom.js`.
2. **Rows the design fills in** (`auto: true`, quantity from the design, cost typed once): suspension tubes by size
   with cut lengths (from the hardpoints), rod ends and ball joints (count and rating from `members`), bolts, tabs,
   dampers and springs, brake parts from `brake_system`, engine from the drivetrain. Quantities update when the design
   changes; costs stay. A "what changed since last order" note when a quantity moves.
2b. **CSV import (done, 1.36.0):** Bill of materials → Import a CSV.
3. **Explore:** a parts catalog (`private/parts_catalog.json`: part, rating, mass, cost, source) so picking a cheaper
   rod end updates the BOM and re-runs the strength checks in one go; cost vs FOS side by side. Import the team's
   existing list (`private/parts_list_cheapest_2026-10-17.csv`) as the first catalog.
3b. **Cost report starter (done, 1.37.0):** CSV by FSAE system with make / buy and subtotals.
4. **Reports:** BOM sheet in the Excel export and the design report; Python `bom car.json` for the CLI; FSAE cost
   report categories and its make/buy split.
5. **Tracking extras:** order date, vendor, lead time, and a link from each row to its tech-inspection tracker item.
