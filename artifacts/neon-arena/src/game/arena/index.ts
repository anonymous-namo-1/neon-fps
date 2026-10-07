import { buildColdStorage } from './coldstore';
import { buildGrid } from './grid';
import { buildReactor } from './reactor';
import type { ArenaMeta } from './builder';

export {
  ArenaBuilder,
  surfaceHeightAt,
  type Arena,
  type ArenaMeta,
  type ArenaTheme,
} from './builder';

/** Every playable map, in the order they appear on the select screen. */
export const ARENAS: ArenaMeta[] = [
  {
    id: 'grid',
    name: 'THE GRID',
    tagline: 'Open pit. Long sightlines, central high ground.',
    swatch: [0x22e0ff, 0xff2d78],
    build: buildGrid,
  },
  {
    id: 'reactor',
    name: 'REACTOR',
    tagline: 'Radial. The stack splits the room -- keep orbiting.',
    swatch: [0xff7a1a, 0xff2b2b],
    build: buildReactor,
  },
  {
    id: 'coldstore',
    name: 'COLD STORAGE',
    tagline: 'Container maze. Blind corners, brutal up close.',
    swatch: [0x7fe8ff, 0x8b7bff],
    build: buildColdStorage,
  },
];

export const DEFAULT_ARENA_ID = 'grid';

export function arenaMeta(id: string): ArenaMeta {
  return ARENAS.find((a) => a.id === id) ?? ARENAS[0]!;
}
