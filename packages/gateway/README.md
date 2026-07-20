# Truss remote gateway

`@truss-harness/gateway` exposes the versioned remote-session contract over an
authenticated HTTP command endpoint and a Server-Sent Events stream. It is a
host-side adapter; it does not contain model-provider credentials or a mobile
UI.

The CLI starts it for the current workspace:

```sh
truss-cli gateway --gateway-token "replace-with-a-random-24-character-minimum-token"
```

It binds to `127.0.0.1:4787` by default. To test from a device on a trusted
local network, bind explicitly and enter the computer's LAN URL in the mobile
app:

```sh
truss-cli gateway --gateway-host 0.0.0.0 --gateway-token "replace-with-a-random-24-character-minimum-token"
```

Do not expose this initial gateway to the public internet. TLS, device pairing,
revocation, and remote-host deployment are planned follow-up work.
