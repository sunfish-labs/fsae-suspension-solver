# Next to do

Ordered by importance: things that could mislead a student or block the team first, then accuracy of the model,
then extra features, then housekeeping. Team-specific design fixes live in `private/` (never published).

1. **Measure the car (validation/MEASURING.md).** Every model is now cross-checked by an independent one; what
   is left is reality. The bump sweep and the twist test on corner scales are the cheapest and check the most
   (kinematics, motion ratio, springs and bars). Put the results in `private/validation/`. A bench wheel-rate test
   also settles whether `wheel_rate` or `wheel_rate_preload` matches your car.
2. **Pushrod mount with a gusset or bracket.** The bending and fatigue checks treat the leg as a bare tube, and
   both examples fail there (as most designs with the mount off the node will). Let the user describe the gusset
   or bracket (plate size, weld length) so the check can say whether it is enough.
3. **Fatigue from logged loads.** Once the car logs damper or strain data, count the cycles (rainflow) and add up
   the damage (Miner) instead of the stated-cycle screen.
4. **Housekeeping.** Create the missing `v0.9.0` tag on GitHub (Releases -> Draft a new release -> tag `v0.9.0`,
   target commit `e3fee2a`): the tag workflow's token may not tag a commit whose workflow files differ from today's.
   Empty the `_to_delete/` folder on the desktop copy.

## Done recently

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
