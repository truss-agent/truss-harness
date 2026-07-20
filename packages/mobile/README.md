# Truss mobile

Expo/React Native client for a trusted Truss workspace gateway. The host, not
the phone, owns the workspace, agent tools, provider credentials, and approval
policy.

```sh
npm --workspace @truss-harness/mobile run start
```

Enter the gateway's URL and its token, choose a host-configured workspace and
Chat, Plan, or Edit mode, then connect. In Edit mode, the app presents
host-requested tool approvals. For a physical device, use a trusted LAN URL or
a secure user-managed tunnel; do not expose the current gateway directly to
the public internet.
