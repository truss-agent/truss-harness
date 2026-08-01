/**
 * Select the Linux credential backend before Electron emits `ready`.
 *
 * Electron cannot reliably infer a desktop environment for all Linux
 * sessions (for example, Hyprland), even when a Secret Service-compatible
 * keyring is installed and available. Libsecret talks to that standard
 * Secret Service interface and is the backend used by the Linux packages we
 * distribute.
 */
export function configureLinuxCredentialStorage(
  platform: NodeJS.Platform,
  appendSwitch: (name: string, value: string) => void,
  hasExplicitPasswordStore = false,
): void {
  if (platform === "linux" && !hasExplicitPasswordStore) {
    appendSwitch("password-store", "gnome-libsecret");
  }
}
