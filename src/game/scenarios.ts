// Scenario catalogue: the single built-in blank canvas plus the shape shared
// with user-saved scenarios (see `scenarioStorage.ts`).

import type { Edge, Node } from 'reactflow';
import type { MediaFunctionNodeData } from '../components/canvas/MediaFunctionNode';
import type { MediaConfig } from '../engine/mxlGrainIndex';
import { LEVELS, type Level } from './levels';

/** A scenario is a level's metadata plus the graph it starts from. */
export interface Scenario extends Level {
  nodes: Node<MediaFunctionNodeData>[];
  edges: Edge[];
  /** A/V format the scenario was built with; older saves have none and keep the current format. */
  media?: MediaConfig;
  /** Built-in scenarios ship with the app; saved ones live in localStorage. */
  builtIn: boolean;
}

export const BUILTIN_SCENARIOS: Scenario[] = LEVELS.map((level) => ({ ...level, nodes: [], edges: [], builtIn: true }));

export const DEFAULT_SCENARIO_ID = BUILTIN_SCENARIOS[0].id;
