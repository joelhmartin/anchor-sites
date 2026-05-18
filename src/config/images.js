/**
 * Unsplash image URLs — replace with local paths for production.
 *
 * Unsplash license: free for commercial use, no attribution required
 * (though attribution is appreciated).
 */

const UNS = (id, w = 1260, h = 750) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&h=${h}&q=80`;

const UNS_WIDE = (id) => UNS(id, 1920, 1080);

// ── City / Location ─────────────────────────────────────────────────────────
// Generic city imagery — replace with local photos for your market

export const AUSTIN = {
  /** City skyline at golden hour */
  ladyBirdSunset: UNS_WIDE("1477959858617-67f85cf4f1df"),

  /** Modern city skyline, daytime */
  skylineDay: UNS_WIDE("1449824913935-59a10b8d2000"),

  /** City buildings at dusk */
  skylineDusk: UNS_WIDE("1514565131-fce0801e5785"),

  /** Pedestrians crossing a busy city street */
  streetCrossing: UNS("1517732306149-e8f829eb588a"),

  /** Aerial cityscape view */
  ladyBirdAerial: UNS("1480714378408-67cf0d13bc1b"),

  /** Nature landscape — rolling hills */
  bluebonnets: UNS("1470071459604-3b5ec3a7fe05"),
};

// ── Services ────────────────────────────────────────────────────────────────
// Used in the Services tab section

export const SERVICES = {
  /** One-on-one consulting session */
  coaching: UNS("1553877522-43269d4ea984"),

  /** Two professionals walking together */
  soberCompanion: UNS("1529156069898-49953e39b3ac"),

  /** Outdoor team activity */
  hiking: UNS("1551632436-cbf8dd35adfa"),

  /** Family or group conversation */
  family: UNS("1511895426328-dc8714191300"),

  /** Professionals collaborating at a table */
  collaborative: UNS("1552664730-d307ca884978"),
};

// ── Team ────────────────────────────────────────────────────────────────────
// Generic team/professional photos — replace with real team photos

export const TEAM = {
  heroMain: UNS("1522071820081-009f0129c71c", 1920, 1080),
  heroMobile: UNS("1521737711867-e3b97375f902", 800, 1200),
  heroAlt: UNS("1600880292203-757bb62b4baf", 1920, 1080),
  goofin: UNS("1543269664-56d93c1b41a6", 1260, 945),
  charlesJustin1: UNS("1600880292089-90a7e086ee0c", 1260, 1575),
  charlesJustin2: UNS("1600880292089-90a7e086ee0c", 1260, 1575),
  charles1: UNS("1507003211169-0a1dd7228f2d", 800, 1067),
  charles2: UNS("1507003211169-0a1dd7228f2d", 800, 1067),
  justin1: UNS("1472099645785-5658abf4ff4e", 800, 1067),
  justin2: UNS("1472099645785-5658abf4ff4e", 800, 1067),
  matthew1: UNS("1438761681033-6461ffad8d80", 800, 1067),
  matthew2: UNS("1438761681033-6461ffad8d80", 800, 1067),
  damian1: UNS("1500648767791-00dcc994a43e", 800, 1067),
  damian2: UNS("1500648767791-00dcc994a43e", 800, 1067),
  teamIsoBg: UNS("1522071820081-009f0129c71c", 1260, 1260),
  dsc: UNS("1600880292203-757bb62b4baf", 1260, 750),
  team2: UNS("1543269664-56d93c1b41a6", 1260, 750),
};
