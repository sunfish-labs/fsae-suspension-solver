// 68_engines.js - Engine starting points for the drivetrain (Car view → Drivetrain). Gearing from published specs;
// the torque curve of an FSAE engine depends on the 20 mm restrictor and the team's intake, exhaust and tune, so a
// curve marked "estimate" is a placeholder until the engine is on a dyno.
const ENGINES = {
  gsxr750_2008: {
    label: "2008 Suzuki GSX-R750 (K8)",
    name: "2008 Suzuki GSX-R750 (K8), 20 mm restrictor: torque curve ESTIMATED, replace with dyno data",
    // crank torque, N m. Estimate: the stock curve's shape (86.3 N m at 11,200 rpm, 110 kW at 12,800 rpm unrestricted)
    // capped by choked flow through a 20 mm restrictor (about 0.075 kg/s of air, roughly 62-67 kW at the crank)
    torque_curve: [
      [4000, 45],
      [5000, 52],
      [6000, 57],
      [7000, 61],
      [8000, 64],
      [9000, 65],
      [10000, 62],
      [11000, 56],
      [12000, 50],
      [13000, 44],
    ],
    redline: 13000,
    launch_rpm: 7500,
    // primary 1.974 and gears 1-5 from Driven's '06-'10 GSX-R gear chart; 6th from the published spec (1.20); check
    // all of them against the service manual
    primary: 1.974,
    gears: [2.786, 2.053, 1.714, 1.5, 1.348, 1.2],
    final: 45 / 17, // stock 17 / 45 sprockets; FSAE cars usually run much shorter: see the final-drive sweep
    specs: "749 cc inline four, 70 × 48.7 mm, 12.5:1; stock (unrestricted) 110 kW at 12,800 rpm and 86.3 N m at 11,200 rpm",
  },
};
// an engine's numbers onto a drivetrain (keeps the car's own efficiency, drag, rolling and the like)
function engineInto(d, id) {
  const e = ENGINES[id];
  return Object.assign(d || {}, {
    name: e.name,
    torque_curve: e.torque_curve.map(p => p.slice()),
    redline: e.redline,
    launch_rpm: e.launch_rpm,
    primary: e.primary,
    gears: e.gears.slice(),
    final: Math.round(e.final * 1000) / 1000,
  });
}
