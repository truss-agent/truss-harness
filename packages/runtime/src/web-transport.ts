import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

/** Caller validates every address. Implementations must connect only to those IPs, without proxies or DNS re-resolution. */
export interface PublicWebTransport {
  request(
    url: URL,
    addresses: readonly string[],
    signal: AbortSignal,
  ): Promise<Response>;
}

/** Direct socket transport. URL hostname remains HTTP Host and HTTPS servername/certificate identity. No environment proxy support. */
export class NodePublicWebTransport implements PublicWebTransport {
  constructor(private readonly tls: { readonly ca?: string | Buffer } = {}) {}
  async request(
    url: URL,
    addresses: readonly string[],
    signal: AbortSignal,
  ): Promise<Response> {
    let failure: unknown = new Error("No approved addresses");
    for (const address of addresses) {
      signal.throwIfAborted();
      try {
        return await new Promise<Response>((resolve, reject) => {
          const hostname = url.hostname.replace(/^\[|\]$/g, "");
          const request = (
            url.protocol === "https:" ? httpsRequest : httpRequest
          )(
            {
              protocol: url.protocol,
              hostname: address,
              port: url.port || undefined,
              path: `${url.pathname}${url.search}`,
              method: "GET",
              headers: {
                host: url.host,
                accept:
                  "text/html, text/plain, application/json, application/xml, text/xml, text/markdown;q=0.9",
              },
              // Node's HTTPS certificate verifier checks servername rather than the pinned IP.
              ...(url.protocol === "https:"
                ? {
                    ...this.tls,
                    servername: isIP(hostname) ? undefined : hostname,
                  }
                : {}),
              agent: false,
              signal,
            },
            (response) => {
              const headers = new Headers();
              for (const [name, value] of Object.entries(response.headers)) {
                if (Array.isArray(value))
                  value.forEach((entry) => headers.append(name, entry));
                else if (value !== undefined) headers.set(name, value);
              }
              const status = response.statusCode ?? 500;
              const empty = [204, 205, 304].includes(status);
              if (empty) response.resume();
              resolve(
                new Response(
                  empty
                    ? null
                    : (Readable.toWeb(response) as ReadableStream<Uint8Array>),
                  { status, headers },
                ),
              );
            },
          );
          request.once("error", reject);
          request.end();
        });
      } catch (error) {
        signal.throwIfAborted();
        failure = error;
      }
    }
    throw failure;
  }
}
