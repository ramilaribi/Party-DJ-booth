import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { Server } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  // Optional local settings such as YOUTUBE_API_KEY. The file is gitignored.
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  // No .env file (or a Node.js without loadEnvFile): use the real environment as is.
}

const port = Number(process.env.PORT || 4242);
const youtubeApiKey = process.env.YOUTUBE_API_KEY || "";
const youtubeApiBase = "https://www.googleapis.com/youtube/v3";
const maxDownloadBytes = 60 * 1024 * 1024;
const openAudioFilter = [
  "mediatype:audio",
  "(collection:opensource_audio OR collection:netlabels OR collection:etree)",
  "NOT collection:stream_only",
].join(" AND ");
const loopbackAddresses = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const publicDir = path.join(__dirname, "public");
const downloadsDir = path.join(__dirname, "music-downloads");
const libraryFile = path.join(__dirname, ".music-library.json");
const sessionCode = crypto.randomBytes(6).toString("base64url");

await fs.promises.mkdir(downloadsDir, { recursive: true });

let partyState = {
  connectedDisplays: 0,
  connectedRemotes: 0,
  playlist: [],
  currentTrackId: null,
  currentTime: 0,
  duration: 0,
  playing: false,
  energy: 52,
  crossfade: 5,
  autoDj: true,
  visualStyle: "spectrum",
  hypeUntil: 0,
  message: "Waiting for music on the Mac",
};

function getLanAddress() {
  const interfaces = os.networkInterfaces();

  for (const items of Object.values(interfaces)) {
    for (const item of items || []) {
      if (item.family === "IPv4" && !item.internal) {
        return item.address;
      }
    }
  }

  return "localhost";
}

function baseUrl(req) {
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  return `${proto}://${host}`;
}

function remoteBaseUrl(req) {
  const origin = baseUrl(req);
  const host = req.headers.host || "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");

  if (!isLocalhost) return origin;

  const lanAddress = getLanAddress();
  const portPart = host.includes(":") ? `:${host.split(":").at(-1)}` : "";
  return `http://${lanAddress}${portPart}`;
}

function hostName(hostHeader) {
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// Browsers send Origin on cross-site requests and on every WebSocket handshake.
function isSameOrigin(headers) {
  if (!headers.origin) return true;
  try {
    return new URL(headers.origin).host === headers.host;
  } catch {
    return false;
  }
}

// The booth is a browser on this Mac at localhost. Checking the Host header as well as the
// address stops a DNS-rebinding web page from posing as the booth.
function isBooth(address, headers) {
  return loopbackAddresses.has(address) && loopbackHosts.has(hostName(headers.host)) && isSameOrigin(headers);
}

function isPairedRemote(code, headers) {
  const given = Buffer.from(String(code || ""));
  const expected = Buffer.from(sessionCode);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) && isSameOrigin(headers);
}

function requireBooth(req, res, next) {
  if (isBooth(req.socket.remoteAddress, req.headers)) {
    next();
    return;
  }
  res.status(403).json({ error: "This only works on the Mac running the booth." });
}

function requirePairing(req, res, next) {
  if (isBooth(req.socket.remoteAddress, req.headers) || isPairedRemote(req.get("x-party-session"), req.headers)) {
    next();
    return;
  }
  res.status(403).json({ error: "This remote link is out of date. Scan the QR code on the Mac again." });
}

function openAudioSearchUrl(clause, rows) {
  const url = new URL("https://archive.org/advancedsearch.php");
  // Parentheses keep words like OR in the clause from escaping the collection filter.
  url.searchParams.set("q", `(${clause}) AND ${openAudioFilter}`);
  ["identifier", "title", "creator", "date", "licenseurl", "downloads"].forEach((field) => {
    url.searchParams.append("fl[]", field);
  });
  url.searchParams.append("sort[]", "downloads desc");
  url.searchParams.set("rows", String(rows));
  url.searchParams.set("page", "1");
  url.searchParams.set("output", "json");
  return url;
}

async function isOpenAudioItem(identifier) {
  const response = await fetch(openAudioSearchUrl(`identifier:"${identifier}"`, 1), {
    headers: { "User-Agent": "PartyDJBooth/1.0 local music download" },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) throw new Error(`Collection check failed: ${response.status}`);

  const data = await response.json();
  return Number(data.response?.numFound || 0) > 0;
}

function isoDurationSeconds(value) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(value || ""));
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part || 0));
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function youtubeError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function youtubeGet(endpoint, params) {
  const url = new URL(`${youtubeApiBase}/${endpoint}`);
  Object.entries({ ...params, key: youtubeApiKey }).forEach(([name, value]) => {
    url.searchParams.set(name, value);
  });

  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;

  const reason = data.error?.errors?.[0]?.reason || "";
  const message = data.error?.message || "";
  if (/quotaExceeded|dailyLimitExceeded/.test(reason)) {
    throw youtubeError(429, "YouTube's daily search limit for this API key is used up. It resets at midnight Pacific time.");
  }
  if (reason === "keyInvalid" || /API key not valid/i.test(message)) {
    throw youtubeError(503, "The YouTube API key isn't valid. Check YOUTUBE_API_KEY in the .env file.");
  }
  if (reason === "accessNotConfigured" || /has not been used|is disabled/i.test(message)) {
    throw youtubeError(503, "YouTube Data API v3 isn't enabled for this API key's Google Cloud project.");
  }
  if (reason === "playlistNotFound" || response.status === 404) {
    throw youtubeError(404, "Couldn't find that playlist. It may be private, or a YouTube Mix, which can't be imported.");
  }
  throw youtubeError(502, `YouTube search failed (${response.status}).`);
}

