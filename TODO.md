# Next to do

Ordered by importance: things that could mislead a student or block the team first, then accuracy of the model,
then extra features, then housekeeping. Team-specific design fixes live in `private/` (never published).

1. **Frame torsional stiffness** from the frame's tube centerlines (a 3D frame solved in the browser), and what it
   does to the LLTD.
2. **Rocker, the next step:** an aluminum fatigue screen (S-N data for 6061-T6 / 7075-T6), the anti-roll bar link's
   load when the bar is driven from the rocker, and the pivot bearing's own rating.
3. **More rules checks** once there is data for them: the lower side impact structure height, the 5th percentile
   template and cockpit openings (F, T.1 and IN.7) against a loaded frame, ground clearance at full bump and pitch,
   and the 2027 Q&A.
4. **Housekeeping.** Create the missing `v0.9.0` tag on GitHub (Releases -> Draft a new release -> tag `v0.9.0`,
   target commit `e3fee2a`): the tag workflow's token may not tag a commit whose workflow files differ from today's.
   Empty the `_to_delete/` folder on the desktop copy (old sync bundles only).

## When there is a car (or a test corner)

- **Measure it (validation/MEASURING.md).** Every model is cross-checked by an independent one; what is left is
  reality. The bump sweep and the twist test on corner scales are the cheapest and check the most. A single corner
  built from plywood or 3D-printed parts on a bench works for the bump sweep and the motion ratio.
- **Wheel rate with or without the preload term:** a bench wheel-rate test settles whether `wheel_rate` or
  `wheel_rate_preload` matches.
- **Fatigue from logged loads:** once the car logs damper or strain data, count the cycles (rainflow) and add up the
  damage (Miner) instead of the stated-cycle screen.

## Done recently

- Rocker strength: pin holes (bearing, tear-out) and arm bending from the plates' sizes and alloy (1.11.0)
- Driver template and roll hoops in side view: seven more rules checks (F.5.6 to F.5.9) and a drawing (1.10.0)
- Rules check against the Formula SAE Rules 2027 (IC) by rule number: twelve automatic checks and a checklist (1.9.0)
- Vehicle layout (mass, CG, inertia from a parts list, boxes in 3D, clearance to the parts) and the drivetrain's
  acceleration run; a Settings panel with the coordinates as shown, simple / detailed inputs and result tabs (1.8.0)
- Pushrod mount reinforcement: a gusset plate along the leg (built-up section searched along the leg, plus the
  weld where it ends in the fatigue screen) or a bracket into the ball-joint node; part loads for FEA (every force
  on the upright, wishbones and rocker, per case, in the CAD axes) from the app and the command line (1.7.0)
- Pickup tabs (bearing, tear-out, net section, weld throat) and a fatigue screen at stated cycle counts (tubes by
  Goodman on the S-N line, welds by IIW class); the wheel rate with the preload term reported beside the usual one;
  CI on Ubuntu 26.04 (1.6.0)
- Clearance to the chassis model for the tire (exact for the drawn shape), the upright and rocker as drawn, the
  caliper envelope and the halfshaft; caliper and halfshaft drawn in 3D and in the CAD export; each joint's own
  misalignment limit and the ball joints' alignment travel set in the Packaging tab (1.5.0)
- GitHub Pages builds and publishes the site from Actions on every push; the built `ui/index.html` is no longer
  committed (`python3 susp_solver.py ui` builds it)
- Independent models for loads (displacement method, five corner layouts) and the car balance (full-car matrix
  model); the car balance now includes the tires squashing under the geometric load transfer (about 10 % more roll
  on the example cars); measurement guide and rig-to-reference script (1.4.0)
- Drawings checked by eye after the mirror fix (1.3.1); chassis tools on a real laptop: a 410k-triangle frame loads in
  0.2 s, 60 fps, clearance check 1.5 s (1.3.1)
- Dual-rate springs and bump stops; anti-roll bar linkage geometry; tire load sensitivity and the limit balance (1.3.0)
