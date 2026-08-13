import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesktopEvent, DesktopState } from "../shared.js";
import {
  type DesktopReleaseAsset,
  type DesktopUpdateArtifact,
  findReleaseAsset,
  isNewerVersion,
  normalizedVersion,
} from "../update-support.js";

interface UpdateInfo {
  readonly version: string;
}

interface DownloadProgress {
  readonly percent: number;
}

export interface NativeUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(
    event: "update-available" | "update-not-available" | "update-downloaded",
    listener: (info: UpdateInfo) => void,
  ): unknown;
  on(
    event: "download-progress",
    listener: (progress: DownloadProgress) => void,
  ): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface DesktopUpdateEnvironment {
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly appImage?: string;
  readonly resourcesPath: string;
  getVersion(): string;
}

export class DesktopUpdateService {
  private configured = false;
  private hostedUpdateUrl: string | undefined;

  constructor(
    private readonly environment: DesktopUpdateEnvironment,
    private readonly updater: NativeUpdater,
    private readonly preferences: () => DesktopState["updates"],
    private readonly send: (event: DesktopEvent) => void,
    private readonly openExternal: (url: string) => Promise<unknown>,
  ) {}

  nativeSupported(): boolean {
    return (
      this.environment.isPackaged &&
      (this.environment.platform === "win32" ||
        (this.environment.platform === "linux" &&
          this.environment.arch === "x64" &&
          Boolean(this.environment.appImage)))
    );
  }

  configure(): void {
    if (this.configured) return;
    this.configured = true;
    if (this.nativeSupported()) {
      this.updater.autoDownload = this.preferences().autoDownload;
      this.updater.autoInstallOnAppQuit = false;
      this.updater.on("checking-for-update", () =>
        this.send({ type: "update", status: "checking" }),
      );
      this.updater.on("update-available", (info) =>
        this.send({
          type: "update",
          status: "available",
          version: info.version,
        }),
      );
      this.updater.on("update-not-available", (info) =>
        this.send({
          type: "update",
          status: "not-available",
          version: info.version,
        }),
      );
      this.updater.on("download-progress", (progress) =>
        this.send({
          type: "update",
          status: "downloading",
          percent: progress.percent,
        }),
      );
      this.updater.on("update-downloaded", (info) =>
        this.send({
          type: "update",
          status: "downloaded",
          version: info.version,
        }),
      );
      this.updater.on("error", (error) => this.reportError(error));
    }
    if (this.preferences().checkOnLaunch) {
      setTimeout(() => {
        void this.check().catch((error) => this.reportError(error));
      }, 1_500);
    }
  }

  setAutoDownload(enabled: boolean): void {
    if (this.nativeSupported()) this.updater.autoDownload = enabled;
  }

  async check(): Promise<void> {
    if (!this.environment.isPackaged)
      throw new Error(
        "Updates are available only in installed desktop builds.",
      );
    if (this.nativeSupported()) await this.updater.checkForUpdates();
    else {
      this.send({ type: "update", status: "checking" });
      await this.checkHosted();
    }
  }

  async download(): Promise<void> {
    if (this.nativeSupported()) {
      await this.updater.downloadUpdate();
      return;
    }
    if (!this.hostedUpdateUrl) {
      await this.checkHosted();
      return;
    }
    await this.openExternal(this.hostedUpdateUrl);
  }

  install(): void {
    if (this.nativeSupported()) this.updater.quitAndInstall(false, true);
    else if (this.hostedUpdateUrl) void this.openExternal(this.hostedUpdateUrl);
    else
      throw new Error("Check for updates before opening the update download.");
  }

  private reportError(error: unknown): void {
    this.send({
      type: "update",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private async artifact(): Promise<DesktopUpdateArtifact> {
    if (this.environment.platform === "win32") return "windows";
    if (this.environment.appImage) return "appimage";
    try {
      const packageType = (
        await readFile(
          join(this.environment.resourcesPath, "package-type"),
          "utf8",
        )
      ).trim();
      if (packageType === "deb" || packageType === "rpm") return packageType;
      if (packageType === "pacman") return "pacman";
    } catch {
      // Portable archives do not include electron-builder's package marker.
    }
    return "archive";
  }

  private async checkHosted(): Promise<void> {
    const response = await fetch(
      "https://api.github.com/repos/truss-agent/truss-harness/releases/latest",
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "Truss-Desktop",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok)
      throw new Error(`GitHub update check failed (${response.status}).`);
    const payload: unknown = await response.json();
    if (!isRecord(payload))
      throw new Error("GitHub returned an invalid release.");
    const tagName =
      typeof payload.tag_name === "string" ? payload.tag_name : "";
    const version = normalizedVersion(tagName);
    const pageUrl =
      typeof payload.html_url === "string"
        ? trustedUpdateUrl(payload.html_url)
        : undefined;
    if (!version || !pageUrl)
      throw new Error("GitHub returned an invalid release.");
    if (!isNewerVersion(version, this.environment.getVersion())) {
      this.hostedUpdateUrl = undefined;
      this.send({ type: "update", status: "not-available", version });
      return;
    }
    const artifact = await this.artifact();
    const assets: DesktopReleaseAsset[] = Array.isArray(payload.assets)
      ? payload.assets.flatMap((value): DesktopReleaseAsset[] => {
          if (!isRecord(value)) return [];
          const name = typeof value.name === "string" ? value.name : undefined;
          const url =
            typeof value.browser_download_url === "string"
              ? trustedUpdateUrl(value.browser_download_url)
              : undefined;
          return name && url ? [{ name, url }] : [];
        })
      : [];
    const asset = findReleaseAsset(
      assets,
      version,
      artifact,
      this.environment.arch,
    );
    this.hostedUpdateUrl = asset?.url ?? pageUrl;
    this.send({ type: "update", status: "available", version, manual: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function trustedUpdateUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      !url.pathname.startsWith("/truss-agent/truss-harness/")
    )
      return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}
