import type {
  RuntimeServiceHandshakeValidation,
  RuntimeServiceResult,
} from "../protocol-contracts.js";

/**
 * Checks only the transport contract. Callers still decide whether a selected
 * local executable or a managed artifact is trusted to run on the device.
 */
export function validateRuntimeServiceHandshake(
  result: RuntimeServiceResult,
  clientProtocolVersions: readonly number[],
): RuntimeServiceHandshakeValidation {
  const protocolVersion = result.protocolVersion;
  if (
    typeof protocolVersion !== "number" ||
    !Number.isInteger(protocolVersion) ||
    !clientProtocolVersions.includes(protocolVersion)
  )
    return {
      compatible: false,
      reason: "The service did not negotiate a compatible protocol version.",
    };
  const identity = result.server?.identity;
  if (
    !identity ||
    identity.runtime.packageName !== "@truss-harness/runtime" ||
    !identity.runtime.version.trim() ||
    !identity.protocolVersions.includes(protocolVersion)
  )
    return {
      compatible: false,
      reason:
        "The service did not provide a compatible Truss runtime identity.",
    };
  return {
    compatible: true,
    protocolVersion,
    runtime: identity.runtime,
  };
}
