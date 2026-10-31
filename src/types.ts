export type PushKind = "object" | "command";

/** One argument passed to dataLayer.push(), copied at push time. `command` = gtag() style arguments object. */
export interface Push {
  seq: number;
  page: string;
  kind: PushKind;
  data: unknown;
}

/** One request that went (or would have gone) to an analytics host. Nothing is ever forwarded to the real host. */
export interface Hit {
  seq: number;
  page: string;
  host: string;
  method: string;
  url: string;
  params: Record<string, string>;
}

export interface ScriptLoad {
  seq: number;
  url: string;
  served: "emulator" | "stub" | "real";
}

export interface BlockedRequest {
  seq: number;
  method: string;
  url: string;
  reason: string;
}

export interface Capture {
  pushes: Push[];
  hits: Hit[];
  scripts: ScriptLoad[];
  blocked: BlockedRequest[];
}

export interface CheckResult {
  id: string;
  title: string;
  status: "pass" | "fail" | "skip";
  detail: string;
}

export type ValuePolicy = "items+tax+shipping" | "items";
