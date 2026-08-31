import type { Options } from "tsup";

/** Shared tsup options for every library package; callers pass their own `entry`. */
export function defineLibConfig(options: Pick<Options, "entry"> & Partial<Options>): Options {
  return {
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "node18",
    splitting: false,
    ...options,
  };
}
