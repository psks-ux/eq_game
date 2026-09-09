/**
 * Drill registry: imports every drill engine and exposes them by id.
 * The only place that knows the full list of drill modules.
 */

import * as matrixForge from './matrixForge.js';
import * as ruleMiner from './ruleMiner.js';
import * as nback from './nback.js';
import * as corsi from './corsi.js';
import * as mentalRotation from './mentalRotation.js';
import * as paperFolding from './paperFolding.js';
import * as relationalIntegration from './relationalIntegration.js';
import * as setShifting from './setShifting.js';
import * as sequenceExtrapolation from './sequenceExtrapolation.js';
import * as oddOneOut from './oddOneOut.js';
import * as constraintGrid from './constraintGrid.js';
import * as flankerControl from './flankerControl.js';
import * as speedDiscrimination from './speedDiscrimination.js';

/** All thirteen drill engines, in curriculum introduction order. */
export const DRILL_MODULES = [
  matrixForge,
  ruleMiner,
  nback,
  corsi,
  mentalRotation,
  paperFolding,
  relationalIntegration,
  setShifting,
  sequenceExtrapolation,
  oddOneOut,
  constraintGrid,
  flankerControl,
  speedDiscrimination
];

const BY_ID = new Map();
for (const mod of DRILL_MODULES) {
  if (mod && typeof mod.id === 'string' && mod.id.length > 0) BY_ID.set(mod.id, mod);
}

/**
 * Look up a drill engine by its id. Throws with the full list of known ids rather than
 * returning undefined, because a missing drill is a wiring bug, not a runtime state.
 */
export function drillById(id) {
  const mod = typeof id === 'string' ? BY_ID.get(id) : undefined;
  if (!mod) {
    const known = Array.from(BY_ID.keys()).join(', ');
    throw new Error(`Unknown drill id: ${String(id)}. Known drill ids: ${known}`);
  }
  return mod;
}
