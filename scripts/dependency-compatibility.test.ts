import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);

it("renders inline and display math with the patched KaTeX and keeps its fonts available", () => {
  const katex = require("katex");
  for (const displayMode of [false, true]) {
    const html = katex.renderToString(
      String.raw`\int_0^1 x^2 dx = \frac{1}{3}`,
      { displayMode, throwOnError: true },
    );
    expect(html).toContain('class="katex-mathml"');
    expect(html).toContain("<math");
    expect(html.includes("katex-display")).toBe(displayMode);
  }
  const css = readFileSync(require.resolve("katex/dist/katex.min.css"), "utf8");
  expect(css).toContain("KaTeX_Main-Regular.woff2");
  expect(
    readFileSync(require.resolve("katex/dist/fonts/KaTeX_Main-Regular.woff2"))
      .length,
  ).toBeGreaterThan(1000);
});

it("loads the patched native sharp image pipeline", async () => {
  const sharp = require("sharp");
  const png = await sharp({
    create: { width: 3, height: 2, channels: 4, background: "#246" },
  })
    .png()
    .toBuffer();
  const webp = await sharp(png).resize(6, 4).webp().toBuffer();
  expect(await sharp(webp).metadata()).toMatchObject({
    format: "webp",
    width: 6,
    height: 4,
  });
});

it("keeps Metro image assets compatible with Expo SDK 54", async () => {
  const assets = require("metro/private/Assets");
  const png = readFileSync("packages/mobile/assets/icon.png");
  expect(assets.getAssetSize("png", png, "icon.png")).toMatchObject({
    width: 662,
    height: 662,
  });
  const config = require("expo/metro-config").getDefaultConfig(
    process.cwd() + "/packages/mobile",
  );
  expect(config.resolver.assetExts).toContain("png");
});

it("constructs Azure/MSAL public and confidential clients through identity's credential paths", async () => {
  const identity = require("@azure/identity");
  const msal = require("@azure/msal-node");
  const clientId = "11111111-1111-4111-8111-111111111111";
  const tenantId = "22222222-2222-4222-8222-222222222222";
  expect(
    new msal.PublicClientApplication({ auth: { clientId } }).getTokenCache(),
  ).toBeDefined();
  expect(
    new msal.ConfidentialClientApplication({
      auth: { clientId, clientSecret: "fixture" },
    }).getTokenCache(),
  ).toBeDefined();
  const credential = new identity.ClientSecretCredential(
    tenantId,
    clientId,
    "fixture",
    {
      disableInstanceDiscovery: true,
      httpClient: {
        async sendRequest(request: { url: string }) {
          const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
          const metadata = {
            authorization_endpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
            token_endpoint: tokenUrl,
            issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
            jwks_uri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
          };
          const body = request.url.includes("openid-configuration")
            ? metadata
            : {
                access_token: "fixture-token",
                expires_in: 3600,
                token_type: "Bearer",
              };
          const { createHttpHeaders } = require("@azure/core-rest-pipeline");
          return {
            request,
            status: 200,
            headers: createHttpHeaders({ "content-type": "application/json" }),
            bodyAsText: JSON.stringify(body),
          };
        },
      },
    },
  );
  const token = await credential.getToken(
    "https://management.azure.com/.default",
  );
  expect(token.token).toBe("fixture-token");
  expect(token.expiresOnTimestamp).toBeGreaterThan(Date.now());
});
