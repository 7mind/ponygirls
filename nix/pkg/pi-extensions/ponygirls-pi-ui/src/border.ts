/**
 * Positions of the ponygirls badges on the editor's bottom-left border, passed
 * as setWidget's `order`: work running for the user first, then what waits for
 * the user, then ambient monitors. A fixed place per badge, whatever the order
 * in which the extensions publish them.
 */
export const BORDER_ORDER = {
  goal: 10,
  agents: 20,
  tasks: 30,
  decisions: 40,
  cuckoo: 50,
  historian: 60,
  archive: 70,
  codegraph: 80,
} as const;
