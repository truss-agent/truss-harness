"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

export function LandingMotion({ children }: { readonly children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!root.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let disposed = false;
    let revert = (): void => undefined;

    void Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([gsapModule, scrollTriggerModule]) => {
      if (disposed || !root.current) return;

      const gsap = gsapModule.gsap;
      gsap.registerPlugin(scrollTriggerModule.ScrollTrigger);

      let removePointerInteraction: (() => void) | undefined;
      let removeSessionScrollListener: (() => void) | undefined;
      const context = gsap.context(() => {
        const hero = root.current?.querySelector<HTMLElement>(".site-hero");
        const terminal = root.current?.querySelector<HTMLElement>(".site-terminal");
        const terminalLines = root.current?.querySelectorAll<HTMLElement>(".site-terminal-body p");
        const command = root.current?.querySelector<HTMLElement>("[data-terminal-command]");
        const cursor = root.current?.querySelector<HTMLElement>("[data-terminal-cursor]");
        const enterKey = root.current?.querySelector<HTMLElement>("[data-terminal-enter]");
        const successLine = root.current?.querySelector<HTMLElement>(".site-terminal-success");
        const commandText = command?.textContent ?? "";
        const typing = { characters: 0 };
        const outputLines = terminalLines ? Array.from(terminalLines).slice(1) : [];

        if (command) command.textContent = "";
        if (outputLines.length > 0) gsap.set(outputLines, { autoAlpha: 0, display: "none", x: -10 });

        const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
        intro
          .from(".site-hero-copy .site-eyebrow", { autoAlpha: 0, duration: .5, y: 14 })
          .from(".site-hero-copy h1", { autoAlpha: 0, duration: .9, y: 46 }, "-=.18")
          .from(".site-hero-copy .site-lede", { autoAlpha: 0, duration: .65, y: 24 }, "-=.52")
          .from(".site-actions > *", { autoAlpha: 0, duration: .48, stagger: .1, y: 14 }, "-=.36");

        if (terminal) {
          intro.from(terminal, { autoAlpha: 0, duration: .95, scale: .94, y: 42 }, "-=.5");
        }

        let sessionStarted = false;
        const startSession = (): void => {
          if (sessionStarted) return;
          sessionStarted = true;

          const session = gsap.timeline({ defaults: { ease: "power2.out" } });
          if (terminalLines?.[0]) {
            session.from(terminalLines[0], { autoAlpha: 0, duration: .28, x: -8 });
          }
          if (cursor) {
            session.to(cursor, { autoAlpha: .2, duration: .1 })
              .to(cursor, { autoAlpha: 1, duration: .4, ease: "steps(1)", repeat: 1, yoyo: true });
          }
          if (command) {
            session.to(typing, {
              characters: commandText.length,
              duration: 1.42,
              ease: "none",
              onUpdate: () => {
                command.textContent = commandText.slice(0, Math.floor(typing.characters));
              }
            });
          }
          if (cursor) session.to(cursor, { autoAlpha: 0, duration: .08 });
          if (enterKey) {
            session.to(enterKey, { autoAlpha: 1, duration: .1, scale: 1.08 })
              .to(enterKey, { autoAlpha: .35, duration: .2, scale: 1 });
          }
          if (outputLines[0]) session.set(outputLines[0], { display: "block" }).to(outputLines[0], { autoAlpha: 1, duration: .4, x: 0 }, "+=.16");
          if (outputLines[1]) session.set(outputLines[1], { display: "block" }).to(outputLines[1], { autoAlpha: 1, duration: .45, x: 0 }, "+=.26");
          if (outputLines[2]) session.set(outputLines[2], { display: "block" }).to(outputLines[2], { autoAlpha: 1, duration: .4, x: 0 }, "+=.2");
          if (outputLines[3]) {
            session.set(outputLines[3], { display: "block" }).to(outputLines[3], { autoAlpha: 1, duration: .4, x: 0 }, "+=.24")
              .call(() => {
                if (successLine) gsap.to(successLine, { color: "#d8ffea", duration: 1.35, repeat: -1, yoyo: true });
              });
          }
        };

        const startOnScroll = (): void => {
          startSession();
          window.removeEventListener("scroll", startOnScroll);
        };
        if (window.scrollY > 12) startSession();
        else {
          window.addEventListener("scroll", startOnScroll, { passive: true });
          removeSessionScrollListener = () => window.removeEventListener("scroll", startOnScroll);
        }

        root.current?.querySelectorAll<HTMLElement>("[data-reveal]").forEach((section) => {
          gsap.from(section, {
            autoAlpha: 0,
            duration: .85,
            ease: "power3.out",
            scrollTrigger: { once: true, start: "top 84%", trigger: section },
            y: 42
          });
        });

        root.current?.querySelectorAll<HTMLElement>("[data-stagger]").forEach((group) => {
          gsap.from(Array.from(group.children), {
            autoAlpha: 0,
            duration: .6,
            ease: "power2.out",
            scrollTrigger: { once: true, start: "top 82%", trigger: group },
            stagger: .1,
            y: 28
          });
        });

        if (hero && terminal && window.matchMedia("(min-width: 900px)").matches) {
          const moveTerminal = (event: PointerEvent): void => {
            const bounds = hero.getBoundingClientRect();
            const x = (event.clientX - bounds.left) / bounds.width - .5;
            const y = (event.clientY - bounds.top) / bounds.height - .5;
            gsap.to(terminal, { duration: .65, ease: "power3.out", rotateX: -y * 2.6, rotateY: x * 3.8, x: x * 8, overwrite: "auto" });
          };
          const resetTerminal = (): void => {
            gsap.to(terminal, { duration: .8, ease: "power3.out", rotateX: 0, rotateY: 0, x: 0, overwrite: "auto" });
          };
          hero.addEventListener("pointermove", moveTerminal);
          hero.addEventListener("pointerleave", resetTerminal);
          removePointerInteraction = () => {
            hero.removeEventListener("pointermove", moveTerminal);
            hero.removeEventListener("pointerleave", resetTerminal);
          };
        }
      }, root);

      revert = () => {
        removePointerInteraction?.();
        removeSessionScrollListener?.();
        context.revert();
      };
    });

    return () => {
      disposed = true;
      revert();
    };
  }, []);

  return <div ref={root} className="landing-motion">{children}</div>;
}
