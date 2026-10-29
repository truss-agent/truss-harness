import { execFileSync } from "node:child_process";

// Checkout must fetch origin/master first. Fail closed on missing history/refs.
execFileSync(
  "git",
  ["merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/master"],
  { stdio: "inherit" },
);
console.log("Release source is reachable from merged master.");
