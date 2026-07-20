"use client";

import Link from "next/link";
import { useState } from "react";
import { ThemeToggle } from "./theme-toggle";

const links = [
  ["About", "/about"],
  ["Features", "/features"],
  ["Clients", "/clients"],
  ["Docs", "/docs"],
  ["Truss Go", "/truss-go"],
  ["Download", "/download"]
] as const;

export function MobileMenu() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mobile-menu">
      <button
        className="mobile-menu-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="mobile-navigation"
        aria-label={open ? "Close navigation" : "Open navigation"}
        onClick={() => setOpen((value) => !value)}
      >
        <span />
        <span />
        <span />
      </button>
      {open ? (
        <div id="mobile-navigation" className="mobile-menu-panel">
          <nav aria-label="Mobile navigation">
            {links.map(([label, href]) => (
              <Link key={href} href={href} onClick={() => setOpen(false)}>
                {label}
              </Link>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      ) : null}
    </div>
  );
}
