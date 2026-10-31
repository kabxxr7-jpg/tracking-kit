import { chromium, type Browser } from "playwright-core";

export interface LaunchOptions {
  headless?: boolean;
  /** Extra Chromium switches, for example a host-resolver rule used by tests. */
  args?: string[];
}

/**
 * Tries Playwright's bundled Chromium first (what CI installs), then the Google Chrome installed on the machine.
 * Set TRACKING_KIT_BROWSER=chrome to prefer the installed Chrome.
 */
export async function launchBrowser(opts: LaunchOptions = {}): Promise<Browser> {
  const base = { headless: opts.headless ?? true, args: opts.args ?? [] };
  const order = process.env.TRACKING_KIT_BROWSER === "chrome" ? (["chrome", "chromium"] as const) : (["chromium", "chrome"] as const);
  const errors: string[] = [];
  for (const which of order) {
    try {
      return which === "chromium" ? await chromium.launch(base) : await chromium.launch({ ...base, channel: "chrome" });
    } catch (e) {
      errors.push(`${which}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
  }
  throw new Error(`Could not start a browser. Run "npx playwright-core install chromium" or install Google Chrome. (${errors.join(" | ")})`);
}
