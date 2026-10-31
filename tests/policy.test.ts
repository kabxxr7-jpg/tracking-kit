import { describe, expect, it } from "vitest";
import { classify, isLoopbackHost, isPrivateHost } from "../src/policy.js";

const local = (u: string, m = "GET") => classify(u, m, "local", "127.0.0.1").kind;
const external = (u: string, m = "GET", target = "shop.example.test") => classify(u, m, "external", target).kind;

describe("request policy, local mode (offline: nothing may leave the machine)", () => {
  it("allows the local server", () => expect(local("http://127.0.0.1:8790/cart.html")).toBe("allow"));
  it("serves gtm.js from the emulator", () => expect(local("https://www.googletagmanager.com/gtm.js?id=GTM-XXXXXXX")).toBe("emulate-gtm"));
  it("stubs gtag.js and any other tag-host script", () => {
    expect(local("https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX")).toBe("stub-script");
    expect(local("https://www.googletagmanager.com/ns.html?id=GTM-XXXXXXX")).toBe("stub-script");
  });
  it("records (and never forwards) every analytics host", () => {
    for (const u of [
      "https://www.google-analytics.com/g/collect?v=2",
      "https://region1.google-analytics.com/g/collect",
      "https://analytics.google.com/g/collect",
      "https://stats.g.doubleclick.net/g/collect",
      "https://www.googleadservices.com/pagead/conversion/1/",
      "https://www.google.com/ccm/collect?en=x"
    ]) expect(local(u, "POST"), u).toBe("record-hit");
  });
  it("blocks any other non-local host", () => {
    expect(local("https://example.com/")).toBe("block");
    expect(local("https://fonts.googleapis.com/css")).toBe("block");
  });
  it("allows data: URLs and blocks garbage", () => {
    expect(local("data:text/plain,hi")).toBe("allow");
    expect(local("not a url")).toBe("block");
  });
});

describe("request policy, external mode (read-only page load)", () => {
  it("allows plain GETs", () => expect(external("https://shop.example.test/products")).toBe("allow"));
  it("blocks POST, PUT, PATCH and DELETE", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) expect(external("https://shop.example.test/api/cart", m), m).toBe("block");
  });
  it("never forwards analytics hits, whatever the method", () => {
    expect(external("https://www.google-analytics.com/g/collect?v=2", "GET")).toBe("record-hit");
    expect(external("https://www.google-analytics.com/g/collect?v=2", "POST")).toBe("record-hit");
  });
  it("lets the tag scripts load (GET) so the page behaves normally, but blocks writes to the tag host", () => {
    expect(external("https://www.googletagmanager.com/gtm.js?id=GTM-REAL123")).toBe("allow");
    expect(external("https://www.googletagmanager.com/gtm.js?id=GTM-REAL123", "POST")).toBe("block");
  });
  it("blocks requests from a public page to loopback or private addresses (SSRF-style)", () => {
    expect(external("http://127.0.0.1:9000/admin")).toBe("block");
    expect(external("http://192.168.1.10/router")).toBe("block");
    expect(external("http://10.0.0.5/")).toBe("block");
    expect(external("http://[::1]/")).toBe("block");
  });
  it("allows the target itself even if it is a private host", () => {
    expect(classify("http://192.168.1.10/", "GET", "external", "192.168.1.10").kind).toBe("allow");
  });
});

describe("host helpers", () => {
  it("loopback", () => {
    for (const h of ["localhost", "127.0.0.1", "::1", "[::1]", "demo.localhost"]) expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ["example.com", "127.0.0.1.evil.test", "notlocalhost"]) expect(isLoopbackHost(h), h).toBe(false);
  });
  it("private", () => {
    for (const h of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254"]) expect(isPrivateHost(h), h).toBe(true);
    for (const h of ["172.32.0.1", "8.8.8.8", "example.com"]) expect(isPrivateHost(h), h).toBe(false);
  });
});
