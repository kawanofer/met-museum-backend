require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const NodeCache = require("node-cache");
const PQueue = require("p-queue").default;
const https = require("https");

const app = express();
const PORT = process.env.PORT || 3001;

// --- Configuração do Cache ---
const metApiCache = new NodeCache({ stdTTL: 3600 });

// --- Configuração do Rate Limiting ---
const queue = new PQueue({
  concurrency: 3, // Apenas 3 requisições por vez
  intervalCap: 10, // Apenas 10 requisições por intervalo
  interval: 2000, // A cada 2 segundos
  timeout: 30000, // Timeout de 30 segundos por requisição
});

const agent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: false
});
  
// Middleware
app.use(cors()); // Habilita CORS para todas as rotas
app.use(express.json()); // Habilita o parsing de JSON no corpo das requisições

// Função genérica para fazer requisições à API do Met Museum com cache e rate limiting
async function makeMetApiRequest(urlPath, cacheKey, retryCount = 0) {
  // 1. Tentar obter do cache
  const cachedData = metApiCache.get(cacheKey);
  if (cachedData) {
    console.log(`[CACHE HIT] ${cacheKey}`);
    return cachedData;
  }

  // 2. Se não estiver no cache, adicionar à fila para requisição
  console.log(`[-> QUEUEING] ${urlPath}`);
  const response = await queue.add(async () => {
    try {
      console.log(`[<- FETCHING] ${urlPath}`);

      const response = await axios.get(
        `${process.env.MET_API_BASE_URL}${urlPath}`,
        {
          timeout: 15000,
          httpsAgent: agent,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Met-Museum-Backend/1.0.0'
          }
        }
      );
      metApiCache.set(cacheKey, response.data);
      return response.data;
    } catch (error) {
      console.error(`Error fetching from Met API ${urlPath}:`, error.message);
      
      // Retry para erros 403
      if (error.response && error.response.status === 403 && retryCount < 3) {
        console.warn(`[403 BLOCKED] ${urlPath} - API may be rate limiting or blocking requests`);

        const backoffDelay = Math.pow(2, retryCount) * 2000 + Math.random() * 1000; // Exponential backoff
        console.log(`[RETRY] Attempt ${retryCount + 1} for ${urlPath} after 403 error (waiting ${Math.round(backoffDelay)}ms)`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        return makeMetApiRequest(urlPath, cacheKey, retryCount + 1);
      }
      
      throw error;
    }
  });
  return response;
}

// 1. Buscar obras com imagens: GET /api/artworks/search/images
app.get("/api/artworks/search/images", async (req, res) => {
  try {
    const query = req.query.q || "painting";
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

    // Para cada ID, busca os detalhes
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
    
    if (!departmentId) {
      return res.status(400).json({ error: "departmentId is required." });
    }

    // Primeiro, busca os IDs das obras do departamento
    const searchUrlPath = `/public/collection/v1/search?departmentId=${departmentId}&q=portrait`;
    const searchCacheKey = `search-department-${departmentId}`;
    const searchData = await makeMetApiRequest(searchUrlPath, searchCacheKey);

    const objectIDs = searchData.objectIDs || [];

    // Para cada ID, busca os detalhes
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
      `Error in /api/artworks/search/department for ${req.query.departmentId}:`,
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

