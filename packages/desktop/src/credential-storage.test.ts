import { describe, expect, it, vi } from "vitest";
import { configureLinuxCredentialStorage } from "./credential-storage.js";

describe("configureLinuxCredentialStorage", () => {
  it("selects libsecret for Linux sessions", () => {
    const appendSwitch = vi.fn();

    configureLinuxCredentialStorage("linux", appendSwitch);

    expect(appendSwitch).toHaveBeenCalledWith(
      "password-store",
      "gnome-libsecret",
    );
  });

  it("does not override an explicit Electron backend", () => {
    const appendSwitch = vi.fn();

    configureLinuxCredentialStorage("linux", appendSwitch, true);

    expect(appendSwitch).not.toHaveBeenCalled();
  });

  it("does not set a Linux backend on other platforms", () => {
    const appendSwitch = vi.fn();

    configureLinuxCredentialStorage("darwin", appendSwitch);

    expect(appendSwitch).not.toHaveBeenCalled();
  });
});