// Lengths, titles, and thumbnails for up to 50 video IDs at a time (videos.list, 1 quota unit per
// call), in the order given. Drops live streams (no length, so Auto DJ can't plan around them) and
// videos whose owners block playing them outside YouTube.
async function videoDetails(ids) {
  const byId = new Map();
  for (let start = 0; start < ids.length; start += 50) {
    const batch = ids.slice(start, start + 50);
    const videos = await youtubeGet("videos", { part: "snippet,contentDetails,status", id: batch.join(",") });
    (videos.items || []).forEach((item) => byId.set(item.id, item));
  }

  return ids
    .map((id) => byId.get(id))
    .filter((item) => item && item.status?.embeddable !== false)
    .map((item) => ({
      videoId: item.id,
      title: item.snippet?.title || "YouTube video",
      channel: item.snippet?.channelTitle || "YouTube",
      duration: isoDurationSeconds(item.contentDetails?.duration),
      thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "",
      url: `https://www.youtube.com/watch?v=${item.id}`,
    }))
    .filter((video) => video.duration > 0);
}

function sendYoutubeError(res, error) {
  res.status(error.status || 502).json({
    error: error.status ? error.message : "YouTube is unavailable right now. Check the internet connection and try again.",
    detail: error.message,
  });
}

function cleanSearchTerm(value) {
  return String(value || "")
    .replace(/[^\p{L}\p{N}\s.'&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function cleanIdentifier(value) {
  return String(value || "")
    .replace(/[^a-z0-9_.-]/gi, "")
    .slice(0, 120);
}

function firstValue(value, fallback = "") {
  if (Array.isArray(value)) return value[0] || fallback;
  return value || fallback;
}

function sanitizeFileName(value) {
  return String(value || "track")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9._ -]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "track";
}

function encodeArchivePath(name) {
  return String(name)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isPlayableAudioFile(file = {}) {
  const text = `${file.name || ""} ${file.format || ""}`.toLowerCase();
  return /\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(file.name || "") ||
    /vbr mp3|mp3|ogg vorbis|flac|wave|aac|m4a/.test(text);
}

function chooseAudioFile(files = []) {
  const playable = files
    .filter(isPlayableAudioFile)
    .filter((file) => Number(file.size || 0) > 0 && Number(file.size || 0) <= maxDownloadBytes)
    .filter((file) => !/(sample|preview|spectrogram|metadata)/i.test(file.name || ""));

  const preferred = playable.sort((a, b) => {
    const aName = `${a.format || ""} ${a.name || ""}`.toLowerCase();
    const bName = `${b.format || ""} ${b.name || ""}`.toLowerCase();
    const aScore = aName.includes("mp3") ? 0 : aName.includes("m4a") ? 1 : 2;
    const bScore = bName.includes("mp3") ? 0 : bName.includes("m4a") ? 1 : 2;
    return aScore - bScore || Number(a.size || 0) - Number(b.size || 0);
  });

  return preferred[0] || null;
}

async function readLibrary() {
  try {
    const raw = await fs.promises.readFile(libraryFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.tracks) ? parsed.tracks : [];
  } catch {
    return [];
  }
}

async function writeLibrary(tracks) {
  await fs.promises.writeFile(libraryFile, JSON.stringify({ tracks }, null, 2));
}

async function upsertLibraryTrack(track) {
  const tracks = await readLibrary();
  const nextTracks = tracks.filter((item) => item.key !== track.key);
  nextTracks.unshift(track);
  await writeLibrary(nextTracks);
}

async function downloadableLibraryTracks() {
  const tracks = await readLibrary();
  const existing = [];

  for (const track of tracks) {
    const filePath = path.join(downloadsDir, track.fileName || "");
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      existing.push(track);
    } catch {
      // Ignore stale manifest entries.
    }
  }

  return existing;
}

app.use(express.static(publicDir, {
  extensions: ["html"],
  maxAge: 0,
  setHeaders(res) {
    res.setHeader("Cache-Control", "no-cache");
  },
}));
app.use(express.json({ limit: "1mb" }));
app.use("/music", requireBooth, express.static(downloadsDir, {
  maxAge: "1d",
  setHeaders(res) {
    res.setHeader("Accept-Ranges", "bytes");
  },
}));

app.get("/api/session", requireBooth, async (req, res) => {
  const origin = baseUrl(req);
  const remoteUrl = `${remoteBaseUrl(req)}/?remote=1&session=${sessionCode}`;
  const qrDataUrl = await QRCode.toDataURL(remoteUrl, {
    margin: 1,
    width: 360,
    color: {
      dark: "#111111",
      light: "#f7fff7",
    },
  });

  res.json({
    sessionCode,
    localDisplayUrl: origin,
    localRemoteUrl: remoteUrl,
    qrDataUrl,
    youtubeSearch: Boolean(youtubeApiKey),
    state: partyState,
  });
});

app.get("/api/downloads", requireBooth, async (req, res) => {
  res.json({ tracks: await downloadableLibraryTracks() });
});

app.get("/api/search", requirePairing, async (req, res) => {
  const query = cleanSearchTerm(req.query.q);

  if (query.length < 2) {
    res.status(400).json({ error: "Search needs at least two characters." });
    return;
  }

  try {
    const response = await fetch(openAudioSearchUrl(query, 10), {
      headers: { "User-Agent": "PartyDJBooth/1.0 local music search" },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) throw new Error(`Internet Archive search failed: ${response.status}`);

    const data = await response.json();
    const results = (data.response?.docs || []).map((item) => ({
      identifier: item.identifier,
      title: item.title || item.identifier,
      artist: item.creator || "Internet Archive",
      date: item.date || "",
      licenseUrl: item.licenseurl || "",
      downloads: Number(item.downloads || 0),
      sourceUrl: `https://archive.org/details/${item.identifier}`,
    }));

    res.json({ query, results });
  } catch (error) {
    res.status(502).json({
      error: "Search is unavailable right now. Check the internet connection and try again.",
      detail: error.message,
    });
  }
});

// YouTube is search and play only: videos stream through YouTube's own player on the booth,
// and nothing from YouTube is ever downloaded.
app.get("/api/youtube/search", requirePairing, async (req, res) => {
  if (!youtubeApiKey) {
    res.status(503).json({ error: "YouTube search isn't set up yet. Add YOUTUBE_API_KEY to the .env file and restart the server." });
    return;
  }

  const query = cleanSearchTerm(req.query.q);

  if (query.length < 2) {
    res.status(400).json({ error: "Search needs at least two characters." });
    return;
  }

  try {
    const search = await youtubeGet("search", {
      part: "snippet",
      type: "video",
      videoEmbeddable: "true",
      maxResults: "10",
      q: query,
    });
    const ids = (search.items || []).map((item) => item.id?.videoId).filter(Boolean);

    if (!ids.length) {
      res.json({ query, results: [] });
      return;
    }

    // search.list has no durations, which Auto DJ needs; videos.list adds them.
    res.json({ query, results: await videoDetails(ids) });
  } catch (error) {
    sendYoutubeError(res, error);
  }
});

// Import a YouTube playlist (up to 100 videos): 2 quota units per 50 videos, versus 100 per search.
app.get("/api/youtube/playlist", requirePairing, async (req, res) => {
  if (!youtubeApiKey) {
    res.status(503).json({ error: "YouTube isn't set up yet. Add YOUTUBE_API_KEY to the .env file and restart the server." });
    return;
  }

  const playlistId = String(req.query.list || "");
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(playlistId)) {
    res.status(400).json({ error: "That doesn't look like a YouTube playlist link." });
    return;
  }

  try {
    const ids = [];
    let pageToken = "";
    do {
      const page = await youtubeGet("playlistItems", {
        part: "contentDetails",
        playlistId,
        maxResults: "50",
        ...(pageToken ? { pageToken } : {}),
      });
      ids.push(...(page.items || []).map((item) => item.contentDetails?.videoId).filter(Boolean));
      pageToken = page.nextPageToken || "";
    } while (pageToken && ids.length < 100);

    res.json({ query: playlistId, results: await videoDetails(ids.slice(0, 100)) });
  } catch (error) {
    sendYoutubeError(res, error);
  }
});

app.post("/api/download", requirePairing, async (req, res) => {
  const identifier = cleanIdentifier(req.body?.identifier);

  if (!identifier) {
    res.status(400).json({ error: "Missing download identifier." });
    return;
  }

  try {
    // Only download what search can return: open audio collections, nothing stream-only.
    if (!(await isOpenAudioItem(identifier))) {
      res.status(403).json({ error: "This item is not in the open audio collections, so it can't be downloaded." });
      return;
    }

    const metadataResponse = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
      headers: { "User-Agent": "PartyDJBooth/1.0 local music download" },
      signal: AbortSignal.timeout(12000),
    });

    if (!metadataResponse.ok) throw new Error(`Metadata lookup failed: ${metadataResponse.status}`);

    const metadata = await metadataResponse.json();
    const audioFile = chooseAudioFile(metadata.files || []);

    if (!audioFile) {
      res.status(404).json({ error: "No downloadable audio file under 60 MB was found for this result." });
      return;
    }

    const title = firstValue(metadata.metadata?.title, req.body?.title || identifier);
    const artist = firstValue(metadata.metadata?.creator, req.body?.artist || "Internet Archive");
    const extension = path.extname(audioFile.name || ".mp3") || ".mp3";
    const localName = `${sanitizeFileName(`${artist} - ${title}`)} - ${sanitizeFileName(path.basename(audioFile.name, extension))}${extension}`;
    const localPath = path.join(downloadsDir, localName);
    const key = `archive:${identifier}:${audioFile.name}`;

    try {
      await fs.promises.access(localPath, fs.constants.R_OK);
    } catch {
      const downloadUrl = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeArchivePath(audioFile.name)}`;
      const audioResponse = await fetch(downloadUrl, {
        headers: { "User-Agent": "PartyDJBooth/1.0 local music download" },
        signal: AbortSignal.timeout(90000),
      });

      if (!audioResponse.ok || !audioResponse.body) {
        throw new Error(`Audio download failed: ${audioResponse.status}`);
      }

      const contentLength = Number(audioResponse.headers.get("content-length") || audioFile.size || 0);
      if (contentLength > maxDownloadBytes) {
        res.status(413).json({ error: "This audio file is larger than the 60 MB party download limit." });
        return;
      }

      const tempPath = `${localPath}.download`;
      await pipeline(audioResponse.body, fs.createWriteStream(tempPath));
      await fs.promises.rename(tempPath, localPath);
    }

    const track = {
      key,
      title,
      artist,
      fileName: localName,
      url: `/music/${encodeURIComponent(localName)}`,
      source: "Internet Archive",
      sourceUrl: `https://archive.org/details/${identifier}`,
      licenseUrl: firstValue(metadata.metadata?.licenseurl, req.body?.licenseUrl || ""),
      downloadedAt: new Date().toISOString(),
    };

    await upsertLibraryTrack(track);
    io.emit("download:ready", track);
    res.json({ track });
  } catch (error) {
    res.status(502).json({
      error: "Download failed. Try another result or check your internet connection.",
      detail: error.message,
    });
  }
});

