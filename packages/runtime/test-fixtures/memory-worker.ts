import { FileWorkspaceStorageOwnership } from "../src/storage-ownership.js";
import { join } from "node:path";
import { FileWorkspaceMemoryStore } from "../src/memory.js";
const [, , root, id] = process.argv;
if (!root || !id) throw new Error("Expected workspace and task id");
const store = new FileWorkspaceMemoryStore(root);
if (id === "hold") {
  await new FileWorkspaceStorageOwnership().run(
    join(root, "state"),
    async () => {
      process.stdout.write("locked\n");
      await new Promise<void>(() => {
        setInterval(() => {}, 1000);
      });
    },
  );
}
await store.upsertTask({
  id,
  sessionId: id,
  objective: id,
  status: "completed",
  startedAt: "2026-01-01",
  tools: [],
  modifiedFiles: [id],
});
