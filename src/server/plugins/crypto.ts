import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { EncryptedEnvelope } from "./repo.js";

/**
 * Plugin config secret encryption (P7.5-T7.5.3, D-044).
 *
 * App-level AES-256-GCM over `node:crypto` (no new dependency). Only a plugin's
 * `secretConfigKeys` values are encrypted; non-secret config stays plaintext in
 * `site_plugins.config`. The GCM auth tag makes tampered ciphertext fail closed.
 *
 * Key resolution (`PLUGIN_CONFIG_ENC_KEY`, base64 of 32 bytes):
 *   - production : REQUIRED. Missing/invalid → throw (never silently downgrade).
 *   - non-prod   : falls back to a deterministic dev key when unset, so local
 *                  dev + tests work without provisioning a secret. The dev key
 *                  protects nothing real and must never be used in prod.
 *
 * The prod key is provisioned in Secret Manager and wired via Cloud Run
 * `--set-secrets`; it's only needed once the first key-bearing plugin is
 * enabled in prod (D-044 — documented like the Phase-8 OAuth prereq).
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

// Deterministic dev/test key — NON-PRODUCTION ONLY. sha256 of a fixed label
// gives a stable 32-byte key so a value encrypted in one process decrypts in
// another (e.g. across test files). Never reached in production (guard below).
const DEV_KEY = createHash("sha256").update("anchor-sites:dev:plugin-config-key").digest();

let warnedDevKey = false;

function resolveKey(): Buffer {
  const raw = process.env.PLUGIN_CONFIG_ENC_KEY;
  const isProd = process.env.NODE_ENV === "production";

  if (raw) {
    const key = Buffer.from(raw, "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `PLUGIN_CONFIG_ENC_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`,
      );
    }
    return key;
  }

  if (isProd) {
    throw new Error(
      "PLUGIN_CONFIG_ENC_KEY is required in production to encrypt plugin config secrets",
    );
  }

  if (!warnedDevKey) {
    // eslint-disable-next-line no-console
    console.warn(
      "[plugins/crypto] PLUGIN_CONFIG_ENC_KEY unset — using the non-production dev key",
    );
    warnedDevKey = true;
  }
  return DEV_KEY;
}

/** True when a usable encryption key is available (prod secret set, or non-prod). */
export function isConfigKeyConfigured(): boolean {
  try {
    resolveKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt a (non-empty) secret object into a storable envelope. */
export function encryptConfig(secret: Record<string, unknown>): EncryptedEnvelope {
  const key = resolveKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(secret), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

/** Decrypt an envelope back to the secret object. Throws if tampered or key-mismatched. */
export function decryptConfig(envelope: EncryptedEnvelope): Record<string, unknown> {
  if (envelope.v !== 1) {
    throw new Error(`unsupported config envelope version: ${envelope.v}`);
  }
  const key = resolveKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
}
