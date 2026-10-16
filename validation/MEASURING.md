# Measuring your own car or rig

The models are checked against each other and against hand calculations (see `README.md` here). What none of
that can show is whether the real parts behave like the model: joint play, frame and bracket flex, a damper eye
that is 3 mm off its drawing. These five tests need only shop tools. Each one gives numbers that
`tests/test_reference.py` compares against the solver on every run. Keep files for your own car in
`private/validation/`, which is never published.

| Test | Tools | Checks |
|---|---|---|
| 1. Bump sweep | jack, ruler or dial gauge, digital inclinometer, toe plates or string, calipers | camber, toe, caster and damper length over wheel travel (kinematics, motion ratio) |
| 2. Spring force at ride height | tape or calipers, the spring's free length | static spring force (motion ratio, corner weight) |
| 3. Wheel rate | corner scale or bathroom scale, dial gauge, ballast | wheel rate (spring rate x motion ratio squared) |
| 4. Twist test | four corner scales, a shim plate 10-20 mm thick | roll stiffness of the two axles in series, bars included |
| 5. Skidpad with damper pots | linear pots on the dampers, an accelerometer or the logger | roll on the springs, front and rear, per g |

## 1. Bump sweep (no spring)

Take the spring off, or fit a solid rod of the same eye-to-eye length in place of the damper and remove it for
each reading. Set the corner at ride height and zero everything there. Move the wheel in 5 mm steps through
the travel, lifting under the hub or the lower ball joint. At each step write down:

- wheel travel (hub height change, mm; + is bump);
- camber (inclinometer on the hub face or the brake disc);
- toe (toe plates, or a string line and a ruler at the rim front and rear);
- damper length, center to center of the eyes (calipers).

Put the readings in a spreadsheet, one row per step, and save it as CSV:

    travel,camber,toe,damper_len
    -25,-2.71,0.06,213.8
    0,-1.50,0.00,193.6
    25,-0.52,-0.09,173.9

    python3 validation/tools/rig_to_reference.py sweep.csv --design private/our_front.json --relative \
        --source "bump sweep, 2026-11-02, inclinometer +-0.05 deg" > private/validation/bump_sweep.json

`--relative` compares changes from ride height, so a static camber or toe that is not exactly the design's does
not count as a failure. Leave it off when you trust the static setting.

## 2. Spring force at ride height

With the car at ride height and the driver in, measure the installed spring length. Spring force = spring rate x
(free length - installed length), plus any preload from the collar. Compare it with the solver's
`static_spring_force` (it uses the corner weight from the design, so use the same mass and weight distribution):

    ... --at static_spring_force=652

## 3. Wheel rate

Put the corner on a scale. Read the hub height (dial gauge on the upright, base on the frame or the floor) and the
scale load. Add a known load to that corner (ballast, or pull down on the frame with a ratchet strap to a floor
anchor) and read both again. Wheel rate = load change / hub height change, after you subtract the tire's own
squash: hub height change = frame-to-hub change, not floor-to-hub. Compare with `wheel_rate`:

    ... --at wheel_rate=33.6

The solver's wheel rate is spring rate x motion ratio squared. A measurement also picks up the spring's preload
times the motion ratio's change with travel, which adds about 1-2 % on the example corners (more for a strongly
rising rocker), so compare it with `wheel_rate_preload` (both are reported), and friction in the joints and damper:
measure both loading and unloading and take the average.

## 4. Twist test on corner scales

Level the car on four corner scales, driver in, bars connected. Note the four loads. Put a shim of height d (mm)
under one front wheel, bounce the car to settle it, and read the four loads again. The rear wheels' loads move by
+-dF (one up, one down; take half the difference of their changes). Then

    K_warp = dF x rear track (m) / (57.3 x d / front track (mm))     [Nm/deg]

is the front and rear roll stiffnesses in series (springs, bars and tires). The solver's car balance reports it
as `K_warp`. Write the case by hand:

    {"name": "twist test", "source": "corner scales, 15 mm shim, 2026-11-02",
     "car": "private/our_car.json", "car_balance": {"K_warp": [205, 15]}}

Repeat with the bars disconnected to check the springs alone, and with each bar on its own to check each bar.

## 5. Skidpad with damper pots

Log damper travel at all four corners and lateral acceleration on a steady skidpad. For each axle, roll on the
springs = (outer damper compression - inner damper compression) / motion ratio / track (rad), per g of lateral
acceleration. Compare with `roll_susp_f` and `roll_susp_r` (deg/g). The body roll the car balance calls the roll
gradient adds the tires' squash, so a ride-height laser to the ground reads more than the pots.
