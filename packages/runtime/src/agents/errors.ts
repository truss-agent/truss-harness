export class AgentCoordinatorError extends Error {
  constructor(
    readonly code: "conflict" | "invalid_profile" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "AgentCoordinatorError";
  }
}
