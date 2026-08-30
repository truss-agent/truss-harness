import Link from "next/link";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { createPageMetadata } from "../site-metadata";
import { clientIds, clientContent } from "./client-content";

export const metadata = createPageMetadata({
  title: "Clients",
  description:
    "Choose the Truss client that fits your workflow: CLI, terminal UI, Neovim, VS Code, or desktop.",
  path: "/clients",
});

export default function ClientsPage() {
  return (
    <div className="site">
      <SiteHeader />
      <main className="site-page clients-index">
        <header className="site-page-intro">
          <p className="site-eyebrow">Client surfaces</p>
          <h1>One runtime. The interface you want.</h1>
          <p>
            Every Truss client works with the same provider profiles, tools,
            permission policies, workspace memory, and implementation plans.
          </p>
        </header>
        <section className="clients-index-grid">
          {clientIds.map((id) => {
            const client = clientContent[id];
            return (
              <article key={id}>
                <span>{client.eyebrow}</span>
                <h2>{client.title}</h2>
                <p>{client.description}</p>
                <Link
                  className="site-button site-button-secondary"
                  href={`/clients/${id}`}
                >
                  Explore {client.eyebrow}
                </Link>
              </article>
            );
          })}
          <article>
            <span>truss.nvim</span>
            <h2>Run native agents inside Neovim.</h2>
            <p>
              Use Chat, Plan, and Edit with bounded editor context, native
              approvals, changed-file navigation, and the shared agent runtime.
            </p>
            <Link
              className="site-button site-button-secondary"
              href="/docs/clients/neovim"
            >
              Explore truss.nvim
            </Link>
          </article>
          <article>
            <span>Truss Go for Android</span>
            <h2>Keep your workspace close.</h2>
            <p>
              Pair your phone with Truss Desktop or VS Code over trusted
              same-Wi-Fi QR pairing.
            </p>
            <Link
              className="site-button site-button-secondary"
              href="/truss-go"
            >
              Explore Truss Go
            </Link>
          </article>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
