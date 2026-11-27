/**
 * Loaded only by live-calibration.ts (`pi -e`): declares the calibration
 * sample as tools of the run, so the provider counts their declarations.
 * The measuring request asks for one word; a sample tool that is called
 * anyway ends the turn.
 */
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { CORPUS_VARIABLE, calibrationDeclarations, parseCorpus } from "../src/calibration.ts";

export default function calibrationProbe(pi: ExtensionAPI): void {
  const path = process.env[CORPUS_VARIABLE];
  if (path === undefined || path === "") throw new Error(`${CORPUS_VARIABLE} must name the calibration corpus`);
  for (const declaration of calibrationDeclarations(parseCorpus(readFileSync(path, "utf8")))) {
    pi.registerTool({
      name: declaration.name,
      label: declaration.name,
      description: declaration.description,
      parameters: declaration.parameters as TSchema,
      execute: async () => ({ content: [{ type: "text", text: "A calibration sample; it does nothing." }], details: undefined, terminate: true }),
    });
  }
}
