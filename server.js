require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const NodeCache = require("node-cache");
const PQueue = require("p-queue").default;

const app = express();
const PORT = process.env.PORT || 3001;

// --- Configuração do Cache ---
const metApiCache = new NodeCache({ stdTTL: 3600 });

// --- Configuração do Rate Limiting ---
const queue = new PQueue({
  concurrency: 5, // Limita a 5 requisições simultâneas para não sobrecarregar
  intervalCap: 70, // Permitir 70 requisições
  interval: 1000, // A cada 1000 ms (1 segundo)
});
  
// Middleware
app.use(cors()); // Habilita CORS para todas as rotas
app.use(express.json()); // Habilita o parsing de JSON no corpo das requisições

// Função genérica para fazer requisições à API do Met Museum com cache e rate limiting
async function makeMetApiRequest(urlPath, cacheKey) {
  // 1. Tentar obter do cache
  const cachedData = metApiCache.get(cacheKey);
  if (cachedData) {
    console.log(`[CACHE HIT] ${cacheKey}`);
    return cachedData;
  }

  // 2. Se não estiver no cache, adicionar à fila para requisição
  console.log(`[QUEUEING] ${urlPath}`);
  const response = await queue.add(async () => {
    try {
      console.log(`[FETCHING] ${urlPath}`);

      const response = await axios.get(
        `${process.env.MET_API_BASE_URL}${urlPath}`,
      );
      metApiCache.set(cacheKey, response.data); // Armazena no cache
      return response.data;
    } catch (error) {
      console.error(`Error fetching from Met API ${urlPath}:`, error.message);
      if (error.response && error.response.status === 403) {
        throw new Error("Met Museum API: Rate limit exceeded or forbidden.");
      }
      throw error;
    }
  });
  return response;
}

// 1. Buscar obras com imagens: GET /api/artworks/search/images
app.get("/api/artworks/search/images", async (req, res) => {
  try {
    const query = req.query.q || "painting"; // Permite que o cliente passe 'q'
    const urlPath = `/public/collection/v1/search?hasImages=true&q=${encodeURIComponent(query)}`;
    const cacheKey = `search-images-${query}`;
    const data = await makeMetApiRequest(urlPath, cacheKey);
    res.json(data.objectIDs || []);
  } catch (error) {
    console.error("Error in /api/artworks/search/images:", error);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// 2. Detalhes de uma obra: GET /api/artworks/:objectID
app.get("/api/artworks/:objectID", async (req, res) => {
  try {
    const objectID = req.params.objectID;
    if (!objectID) {
      return res.status(400).json({ error: "objectID is required." });
    }
    const urlPath = `/public/collection/v1/objects/${objectID}`;
    const cacheKey = `object-detail-${objectID}`;
    const data = await makeMetApiRequest(urlPath, cacheKey);
    res.json(data);
  } catch (error) {
    console.error(`Error in /api/artworks/${req.params.objectID}:`, error);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// 3. Buscar por artista/cultura: GET /api/artworks/search/artist
app.get("/api/artworks/search/artist", async (req, res) => {
  try {
    const artistName = req.query.q;
    if (!artistName) {
      return res.status(400).json({ error: "Artist name (q) is required." });
    }

    // Primeiro, busca os IDs das obras do artista
    const searchUrlPath = `/public/collection/v1/search?artistOrCulture=true&q=${encodeURIComponent(artistName)}`;
    const searchCacheKey = `search-artist-${artistName}`;
    const searchData = await makeMetApiRequest(searchUrlPath, searchCacheKey);

    const objectIDs = searchData.objectIDs || [];

    // Para cada ID, busca os detalhes.
    const artworkDetailsPromises = objectIDs.map((id) =>
      makeMetApiRequest(
        `/public/collection/v1/objects/${id}`,
        `object-detail-${id}`,
      ).catch((err) => {
        console.warn(`Could not fetch detail for objectID ${id}:`, err.message);
        return null;
      }),
    );

    const artworks = (await Promise.allSettled(artworkDetailsPromises))
      .filter(
        (result) => result.status === "fulfilled" && result.value !== null,
      )
      .map((result) => result.value);

    res.json(artworks);
  } catch (error) {
    console.error(
      `Error in /api/artworks/search/artist for ${req.query.q}:`,
      error,
    );
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// 4. Listar departamentos: GET /api/departments
app.get("/api/departments", async (req, res) => {
  try {
    const urlPath = `/public/collection/v1/departments`;
    const cacheKey = `departments`;
    const data = await makeMetApiRequest(urlPath, cacheKey);
    res.json(data.departments || []);
  } catch (error) {
    console.error("Error in /api/departments:", error);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// 5. Buscar por departamento: GET /api/artworks/search/department
app.get("/api/artworks/search/department", async (req, res) => {
  try {
    const departmentId = req.query.departmentId;
    const query = req.query.q;

    if (!departmentId || !query) {
      return res
        .status(400)
        .json({ error: "departmentId and q are required." });
    }

    // Primeiro, busca os IDs das obras do departamento
    const searchUrlPath = `/public/collection/v1/search?departmentId=${departmentId}&q=${encodeURIComponent(query)}`;
    const searchCacheKey = `search-department-${departmentId}-${query}`;
    const searchData = await makeMetApiRequest(searchUrlPath, searchCacheKey);

    const objectIDs = searchData.objectIDs || [];

    // Para cada ID, busca os detalhes.
    const artworkDetailsPromises = objectIDs.map((id) =>
      makeMetApiRequest(
        `/public/collection/v1/objects/${id}`,
        `object-detail-${id}`,
      ).catch((err) => {
        console.warn(`Could not fetch detail for objectID ${id}:`, err.message);
        return null;
      }),
    );

    const artworks = (await Promise.allSettled(artworkDetailsPromises))
      .filter(
        (result) => result.status === "fulfilled" && result.value !== null,
      )
      .map((result) => result.value);

    res.json(artworks);
  } catch (error) {
    console.error(
      `Error in /api/artworks/search/department for ${req.query.departmentId}, ${req.query.q}:`,
      error,
    );
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(`Met Museum API Base URL: ${process.env.MET_API_BASE_URL}`);
});
