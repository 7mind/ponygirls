// Test-only resolution for the actual Baboon TypeScript sources. Production
// bundlers already resolve emitted .js specifiers to their .ts source files.
// Never redirect arbitrary application imports or replace an existing .js file.
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "rolldown/experimental";

const generated = new URL("../generated/typescript/", import.meta.url).href;
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith(generated) && url.endsWith(".ts")) {
      // Baboon runtime includes real TS enums, beyond Node's strip-only mode.
      return { format: "module", source: transformSync(fileURLToPath(url), readFileSync(new URL(url), "utf8"),
        { lang: "ts", target: "es2022" }).code, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error.code !== "ERR_MODULE_NOT_FOUND" || !context.parentURL || !specifier.endsWith(".js")) throw error;
      const source = new URL(specifier, context.parentURL);
      if (!source.href.startsWith(generated)) throw error;
      source.pathname = source.pathname.slice(0, -3) + ".ts";
      if (!existsSync(fileURLToPath(source))) throw error;
      return { url: source.href, shortCircuit: true };
    }
  },
});
