import express from "express";
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
const port = Number(process.env.PORT || 4242);
const maxDownloadBytes = 60 * 1024 * 1024;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true },
});

const publicDir = path.join(__dirname, "public");
const downloadsDir = path.join(__dirname, "music-downloads");
const libraryFile = path.join(__dirname, ".music-library.json");
const sessionCode = Math.random().toString(36).slice(2, 8).toUpperCase();

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
app.use("/music", express.static(downloadsDir, {
  maxAge: "1d",
  setHeaders(res) {
    res.setHeader("Accept-Ranges", "bytes");
  },
}));

app.get("/api/session", async (req, res) => {
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
    state: partyState,
  });
});

app.get("/api/downloads", async (req, res) => {
  res.json({ tracks: await downloadableLibraryTracks() });
});

app.get("/api/search", async (req, res) => {
  const query = cleanSearchTerm(req.query.q);

  if (query.length < 2) {
    res.status(400).json({ error: "Search needs at least two characters." });
    return;
  }

  const searchUrl = new URL("https://archive.org/advancedsearch.php");
  searchUrl.searchParams.set(
    "q",
    `${query} AND mediatype:audio AND (collection:opensource_audio OR collection:netlabels OR collection:etree)`,
  );
  ["identifier", "title", "creator", "date", "licenseurl", "downloads"].forEach((field) => {
    searchUrl.searchParams.append("fl[]", field);
  });
  searchUrl.searchParams.append("sort[]", "downloads desc");
  searchUrl.searchParams.set("rows", "10");
  searchUrl.searchParams.set("page", "1");
  searchUrl.searchParams.set("output", "json");

  try {
    const response = await fetch(searchUrl, {
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

app.post("/api/download", async (req, res) => {
  const identifier = cleanIdentifier(req.body?.identifier);

  if (!identifier) {
    res.status(400).json({ error: "Missing download identifier." });
    return;
  }

  try {
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

io.on("connection", (socket) => {
  socket.emit("state", partyState);

  socket.on("register", (payload = {}) => {
    socket.data.role = payload.role === "remote" ? "remote" : "display";
    if (socket.data.role === "display") partyState.connectedDisplays += 1;
    if (socket.data.role === "remote") partyState.connectedRemotes += 1;

    io.emit("presence", {
      displays: partyState.connectedDisplays,
      remotes: partyState.connectedRemotes,
    });
    socket.emit("state", partyState);
  });

  socket.on("display:state", (incoming = {}) => {
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
    if (socket.data.role === "display") {
      partyState.connectedDisplays = Math.max(0, partyState.connectedDisplays - 1);
    }
    if (socket.data.role === "remote") {
      partyState.connectedRemotes = Math.max(0, partyState.connectedRemotes - 1);
    }

    io.emit("presence", {
      displays: partyState.connectedDisplays,
      remotes: partyState.connectedRemotes,
    });
  });
});

server.listen(port, "0.0.0.0", () => {
  const lanAddress = getLanAddress();
  console.log("");
  console.log("Party DJ Booth is running.");
  console.log(`Mac player:  http://localhost:${port}`);
  console.log(`Phone remote: http://${lanAddress}:${port}/?remote=1`);
  console.log("");
  console.log("Keep this server running while the party is active.");
});
