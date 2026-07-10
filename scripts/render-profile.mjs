import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DAY = 24 * 60 * 60 * 1000;
const OUTPUT_DIR = path.resolve("assets");
const login = process.env.GITHUB_LOGIN || process.env.GITHUB_REPOSITORY_OWNER;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

if (!login || !token) {
  throw new Error(
    "GITHUB_LOGIN (or GITHUB_REPOSITORY_OWNER) and GH_TOKEN are required.",
  );
}

const now = new Date();
const from = new Date(now.getTime() - 364 * DAY);
const query = String.raw`
  query ProfileRoute($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      login
      createdAt
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks {
            contributionDays {
              contributionCount
              date
            }
          }
        }
      }
      repositories(
        first: 100
        ownerAffiliations: OWNER
        privacy: PUBLIC
        isFork: false
      ) {
        nodes {
          languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
              }
            }
          }
        }
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": `${login}-profile-readme`,
  },
  body: JSON.stringify({
    query,
    variables: {
      login,
      from: from.toISOString(),
      to: now.toISOString(),
    },
  }),
});

if (!response.ok) {
  throw new Error(`GitHub GraphQL request failed with ${response.status}.`);
}

const payload = await response.json();

if (payload.errors?.length) {
  throw new Error(payload.errors.map(({ message }) => message).join("; "));
}

if (!payload.data?.user) {
  throw new Error(`GitHub user ${login} was not found.`);
}

const profile = buildProfile(payload.data.user);
const themes = {
  light: {
    background: "#f7f8fa",
    border: "#d9dee7",
    text: "#172033",
    muted: "#667085",
    empty: "#e5e8ed",
    cyan: "#008ea1",
    green: "#218739",
    yellow: "#b36b00",
    pink: "#c13c73",
  },
  dark: {
    background: "#0d1117",
    border: "#303b4d",
    text: "#f0f3f6",
    muted: "#9ba7b4",
    empty: "#25303d",
    cyan: "#56d4dd",
    green: "#63d88b",
    yellow: "#f2c14e",
    pink: "#f071a5",
  },
};

await mkdir(OUTPUT_DIR, { recursive: true });

for (const [name, theme] of Object.entries(themes)) {
  await writeFile(
    path.join(OUTPUT_DIR, `banner-${name}.svg`),
    renderRouteMap(profile, theme),
  );
}

function buildProfile(user) {
  const calendar = user.contributionsCollection.contributionCalendar;
  const days = calendar.weeks
    .flatMap(({ contributionDays }) => contributionDays)
    .filter(({ date }) => date >= from.toISOString().slice(0, 10));
  const languageTotals = new Map();

  for (const repository of user.repositories.nodes) {
    for (const { size, node } of repository.languages.edges) {
      languageTotals.set(node.name, (languageTotals.get(node.name) || 0) + size);
    }
  }

  const languages = [...languageTotals]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([name]) => name);
  const weeklyPulses = days.slice(-7)
    .reduce((sum, day) => sum + day.contributionCount, 0);

  return {
    calendar,
    languages,
    login: user.login,
    mode: activityMode(weeklyPulses),
    weeklyPulses,
    yearsOnGitHub: Math.max(
      1,
      Math.floor(
        (now.getTime() - new Date(user.createdAt).getTime()) / (365.2425 * DAY),
      ),
    ),
  };
}

function activityMode(weeklyPulses) {
  if (weeklyPulses === 0) return "IDLE (SUSPICIOUS)";
  if (weeklyPulses <= 5) return "WARMING UP";
  if (weeklyPulses <= 20) return "CAFFEINATED";
  return "OVERCLOCKED";
}

function renderRouteMap(profile, theme) {
  const statusColor = modeColor(profile.mode, theme);
  const weeklyCounts = profile.calendar.weeks.slice(-52)
    .map(({ contributionDays }) => {
      return contributionDays.reduce(
        (sum, day) => sum + day.contributionCount,
        0,
      );
    });
  const maxWeek = Math.max(1, ...weeklyCounts);
  const signalBars = weeklyCounts.map((count, index) => {
    const height = count ? Math.max(5, Math.round((count / maxWeek) * 40)) : 3;
    const x = 40 + index * 17;
    const y = 400 - height;
    const isCurrent = index === weeklyCounts.length - 1;
    const fill = isCurrent ? statusColor : count ? theme.green : theme.empty;
    const animation = isCurrent && count
      ? '<animate attributeName="opacity" values="0.4;1;0.4" dur="1.8s" repeatCount="indefinite"/>'
      : "";

    return `<rect x="${x}" y="${y}" width="11" height="${height}" rx="3" fill="${fill}"><title>${count} contributions</title>${animation}</rect>`;
  }).join("");
  const currentGravity = profile.languages.slice(0, 2)
    .map((name) => name.toUpperCase())
    .join(" + ") || "SOURCE + RUNTIME";
  const stations = [
    [70, 200, "2015", "UI", theme.cyan, "above"],
    [180, 200, "2016", "BUNDLERS", theme.cyan, "above"],
    [295, 260, "2018", "AUTOMATION", theme.pink, "below"],
    [410, 260, "2020", "APIs", theme.yellow, "below"],
    [525, 200, "2022", "SSR + ISLANDS", theme.green, "above"],
    [640, 200, "2023", "ESM", theme.cyan, "above"],
    [755, 260, "2024", "AST", theme.pink, "below"],
    [875, 260, "NOW", "RUST + WASM", statusColor, "below"],
  ];
  const stationNodes = stations.map(
    ([x, y, year, label, color, position], index) => {
      const labelY = position === "above" ? y - 38 : y + 43;
      const yearY = position === "above" ? y - 57 : y + 62;
      const pulse = index === stations.length - 1
        ? `<circle cx="${x}" cy="${y}" r="18" fill="none" stroke="${color}" opacity="0.65"><animate attributeName="r" values="14;24;14" dur="2.2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0;0.8" dur="2.2s" repeatCount="indefinite"/></circle>`
        : "";

      return `${pulse}
        <circle cx="${x}" cy="${y}" r="10" fill="${theme.background}" stroke="${color}" stroke-width="4"/>
        <text x="${x}" y="${labelY}" text-anchor="middle" class="station" fill="${theme.text}">${escapeXml(label)}</text>
        <text x="${x}" y="${yearY}" text-anchor="middle" class="micro" fill="${theme.muted}">${year}</text>`;
    },
  ).join("");

  return svgDocument(960, 450, theme, `Technical route map for ${profile.login}`, `
    <rect width="960" height="450" rx="18" fill="${theme.background}"/>
    <text x="40" y="34" class="micro" fill="${theme.muted}">${escapeXml(profile.login.toUpperCase())} / ROUTE MAP / ${profile.yearsOnGitHub} YEARS</text>
    <text x="40" y="82" class="display" fill="${theme.text}">This should take five minutes.</text>
    <text x="40" y="112" class="body-sans" fill="${theme.muted}">A frontend task, reconstructed from ${profile.yearsOnGitHub} years of public commits.</text>
    <text x="920" y="34" text-anchor="end" class="micro" fill="${statusColor}">${escapeXml(profile.mode)} · ${profile.weeklyPulses} PULSES / 7D</text>

    <path d="M70 200H180" fill="none" stroke="${theme.cyan}" stroke-width="8" stroke-linecap="round"/>
    <path d="M180 200C230 200 245 260 295 260" fill="none" stroke="${theme.pink}" stroke-width="8"/>
    <path d="M295 260H410" fill="none" stroke="${theme.yellow}" stroke-width="8"/>
    <path d="M410 260C460 260 475 200 525 200" fill="none" stroke="${theme.green}" stroke-width="8"/>
    <path d="M525 200H640" fill="none" stroke="${theme.cyan}" stroke-width="8"/>
    <path d="M640 200C690 200 705 260 755 260" fill="none" stroke="${theme.pink}" stroke-width="8"/>
    <path d="M755 260H875" fill="none" stroke="${statusColor}" stroke-width="8" stroke-linecap="round"/>
    ${stationNodes}
    <path d="M875 229v-23h-86" fill="none" stroke="${statusColor}" stroke-width="1.5" stroke-dasharray="4 5"/>
    <text x="781" y="202" text-anchor="end" class="micro" fill="${statusColor}">YOU ARE HERE</text>

    <line x1="40" y1="330" x2="920" y2="330" stroke="${theme.border}"/>
    <text x="40" y="352" class="micro" fill="${theme.muted}">RECENT SIGNAL / 52 WEEKS</text>
    <text x="920" y="352" text-anchor="end" class="micro" fill="${theme.muted}">CURRENT GRAVITY · ${escapeXml(currentGravity)}</text>
    ${signalBars}
    <text x="40" y="430" class="micro" fill="${theme.muted}">START: “ONE TINY FIX”</text>
    <text x="920" y="430" text-anchor="end" class="micro" fill="${statusColor}">NEXT STOP: PROBABLY ANOTHER TINY FIX</text>
  `);
}

function modeColor(mode, theme) {
  if (mode === "IDLE (SUSPICIOUS)") return theme.muted;
  if (mode === "WARMING UP") return theme.yellow;
  if (mode === "CAFFEINATED") return theme.pink;
  return theme.cyan;
}

function svgDocument(width, height, theme, title, content) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">
  <title>${escapeXml(title)}</title>
  <style>
    text { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; letter-spacing: 0; }
    .display { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 35px; font-weight: 750; }
    .body-sans { font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 15px; }
    .micro { font-size: 11px; font-weight: 700; }
    .station { font-size: 12px; font-weight: 800; }
    @media (prefers-reduced-motion: reduce) { animate { display: none; } }
  </style>
  <rect width="${width}" height="${height}" fill="${theme.background}"/>
  ${content}
</svg>
`;

  return svg.replace(/[ \t]+$/gm, "");
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
}
