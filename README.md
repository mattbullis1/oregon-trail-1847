# Oregon Trail 3D — Lone Passage

A real-time 3D remake of the 1978 MECC **Oregon Trail**, built for the browser.
Mouse and touch only — there is no keyboard input anywhere in the game.

**Play it live:** https://mattbullis1.github.io/oregon-trail-3d/

**Source:** https://github.com/mattbullis1/oregon-trail-3d

---

## What this is

The original 1978 BASIC listing by Bill Heinemann and Don Rawitsch was a text
prompt loop. This is a full modern remake: a continuous 3D world rendered live
in WebGL, a named family with individual health, twelve resources to balance,
weather and terrain systems, and eighteen real landmarks at their true
mileposts — with no keyboard required at any point.

Everything you see is **generated in code**. There are no image textures, no
model files, and no audio assets. Terrain is displaced noise, the sky is a
hand-written gradient shader, the wagon and oxen are built from primitives, and
rain and snow are animated particle fields.

## The 1978 core, preserved

The simulation skeleton is the published original, not an approximation:

| Original mechanic | Where it lives |
|---|---|
| Travel rate `200 + (A-220)/5 + 10·RND` | `baseTravelMiles()` |
| The 16-event hazard table | `EVENT_IDS`, `eventIndexForRoll()` |
| Illness severity roll (`10+35(E-1)`, `100-40/4^(E-1)`) | `illnessCheck()` |
| Rider encounter curve `q=(x²+72)/(x²+12)` | `riderProbability()` |
| Mountain incident curve | `mountainProbability()` |
| South Pass / Blue Mountains single crossings | `mountainPhase()` |
| Arrival calendar arithmetic | `addDays()`, `checkArrival()` |
| Per-turn action menu (fort / hunt / continue) | `beginTurn()`, `chooseAction()` |
| Per-turn meal (poorly / moderately / well) | `chooseMeal()` |
| 2,040 miles, 5 of 5 family, $200 wagon, $700 to spend | `constants` in `engine.js` |

## What the remake adds

- **A named family** — Elias, Martha, Caleb, Susannah and Tobias, each with
  their own health that degrades, recovers, and can fail.
- **Twelve resources** — oxen, food, ammunition, clothing, medicine, tools,
  spare parts, water, animal feed, blankets, coffee, books. Each has a real
  effect; none is decoration.
- **Two decisions every single turn** — first an action (stop at the fort when
  one is in reach, hunt, or press on), then the family's meal (poorly,
  moderately, or well). Only then does the wagon roll. No amount of clicking
  "travel" skips the decisions.
- **A five-second journey between turns** — the camera rolls with the wagon while
  the odometer, calendar and event log advance, so travel is a scene rather than
  a button press.
- **Pace and meals as the core gamble** — fast paces cover far more ground but
  wear down the team, sicken the family, and break the wagon. Gentle driving is
  safe but the passes close in early November.
- **Weather and terrain** — seven weather states and eight terrain bands, each
  changing the lighting, the sky, and how fast you can travel.
- **A hunting minigame** — click animals to fire. Accuracy decides how much meat
  you carry home.
- **River crossings** — ford, ferry, or caulk and float, each with real risk.
- **Starvation that bites** — a wagon below thirteen pounds of food starves
  where it stands, exactly as the 1978 listing had it. A fort purchase or a
  good hunt earlier in the turn is the only thing that can save it.
- **Water that refills** — springs, forts and towns fill the kegs; the dry
  reaches between them are where thirst decides the journey.
- **A trail journal** and a scored ending.

## Difficulty

Survival depends almost entirely on outfitting and pace. Measured over 400
simulated runs per configuration:

| Pace | Lean wagon | Well-stocked wagon |
|---|---|---|
| Gentle | ~10% arrive (most die of winter) | ~61% arrive |
| Steady | ~81% arrive | ~91% arrive |
| Brisk | ~87% arrive | ~94% arrive |
| Gruelling | ~91% arrive | ~95% arrive |

## Project layout

```
index.html            markup only; every element is wired up in app.js
css/style.css         the entire visual language
js/engine.js          deterministic simulation core — no DOM, no rendering
js/world.js           the 3D world: terrain, sky, wagon, oxen, weather
js/app.js             presentation controller: screens, HUD, click handling
js/vendor/three.module.js   Three.js r160, vendored for offline use
tools/test.mjs        51 engine tests (node tools/test.mjs)
tools/smoke.mjs       47 browser checks driving the game by clicks
tools/playthrough.mjs one complete click-only run through to the ending
tools/shots.mjs       screenshot capture for visual review
tools/perf.mjs        frame-cost breakdown
```

## Running and verifying

```bash
# Play it locally (no build step, no dependencies)
npm start          # serves the game at http://127.0.0.1:8099/

# Engine correctness (pure logic, no browser needed)
node tools/test.mjs

# Full browser verification: boots WebGL in headless Chrome and plays by clicking
node tools/smoke.mjs

# Capture screenshots of every screen and weather state
node tools/shots.mjs
```

The browser tests launch real Chrome, verify the WebGL context is live and that
geometry is actually being drawn, then click through outfitting, the action and
meal menus, a full five-second journey, fort trading, hunting, encounters, and
the journal — asserting that no uncaught exception ever fires. The playthrough
script drives the same UI through an entire winning run.

## Notes

- The simulation is seeded (`mulberry32`), so runs are reproducible and testable.
- Food is consumed per day, not per meal, so "poorly / moderately / well" sets a
  daily ration rate. A meal only heals and lifts morale when the barrel can
  cover the whole segment; a shortfall costs health instead — and an empty
  barrel ends the run.
- The renderer adapts quality automatically: if frames run slow it sheds
  precipitation, then shadows, then resolution, in that order.
- Headless Chrome draws WebGL through SwiftShader, a CPU rasteriser, so frame
  rates measured in the test harness describe the harness, not the game. The
  scene is ~30,000 triangles and runs smoothly on any real GPU.

## Credits

Original concept and simulation by **Bill Heinemann** (1971) and **Don Rawitsch**,
with research and materials from the **Minnesota Educational Computing
Consortium**. This remake preserves their mechanics and reimagines the
presentation.
