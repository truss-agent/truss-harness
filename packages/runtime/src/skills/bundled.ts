import { superpowersBundle } from "./policy.js";
import { StaticSkillSource } from "./static-source.js";
import { superpowersPack } from "./superpowers-data.generated.js";

export { superpowersPack };

/** The pinned, MIT-licensed Superpowers pack as trusted bundled skills. */
export function createSuperpowersSkillSource(): StaticSkillSource {
  return new StaticSkillSource({
    prefix: superpowersBundle,
    source: "bundled",
    bundle: superpowersBundle,
    trusted: true,
    files: superpowersPack.files,
  });
}
