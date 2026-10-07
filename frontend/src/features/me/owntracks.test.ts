import { describe, expect, it } from "vitest";
import { owntracksConfigUrl, owntracksDeviceId, trackerId } from "./owntracks";

describe("OwnTracks setup link", () => {
  it("carries the HTTP settings as base64 JSON that survives URL decoding", () => {
    const link = owntracksConfigUrl({
      url: "https://oukile.example.com/api/owntracks",
      username: "lucia@example.com",
      password: "lcd_a+b/c=",
      deviceId: "lucia-phone",
      tid: "LN",
    });
    expect(link.startsWith("owntracks:///config?inline=")).toBe(true);
    const inline = new URL(link.replace("owntracks:///", "https://x/")).searchParams.get("inline")!;
    expect(link).not.toMatch(/inline=.*[+/=]/); // percent-encoded
    const config = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(inline), (c) => c.charCodeAt(0))));
    expect(config).toMatchObject({
      _type: "configuration",
      mode: 3,
      url: "https://oukile.example.com/api/owntracks",
      auth: true,
      username: "lucia@example.com",
      password: "lcd_a+b/c=",
      deviceId: "lucia-phone",
      tid: "LN",
      // The app then takes its places and reporting profile from the server's replies.
      cmd: true,
      remoteConfiguration: true,
    });
  });

  it("derives a tracker id and a device id from the name", () => {
    expect(trackerId("Lucía Núñez")).toBe("LN");
    expect(trackerId("marco")).toBe("MA");
    expect(owntracksDeviceId("Lucía Núñez")).toBe("lucia-nunez-phone");
    expect(owntracksDeviceId("  ")).toBe("oukile-phone");
  });
});
