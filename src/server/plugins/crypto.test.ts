import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptConfig, encryptConfig, isConfigKeyConfigured } from "./crypto.js";

const validKeyB64 = randomBytes(32).toString("base64");

afterEach(() => vi.unstubAllEnvs());

describe("plugin config crypto (P7.5-T7.5.3, D-044)", () => {
  it("round-trips a secret object (dev key, non-prod)", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PLUGIN_CONFIG_ENC_KEY", "");
    const secret = { api_key: "sk-live-123", nested: { a: 1 } };
    const env = encryptConfig(secret);
    expect(env.v).toBe(1);
    expect(env.ciphertext).not.toContain("sk-live-123");
    expect(decryptConfig(env)).toEqual(secret);
  });

  it("fails closed on tampered ciphertext", () => {
    const env = encryptConfig({ api_key: "x" });
    const tampered = { ...env, ciphertext: Buffer.from("garbage").toString("base64") };
    expect(() => decryptConfig(tampered)).toThrow();
  });

  it("fails closed on a tampered auth tag", () => {
    const env = encryptConfig({ api_key: "x" });
    const tampered = { ...env, tag: randomBytes(16).toString("base64") };
    expect(() => decryptConfig(tampered)).toThrow();
  });

  it("rejects an unsupported envelope version", () => {
    const env = encryptConfig({ api_key: "x" });
    expect(() => decryptConfig({ ...env, v: 2 as 1 })).toThrow(/unsupported config envelope/);
  });

  it("requires PLUGIN_CONFIG_ENC_KEY in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLUGIN_CONFIG_ENC_KEY", "");
    expect(isConfigKeyConfigured()).toBe(false);
    expect(() => encryptConfig({ api_key: "x" })).toThrow(/required in production/);
  });

  it("uses an explicit key in production and round-trips", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLUGIN_CONFIG_ENC_KEY", validKeyB64);
    expect(isConfigKeyConfigured()).toBe(true);
    const env = encryptConfig({ token: "abc" });
    expect(decryptConfig(env)).toEqual({ token: "abc" });
  });

  it("rejects a key that isn't 32 bytes", () => {
    vi.stubEnv("PLUGIN_CONFIG_ENC_KEY", randomBytes(16).toString("base64"));
    expect(() => encryptConfig({ api_key: "x" })).toThrow(/32 bytes/);
  });
});