function updatePresence() {
  let displays = 0;
  let remotes = 0;

  // Count live sockets instead of keeping running totals, so reconnects can't push the
  // numbers out of sync.
  for (const client of io.of("/").sockets.values()) {
    if (client.data.role === "display") displays += 1;
    if (client.data.role === "remote") remotes += 1;
  }

  partyState.connectedDisplays = displays;
  partyState.connectedRemotes = remotes;
  io.emit("presence", { displays, remotes });
}

// Every connection declares its role in the handshake, and every reconnect repeats it.
// The booth must be this Mac at localhost; a phone must carry the session code from the QR link.
io.use((socket, next) => {
  const { role, session } = socket.handshake.auth || {};
  const { address, headers } = socket.handshake;
  const booth = isBooth(address, headers);

  if (role === "display" && booth) {
    socket.data.role = "display";
    next();
    return;
  }

  if (role === "remote" && (booth || isPairedRemote(session, headers))) {
    socket.data.role = "remote";
    next();
    return;
  }

  next(new Error("not-authorized"));
});

io.on("connection", (socket) => {
  updatePresence();
  socket.emit("state", partyState);

  socket.on("display:state", (incoming = {}) => {
    // Only the booth owns playback state; phones change it by sending commands.
    if (socket.data.role !== "display") return;

    partyState = {
      ...partyState,
      ...incoming,
      connectedDisplays: partyState.connectedDisplays,
      connectedRemotes: partyState.connectedRemotes,
    };
    socket.broadcast.emit("state", partyState);
  });

  socket.on("remote:command", (command = {}) => {
    io.emit("player:command", {
      ...command,
      at: Date.now(),
      from: socket.id,
    });
  });

  socket.on("disconnect", () => {
    updatePresence();
  });
});

server.listen(port, "0.0.0.0", () => {
  const lanAddress = getLanAddress();
  console.log("");
  console.log("Party DJ Booth is running.");
  console.log(`Mac player:  http://localhost:${port}`);
  console.log(`Phone remote: http://${lanAddress}:${port}/?remote=1&session=${sessionCode}`);
  console.log(`YouTube search: ${youtubeApiKey ? "on" : "off (add YOUTUBE_API_KEY to .env)"}`);
  console.log("");
  console.log("Keep this server running while the party is active.");
});
