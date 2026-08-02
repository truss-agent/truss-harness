# @truss-harness/agent-host

Provider-aware host composition for isolated Truss agent runtimes.

`@truss-harness/agent-host` bridges the provider-neutral runtime contracts to
host-owned concerns: model adapters, credential resolution, tool approval, and
MCP process lifecycle. Each `AgentProfile` selects a provider binding without
putting a credential value in the profile or in runtime events.

The default registry provides separate bindings for Ollama, generic
OpenAI-compatible servers, llama.cpp servers, and the supported cloud
providers. Applications can replace or extend the registry through
`AgentProviderRegistry`.

## License and contributions

This package is source-available under the [Truss Collaborative Source
License](LICENSE). Contributions to the official project are welcome. Every
copy, fork, or derivative must preserve the license and prominently state:
**Based on Truss (https://github.com/truss-agent/truss-harness).** Commercial
use and competing products or services require separate written permission.
